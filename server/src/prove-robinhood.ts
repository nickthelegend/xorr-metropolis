/**
 * Proof: the executor trades Robinhood Chain Stock Tokens for their OWNER, inside a permission the owner set on-chain
 * (PLAN.md P1.10, 2026-09-23). Runs against the hosted Robinhood Chain node (a snapshot of real state, `robinhood-fork`)
 * through the executor's own code paths — nothing here builds a swap or a spend of its own except the two direct
 * `spend()` calls that show the CONTRACT refusing, past every off-chain gate:
 *
 *   0. The node: Multicall3 and QuoterV2 put back if the snapshot lacks them (`fork/robinhood-periphery.ts`); the Stock
 *      Tokens that trade on it (`venues/rh-stocks.ts`: the live Robinhood catalog ∩ code on the node).
 *   1. A fresh owner key: USDG from the fork faucet (`evm/faucet.ts`, paid from FORK_USDC_RESERVE) and ETH for gas.
 *   2. The owner approves USDG and NVDA to `XorrDelegation(USDG)` and grants the executor's delegate a $100 daily cap,
 *      venues = SETTLEMENT_VENUES (Uniswap's SwapRouter02 on this chain), expiring in a day.
 *   3. `placeOrder(wallet, 'NVDA', 50)` — the path `/xstocks/buy` takes: stock guard (session, halt, feed, deviation),
 *      Uniswap v3 through `spend()`. NVDA lands in the OWNER's wallet; the contract holds none.
 *   4. `placeOrder(wallet, 'NVDA', 60)` — refused ($50 of $100 used). Then the same $60 as a raw `spend()` from the
 *      delegate, sent with a fixed gas limit so it is MINED: it reverts on-chain with DailyCapExceeded.
 *   5. `closeHolding(wallet, 'NVDA', 1)` — the path `/xstocks/sell` and `/positions/close` take: `closePosition()` sells
 *      the NVDA back to USDG, into the owner's wallet.
 *   6. The owner revokes. `placeOrder` refuses; a raw `spend()` reverts on-chain with PolicyRevoked.
 *
 * With XORR_CHAIN=arbitrum-fork it runs the short Arbitrum proof instead: a fresh owner, USDC from the fork faucet, a
 * grant, and `placeOrder(wallet, 'WETH', 20)` — $20 USDC → WETH through the same settlement code.
 *
 * Every transaction hash is printed.
 *
 * Run (Robinhood):
 *   cd server && set -a && . ./.env.robinhood-fork && . ./.env.railway-robinhood-fork && set +a && \
 *     DATABASE_URL=postgres://localhost:5432/<a migrated db> npx tsx src/prove-robinhood.ts
 * Run (Arbitrum):
 *   cd server && set -a && . ./.env.arbitrum-fork && . ./.env.railway-arbitrum-fork && set +a && \
 *     DATABASE_URL=… npx tsx src/prove-robinhood.ts
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
import { ADDRESSES, CHAIN_KEY, IS_ARBITRUM, SETTLEMENT_SYMBOL, SETTLEMENT_VENUES, UNISWAP, chain, rpcUrl } from './evm/chains.js';
import { publicClient, delegateAccount } from './evm/client.js';
import { DELEGATION_ABI, DELEGATION_ADDRESS, readPolicy, usdToUnits } from './evm/delegation.js';
import { topUpNative } from './fork/anvil.js';
import { one, pool } from './db/index.js';
import { placeOrder } from './executor/order.js';
import { closeHolding } from './routes/panic.js';
import { readFaucetOffer, sendTestFunds } from './evm/faucet.js';
import { TOKENS, ensureRegistry } from './venues/tokens.js';
import { buildSwap } from './venues/uniswap.js';
import type { WalletRow } from './routes/wallet-context.js';

const line = (s = '') => console.log(s);
const step = (n: string, s: string) => line(`\n${n}. ${s}`);
const tx = (label: string, hash: string) => line(`   ${label.padEnd(34)} ${hash}`);

function fail(msg: string): never {
  console.error(`\nPROOF FAILED: ${msg}`);
  process.exit(1);
}

if (CHAIN_KEY !== 'robinhood-fork' && CHAIN_KEY !== 'arbitrum-fork') {
  fail(`XORR_CHAIN=${CHAIN_KEY}; this proof runs on robinhood-fork or arbitrum-fork only (it writes balances with anvil cheats).`);
}
if (!process.env.DATABASE_URL) fail('DATABASE_URL is required: the order path books the fill and audits it.');

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

/**
 * A raw `spend()` from the delegate, past every gate the executor applies — sent with a fixed gas limit so a refusal is
 * MINED and has a hash, which is the point: the contract, not our code, is what says no.
 */
async function rawSpend(usd: number, symbol: string): Promise<{ hash: Hex; status: string; refusal: string }> {
  const swap = await buildSwap({
    inSymbol: SETTLEMENT_SYMBOL,
    outSymbol: symbol,
    amount: usd,
    from: DELEGATION_ADDRESS,
    receiver: owner.address,
    slippagePct: 1,
  });
  const args: SpendArgs = [owner.address, ADDRESSES.usdcBase, swap.to, usdToUnits(usd), TOKENS[symbol]!.address, swap.minOut, swap.data];
  const data = encodeFunctionData({ abi: DELEGATION_ABI, functionName: 'spend', args });
  const refusal = await revertName(args);
  const hash = await delegationWrite.sendTransaction({ to: DELEGATION_ADDRESS, data, gas: 1_500_000n });
  return { hash, status: await mined(hash), refusal };
}

async function walletRow(): Promise<WalletRow> {
  const row = await one<WalletRow>(
    `INSERT INTO wallets (id, user_id, address, kind, cluster, active_at) VALUES ($1, $2, $3, 'embedded', $4, now()) RETURNING *`,
    [randomUUID(), `prove-${Date.now()}`, owner.address, CHAIN_KEY],
  );
  return row!;
}

async function fundAndGrant(tokensToApprove: { symbol: string; address: Address }[]): Promise<WalletRow> {
  step('1', `Fresh owner ${owner.address}: ${SETTLEMENT_SYMBOL} from the fork faucet, ETH for gas`);
  const offer = await readFaucetOffer();
  if (!offer.available) fail(`the fork faucet refused: ${offer.detail}`);
  line(`   faucet pays from ${offer.from} (${formatUnits(offer.usdcRaw, 6)} ${SETTLEMENT_SYMBOL} per claim)`);
  const sent = await sendTestFunds(offer, owner.address);
  if (!sent.sent) fail(`the faucet did not send: ${sent.detail}`);
  tx(`faucet ${SETTLEMENT_SYMBOL} transfer`, sent.txHash);
  line(`   owner holds ${formatUnits(await balanceOf(ADDRESSES.usdcBase, owner.address), 6)} ${SETTLEMENT_SYMBOL}`);
  await topUpNative(rpcUrl, owner.address, parseEther('0.05'));
  const delegateTopUp = await topUpNative(rpcUrl, delegateAccount.address, parseEther('0.05'));
  line(`   delegate ${delegateAccount.address} ${delegateTopUp > 0n ? 'topped up to 0.05 ETH' : 'already holds gas'}`);

  step('2', `Owner approves ${tokensToApprove.map((t) => t.symbol).join(' + ')} to XorrDelegation ${DELEGATION_ADDRESS} and grants a $100/day cap`);
  for (const t of tokensToApprove) {
    const h = await ownerWallet.writeContract({ address: t.address, abi: erc20Abi, functionName: 'approve', args: [DELEGATION_ADDRESS, maxUint256] });
    tx(`approve ${t.symbol}`, h);
    if ((await mined(h)) !== 'success') fail(`approving ${t.symbol} reverted`);
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
  line(`   venues granted: ${SETTLEMENT_VENUES.join(', ')} (SwapRouter02 ${UNISWAP?.router})`);
  const policy = await readPolicy(owner.address);
  line(`   on-chain policy: cap $${policy?.dailyCapUsd}, remaining today $${policy?.remainingTodayUsd}, revoked ${policy?.revoked}`);
  return walletRow();
}

async function order(w: WalletRow, symbol: string, usd: number) {
  const r = await placeOrder(w, symbol, usd, `Prove: buy $${usd} of ${symbol}`);
  if (!r.placed) return { status: 'refused' as const, reason: r.refusal.reason, detail: r.refusal.detail };
  return r.outcome;
}

/** What the Stock Token gate the order path runs says right now — the same call `run.ts` and `closeHolding` make. */
async function showGuard(side: 'buy' | 'sell', usd: number): Promise<void> {
  const { stockGuard } = await import('./executor/stock-guard.js');
  const g = await stockGuard({ symbol: 'NVDA', side, usd });
  line(`   stock guard (${side}): ${g.ok ? 'pass' : `REFUSE ${g.reason}`} — ${g.ok ? g.detail?.message : g.message}`);
  if (g.ok && g.detail?.chainlink) {
    line(`     Chainlink NVDA/USD (live Robinhood Chain feed) $${g.detail.chainlink.price} updated ${g.detail.chainlink.updatedAt} (${g.detail.chainlink.ageSec}s old, max ${g.detail.chainlink.maxAgeSec}s)`);
  }
}

async function robinhood(): Promise<void> {
  line(`xorr proof on ${CHAIN_KEY} — ${rpcUrl}`);
  step('0', 'The node');
  const { ensureRobinhoodForkPeriphery } = await import('./fork/robinhood-periphery.js');
  for (const p of await ensureRobinhoodForkPeriphery({ rpc: rpcUrl })) line(`   ${p.name.padEnd(18)} ${p.address} ${p.action}`);
  const { robinhoodStocks } = await import('./venues/rh-stocks.js');
  const { stockCatalog } = await import('./robinhood/catalog.js');
  const [stocks, catalog] = await Promise.all([robinhoodStocks(), stockCatalog()]);
  line(`   Robinhood catalog: ${catalog.length} Stock Tokens with a funded USDG pool on Robinhood Chain`);
  line(`   tradable on this node (token + pool have code): ${stocks.map((s) => `${s.symbol} (pool ${s.pool.address}, fee ${s.pool.fee})`).join(', ')}`);
  line(`   not tradable here: ${catalog.length - stocks.length}`);
  const nvda = stocks.find((s) => s.symbol === 'NVDA');
  if (!nvda) fail('NVDA does not trade on this node');
  await ensureRegistry();

  const w = await fundAndGrant([
    { symbol: SETTLEMENT_SYMBOL, address: ADDRESSES.usdcBase },
    { symbol: 'NVDA', address: nvda.address },
  ]);

  step('3', 'placeOrder(owner, NVDA, $50) — the /xstocks/buy path');
  await showGuard('buy', 50);
  const usdgBefore = await balanceOf(ADDRESSES.usdcBase, owner.address);
  const first = await order(w, 'NVDA', 50);
  if (first.status !== 'filled') fail(`the $50 NVDA buy did not fill: ${JSON.stringify(first)}`);
  tx('spend() → Uniswap v3 USDG→NVDA', first.signature);
  const nvdaHeld = await balanceOf(nvda.address, owner.address);
  const inContract = await balanceOf(nvda.address, DELEGATION_ADDRESS);
  const { sharesOf } = await import('./venues/rh-stocks.js');
  const shares = await sharesOf(nvda.address, owner.address);
  line(`   filled ${first.units.toFixed(6)} NVDA at $${first.price.toFixed(4)} (USDG ${formatUnits(usdgBefore, 6)} → ${formatUnits(await balanceOf(ADDRESSES.usdcBase, owner.address), 6)})`);
  line(`   OWNER holds ${formatUnits(nvdaHeld, 18)} NVDA = ${shares.shares.toFixed(6)} shares (uiMultiplier ${formatUnits(shares.multiplier, 18)}); the contract holds ${formatUnits(inContract, 18)}`);
  if (nvdaHeld === 0n) fail('NVDA did not reach the owner');
  const run = await one<{ venue: string; status: string }>(`SELECT venue, status FROM strategy_runs WHERE signature = $1`, [first.signature]);
  line(`   strategy_runs: ${run?.status} via ${run?.venue}`);

  step('4', 'A second buy of $60 (only $50 of the $100 cap is left)');
  const second = await order(w, 'NVDA', 60);
  line(`   executor: ${second.status} — ${'reason' in second ? second.reason : ''}: ${'detail' in second ? second.detail : ''}`);
  if (second.status === 'filled') fail('the $60 buy filled past the cap');
  const capped = await rawSpend(60, 'NVDA');
  tx(`raw spend($60) mined: ${capped.status}`, capped.hash);
  line(`   the contract's refusal: ${capped.refusal}`);
  if (capped.status !== 'reverted' || !capped.refusal.startsWith('DailyCapExceeded')) fail('the contract did not refuse the $60 spend with DailyCapExceeded');

  step('5', 'closeHolding(owner, NVDA, 100%) — the /xstocks/sell and /positions/close path, through closePosition()');
  await showGuard('sell', 50);
  const usdgBeforeSale = await balanceOf(ADDRESSES.usdcBase, owner.address);
  const closed = await closeHolding({ wallet: w, symbol: 'NVDA', fraction: 1, actor: 'Prove' });
  if (closed.status !== 200) fail(`the sale did not go through: ${JSON.stringify(closed.body)}`);
  tx(`closePosition() → ${String(closed.body.route ?? closed.body.venue)}`, String(closed.body.txHash));
  const usdgAfterSale = await balanceOf(ADDRESSES.usdcBase, owner.address);
  line(`   sold ${Number(closed.body.units).toFixed(6)} NVDA for ${formatUnits(usdgAfterSale - usdgBeforeSale, 6)} USDG into the owner's wallet; NVDA left ${formatUnits(await balanceOf(nvda.address, owner.address), 18)}`);

  step('6', 'The owner revokes; the next order is refused');
  const revoke = await ownerWallet.writeContract({ address: DELEGATION_ADDRESS, abi: DELEGATION_ABI, functionName: 'revoke', args: [] });
  tx('revoke()', revoke);
  if ((await mined(revoke)) !== 'success') fail('revoke reverted');
  const after = await order(w, 'NVDA', 10);
  line(`   executor: ${after.status} — ${'reason' in after ? after.reason : ''}: ${'detail' in after ? after.detail : ''}`);
  if (after.status === 'filled') fail('an order filled after the revoke');
  const revoked = await rawSpend(10, 'NVDA');
  tx(`raw spend($10) mined: ${revoked.status}`, revoked.hash);
  line(`   the contract's refusal: ${revoked.refusal}`);
  if (revoked.status !== 'reverted' || !revoked.refusal.startsWith('PolicyRevoked')) fail('the contract did not refuse with PolicyRevoked');

  const audit = await one<{ n: string }>(`SELECT count(*)::text AS n FROM audit_log WHERE wallet_id = $1`, [w.id]);
  line(`\nPROOF PASSED on ${CHAIN_KEY}: ${audit?.n} audit rows for ${owner.address}.`);
}

async function arbitrum(): Promise<void> {
  line(`xorr proof on ${CHAIN_KEY} — ${rpcUrl}`);
  const w = await fundAndGrant([{ symbol: 'USDC', address: ADDRESSES.usdcBase }]);
  step('3', 'placeOrder(owner, WETH, $20) — USDC → WETH through executor/settle.ts');
  const weth = TOKENS.WETH!.address;
  const before = await balanceOf(weth, owner.address);
  const r = await order(w, 'WETH', 20);
  if (r.status !== 'filled') fail(`the $20 WETH buy did not fill: ${JSON.stringify(r)}`);
  tx('spend() → WETH', r.signature);
  const run = await one<{ venue: string }>(`SELECT venue FROM strategy_runs WHERE signature = $1`, [r.signature]);
  line(`   filled ${formatUnits((await balanceOf(weth, owner.address)) - before, 18)} WETH at $${r.price.toFixed(2)} via ${run?.venue}; the contract holds ${formatUnits(await balanceOf(weth, DELEGATION_ADDRESS), 18)} WETH`);
  line(`\nPROOF PASSED on ${CHAIN_KEY}.`);
}

try {
  await (IS_ARBITRUM ? arbitrum() : robinhood());
} catch (e) {
  fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
} finally {
  await pool.end().catch(() => undefined);
}
process.exit(0);
