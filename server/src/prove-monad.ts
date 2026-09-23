/**
 * Proof: the executor trades MON for its OWNER on a fork of Monad mainnet, inside a permission the owner set on-chain
 * (PLAN.md P1.4, 2026-09-24). Runs through the executor's own code paths — nothing here builds a swap or a spend of its
 * own except the two direct `spend()` calls that show the CONTRACT refusing, past every off-chain gate:
 *
 *   1. A fresh owner key: USDC from the fork faucet (`evm/faucet.ts`, paid from FORK_USDC_RESERVE) and MON for gas.
 *   2. The owner approves USDC and WMON to `XorrDelegation(USDC)` and grants the executor's delegate a $100 daily cap,
 *      venues = SETTLEMENT_VENUES (Uniswap's SwapRouter02 on Monad), expiring in a day.
 *   3. `placeOrder(wallet, 'WMON', 50)` — Uniswap v3 WMON/USDC through `spend()`. WMON lands in the OWNER's wallet; the
 *      contract holds none.
 *   4. `placeOrder(wallet, 'WMON', 60)` — refused ($50 of $100 used). Then the same $60 as a raw `spend()` from the
 *      delegate, sent with a fixed gas limit so it is MINED: it reverts on-chain with DailyCapExceeded.
 *   5. `closeHolding(wallet, 'WMON', 1)` — the path `/positions/close` takes: `closePosition()` sells the WMON back to
 *      USDC, into the owner's wallet.
 *   6. The owner revokes. `placeOrder` refuses; a raw `spend()` reverts on-chain with PolicyRevoked.
 *
 * Every transaction hash is printed. The pool, the router, USDC and WMON are Monad mainnet's own, at the fork block.
 *
 * Run:
 *   anvil --fork-url https://rpc.monad.xyz --chain-id 143        (or infra/monad-fork/entrypoint.sh)
 *   cd server && XORR_CHAIN=monad-fork npx tsx src/fork-bootstrap-evm.ts        (writes .env.fork)
 *   set -a && . ./.env.fork && set +a && DELEGATE_PRIVATE_KEY=… DATABASE_URL=… npx tsx src/prove-monad.ts
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  maxUint256,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ADDRESSES, CHAIN_KEY, SETTLEMENT_VENUES, UNISWAP, chain, rpcUrl } from './evm/chains.js';
import { publicClient, delegateAccount } from './evm/client.js';
import { DELEGATION_ABI, DELEGATION_ADDRESS, readPolicy, usdToUnits } from './evm/delegation.js';
import { topUpNative } from './fork/anvil.js';
import { one, pool } from './db/index.js';
import { placeOrder } from './executor/order.js';
import { closeHolding } from './routes/panic.js';
import { readFaucetOffer, sendTestFunds } from './evm/faucet.js';
import { TOKENS } from './venues/tokens.js';
import { buildSwap } from './venues/uniswap.js';
import type { WalletRow } from './routes/wallet-context.js';

const line = (s = '') => console.log(s);
const step = (n: string, s: string) => line(`\n${n}. ${s}`);
const tx = (label: string, hash: string) => line(`   ${label.padEnd(34)} ${hash}`);

function fail(msg: string): never {
  console.error(`\nPROOF FAILED: ${msg}`);
  process.exit(1);
}

if (CHAIN_KEY !== 'monad-fork') fail(`XORR_CHAIN=${CHAIN_KEY}; this proof runs on monad-fork only (it writes balances with anvil cheats).`);
if (!process.env.DATABASE_URL) fail('DATABASE_URL is required: the order path books the fill and audits it.');

const SYMBOL = 'WMON';
const USDC = ADDRESSES.usdcBase;
const WMON = TOKENS[SYMBOL]!.address;

const owner = privateKeyToAccount(generatePrivateKey());
const ownerWallet = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
const delegationWrite = createWalletClient({ account: delegateAccount, chain, transport: http(rpcUrl) });

async function mined(hash: Hex): Promise<'success' | 'reverted'> {
  return (await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 })).status;
}

async function balanceOf(token: Address, who: Address): Promise<bigint> {
  return publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [who] });
}

type SpendArgs = readonly [Address, Address, Address, bigint, Address, bigint, Hex];

/** The contract's own refusal of `spend(args)` from the delegate, by name — read with an `eth_call` before sending. */
async function revertName(args: SpendArgs): Promise<string> {
  try {
    await publicClient.simulateContract({ account: delegateAccount, address: DELEGATION_ADDRESS, abi: DELEGATION_ABI, functionName: 'spend', args });
    return '(no revert)';
  } catch (err) {
    const reverted = err instanceof BaseError ? err.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    if (reverted instanceof ContractFunctionRevertedError) {
      return `${reverted.data?.errorName ?? 'unknown'}(${(reverted.data?.args ?? []).map(String).join(', ')})`;
    }
    return err instanceof Error ? err.message.split('\n')[0]! : String(err);
  }
}

/** A raw `spend()` from the delegate, past every gate the executor applies, mined with a fixed gas limit so it has a hash. */
async function rawSpend(usd: number): Promise<{ hash: Hex; status: string; refusal: string }> {
  const swap = await buildSwap({ inSymbol: 'USDC', outSymbol: SYMBOL, amount: usd, from: DELEGATION_ADDRESS, receiver: owner.address, slippagePct: 1 });
  const args: SpendArgs = [owner.address, USDC, swap.to, usdToUnits(usd), WMON, swap.minOut, swap.data];
  const data = encodeFunctionData({ abi: DELEGATION_ABI, functionName: 'spend', args });
  const refusal = await revertName(args);
  const hash = await delegationWrite.sendTransaction({ to: DELEGATION_ADDRESS, data, gas: 1_500_000n });
  return { hash, status: await mined(hash), refusal };
}

async function order(w: WalletRow, usd: number) {
  const r = await placeOrder(w, SYMBOL, usd, `Prove: buy $${usd} of MON`);
  if (!r.placed) return { status: 'refused' as const, reason: r.refusal.reason, detail: r.refusal.detail };
  return r.outcome;
}

async function main(): Promise<void> {
  line(`xorr proof on ${CHAIN_KEY} — ${rpcUrl}  (chain ${await publicClient.getChainId()}, block ${await publicClient.getBlockNumber()})`);

  step('1', `Fresh owner ${owner.address}: USDC from the fork faucet, MON for gas`);
  const offer = await readFaucetOffer();
  if (!offer.available) fail(`the fork faucet refused: ${offer.detail}`);
  const sent = await sendTestFunds(offer, owner.address);
  if (!sent.sent) fail(`the faucet did not send: ${sent.detail}`);
  tx('faucet USDC transfer', sent.txHash);
  line(`   owner holds ${formatUnits(await balanceOf(USDC, owner.address), 6)} USDC (Circle's, at ${USDC})`);
  await topUpNative(rpcUrl, owner.address, parseEther('1'));
  await topUpNative(rpcUrl, delegateAccount.address, parseEther('1'));

  step('2', `Owner approves USDC + WMON to XorrDelegation ${DELEGATION_ADDRESS} and grants a $100/day cap`);
  for (const [symbol, address] of [['USDC', USDC], [SYMBOL, WMON]] as const) {
    const h = await ownerWallet.writeContract({ address, abi: erc20Abi, functionName: 'approve', args: [DELEGATION_ADDRESS, maxUint256] });
    tx(`approve ${symbol}`, h);
    if ((await mined(h)) !== 'success') fail(`approving ${symbol} reverted`);
  }
  const now = (await publicClient.getBlock()).timestamp;
  const grant = await ownerWallet.writeContract({
    address: DELEGATION_ADDRESS,
    abi: DELEGATION_ABI,
    functionName: 'grant',
    args: [delegateAccount.address, usdToUnits(100), now + 86_400n, [...SETTLEMENT_VENUES]],
  });
  tx('grant($100/day, venues)', grant);
  if ((await mined(grant)) !== 'success') fail('the grant reverted');
  line(`   venues granted: ${SETTLEMENT_VENUES.join(', ')} (Uniswap SwapRouter02 on Monad ${UNISWAP?.router})`);
  const policy = await readPolicy(owner.address);
  line(`   on-chain policy: cap $${policy?.dailyCapUsd}, remaining today $${policy?.remainingTodayUsd}, revoked ${policy?.revoked}`);
  const w = (await one<WalletRow>(
    `INSERT INTO wallets (id, user_id, address, kind, cluster, active_at) VALUES ($1, $2, $3, 'embedded', $4, now()) RETURNING *`,
    [randomUUID(), `prove-${Date.now()}`, owner.address, CHAIN_KEY],
  ))!;

  step('3', 'placeOrder(owner, WMON, $50) — Uniswap v3 on Monad through spend()');
  const usdcBefore = await balanceOf(USDC, owner.address);
  const first = await order(w, 50);
  if (first.status !== 'filled') fail(`the $50 MON buy did not fill: ${JSON.stringify(first)}`);
  tx('spend() → Uniswap v3 USDC→WMON', first.signature);
  const held = await balanceOf(WMON, owner.address);
  line(`   filled ${first.units.toFixed(4)} WMON at $${first.price.toFixed(6)} (USDC ${formatUnits(usdcBefore, 6)} → ${formatUnits(await balanceOf(USDC, owner.address), 6)})`);
  line(`   OWNER holds ${formatUnits(held, 18)} WMON; the contract holds ${formatUnits(await balanceOf(WMON, DELEGATION_ADDRESS), 18)}`);
  if (held === 0n) fail('WMON did not reach the owner');
  const run = await one<{ venue: string; status: string }>(`SELECT venue, status FROM strategy_runs WHERE signature = $1`, [first.signature]);
  line(`   strategy_runs: ${run?.status} via ${run?.venue}`);

  step('4', 'A second buy of $60 (only $50 of the $100 cap is left)');
  const second = await order(w, 60);
  line(`   executor: ${second.status} — ${'reason' in second ? second.reason : ''}: ${'detail' in second ? second.detail : ''}`);
  if (second.status === 'filled') fail('the $60 buy filled past the cap');
  const capped = await rawSpend(60);
  tx(`raw spend($60) mined: ${capped.status}`, capped.hash);
  line(`   the contract's refusal: ${capped.refusal}`);
  if (capped.status !== 'reverted' || !capped.refusal.startsWith('DailyCapExceeded')) fail('the contract did not refuse the $60 spend with DailyCapExceeded');

  step('5', 'closeHolding(owner, WMON, 100%) — the /positions/close path, through closePosition()');
  const usdcBeforeSale = await balanceOf(USDC, owner.address);
  const closed = await closeHolding({ wallet: w, symbol: SYMBOL, fraction: 1, actor: 'Prove' });
  if (closed.status !== 200) fail(`the sale did not go through: ${JSON.stringify(closed.body)}`);
  tx(`closePosition() → ${String(closed.body.route ?? closed.body.venue)}`, String(closed.body.txHash));
  line(`   sold ${Number(closed.body.units).toFixed(4)} WMON for ${formatUnits((await balanceOf(USDC, owner.address)) - usdcBeforeSale, 6)} USDC into the owner's wallet; WMON left ${formatUnits(await balanceOf(WMON, owner.address), 18)}`);

  step('6', 'The owner revokes; the next order is refused');
  const revoke = await ownerWallet.writeContract({ address: DELEGATION_ADDRESS, abi: DELEGATION_ABI, functionName: 'revoke', args: [] });
  tx('revoke()', revoke);
  if ((await mined(revoke)) !== 'success') fail('revoke reverted');
  const after = await order(w, 10);
  line(`   executor: ${after.status} — ${'reason' in after ? after.reason : ''}: ${'detail' in after ? after.detail : ''}`);
  if (after.status === 'filled') fail('an order filled after the revoke');
  const revoked = await rawSpend(10);
  tx(`raw spend($10) mined: ${revoked.status}`, revoked.hash);
  line(`   the contract's refusal: ${revoked.refusal}`);
  if (revoked.status !== 'reverted' || !revoked.refusal.startsWith('PolicyRevoked')) fail('the contract did not refuse with PolicyRevoked');

  const audit = await one<{ n: string }>(`SELECT count(*)::text AS n FROM audit_log WHERE wallet_id = $1`, [w.id]);
  line(`\nPROOF PASSED on ${CHAIN_KEY}: ${audit?.n} audit rows for ${owner.address}.`);
}

try {
  await main();
} catch (e) {
  fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
} finally {
  await pool.end().catch(() => undefined);
}
process.exit(0);
