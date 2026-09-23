/**
 * Proof, on Monad testnet (a real network): a user's Perpl account held by Perpl's own DelegatedAccount and traded by
 * xorr's agent key, which can trade and can never withdraw (FEATURES-100 #2/#3/#5/#7, 2026-09-24).
 *
 *   1. A fresh owner: test MON for gas from the deployment's faucet key, AUSD from Agora's own testnet faucet.
 *   2. The owner signs Perpl's EIP-712 `Create`; xorr's operator consents; the executor submits `createWithSignature`.
 *   3. The owner funds the desk and opens its Perpl account (their two transactions).
 *   4. The agent opens a MON long through the desk — `placePerpOrder`, the path the app uses.
 *   5. An order over the owner's per-order cap is refused before anything is signed.
 *   6. The agent closes the long.
 *   7. The owner removes xorr's operator on chain. The executor refuses; a raw order from the operator, sent anyway with
 *      a fixed gas limit so it is mined, reverts on chain in Perpl's own contract.
 *   8. The owner withdraws: the AUSD comes back to the owner's wallet — the only place it can go.
 *
 * Run: cd server && set -a && . ./.env.testnet-monad && set +a && npx tsx src/prove-perpl-desk.ts
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createWalletClient, erc20Abi, formatEther, http, parseAbi, parseEther, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { CHAIN_KEY, chain, rpcUrl } from './evm/chains.js';
import { publicClient } from './evm/client.js';
import { faucetAccount } from './evm/gasDrip.js';
import { monadFees, sendWhenSpendable } from './evm/spendable.js';
import { one, pool } from './db/index.js';
import { DESK_ABI, execOrderData, perplHere, planOrder } from './monad/perpl-chain.js';
import { PerplRefusal, createDesk, createTypedData, deskState, operatorConsent, operatorFor, perplMarkets, placePerpOrder } from './monad/perpl-desk.js';

const line = (s = '') => console.log(s);
const step = (n: string, s: string) => line(`\n${n}. ${s}`);
const tx = (label: string, hash: string) => line(`   ${label.padEnd(36)} ${hash}`);
function fail(msg: string): never {
  console.error(`\nPROOF FAILED: ${msg}`);
  process.exit(1);
}

if (CHAIN_KEY !== 'monad-testnet') fail(`XORR_CHAIN=${CHAIN_KEY}; this proof runs on monad-testnet.`);
const net = perplHere()!;
const AGORA_FAUCET = '0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C' as Address;
const MON_PERP = 64;

/*
 * The owner's key is kept (gitignored `.keys/`) and reused, so a rerun continues the same desk instead of stranding test MON
 * in a key that existed only in memory — which is what the first attempts did.
 */
const OWNER_KEY_FILE = path.join(import.meta.dirname, '../.keys/prove-perpl-owner.key');
const ownerKey = (fs.existsSync(OWNER_KEY_FILE) ? fs.readFileSync(OWNER_KEY_FILE, 'utf8').trim() : (() => {
  const k = generatePrivateKey();
  fs.mkdirSync(path.dirname(OWNER_KEY_FILE), { recursive: true });
  fs.writeFileSync(OWNER_KEY_FILE, k, { mode: 0o600 });
  return k;
})()) as Hex;
const owner = privateKeyToAccount(ownerKey);
const ownerWallet = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });

async function send(label: string, p: { to: Address; data?: Hex; value?: bigint; abi?: unknown; functionName?: string; args?: unknown[] }) {
  const request = p.abi
    ? { account: owner, to: p.to, data: undefined as Hex | undefined }
    : { account: owner, to: p.to, data: p.data, value: p.value };
  let data = request.data;
  if (p.abi) {
    const { encodeFunctionData } = await import('viem');
    data = encodeFunctionData({ abi: p.abi, functionName: p.functionName, args: p.args } as never);
  }
  const gas = await publicClient.estimateGas({ account: owner, to: p.to, data, value: p.value });
  const fees = await monadFees(publicClient, chain.id);
  const hash = await sendWhenSpendable(() => ownerWallet.sendTransaction({ account: owner, chain, to: p.to, data, value: p.value, gas: (gas * 110n) / 100n, ...fees }));
  const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  tx(`${label}: ${r.status}`, hash);
  if (r.status !== 'success') fail(`${label} reverted`);
  return hash;
}

const ausdOf = (a: Address) => publicClient.readContract({ address: net.collateral, abi: erc20Abi, functionName: 'balanceOf', args: [a] });

try {
  line(`xorr Perpl desk proof on ${CHAIN_KEY} (${net.name}) — Exchange ${net.exchange}, factory ${net.factory}`);

  step('1', `Fresh owner ${owner.address}`);
  const faucet = faucetAccount();
  if (!faucet) fail('FAUCET_PRIVATE_KEY is not set');
  const fw = createWalletClient({ account: faucet, chain, transport: http(rpcUrl) });
  // Enough for the owner's own transactions still to come (allowlist, removeOperator, withdraw): ~0.03 MON on testnet.
  const OWNER_GAS = parseEther('0.04');
  const have = await publicClient.getBalance({ address: owner.address });
  if (have < OWNER_GAS) {
    const gasHash = await sendWhenSpendable(() => fw.sendTransaction({ account: faucet, chain, to: owner.address, value: OWNER_GAS - have, gas: 21000n }));
    const r = await publicClient.waitForTransactionReceipt({ hash: gasHash });
    tx(`${formatEther(OWNER_GAS - have)} test MON for gas: ${r.status}`, gasHash);
    if (r.status !== 'success') fail('the gas top-up reverted (the faucet key is short of MON)');
  } else {
    line(`   owner already holds ${formatEther(have)} MON`);
  }
  /*
   * AUSD: Agora's own faucet when it will serve, else the deployment's AUSD reserve (claimed from that faucet earlier) by an
   * ordinary transfer. The faucet is rate-limited for everyone at once (`MaxFrequencyExceeded()`), so it often will not.
   */
  const agora = parseAbi(['function requestFunds(address)', 'error MaxFrequencyExceeded()']);
  const ausdHave = await ausdOf(owner.address);
  const agoraServes = ausdHave >= 150_000_000n ? false : await publicClient
    .simulateContract({ account: owner, address: AGORA_FAUCET, abi: agora, functionName: 'requestFunds', args: [owner.address] })
    .then(() => true, (e: unknown) => (line(`   Agora's faucet refused: ${e instanceof Error ? e.message.split('\n')[0] : e}`), false));
  if (ausdHave >= 150_000_000n) {
    line(`   owner already holds ${Number(ausdHave) / 1e6} AUSD`);
  } else if (agoraServes) {
    await send("Agora faucet requestFunds(owner)", { to: AGORA_FAUCET, abi: agora, functionName: 'requestFunds', args: [owner.address] });
  } else {
    const h = await sendWhenSpendable(() => fw.writeContract({ account: faucet, chain, address: net.collateral, abi: erc20Abi, functionName: 'transfer', args: [owner.address, 500_000_000n] }));
    await publicClient.waitForTransactionReceipt({ hash: h });
    tx('500 AUSD from the reserve (transfer)', h);
  }
  line(`   owner holds ${Number(await ausdOf(owner.address)) / 1e6} AUSD (Agora testnet) and ${formatEther(await publicClient.getBalance({ address: owner.address }))} MON`);
  const w =
    (await one<{ id: string }>(`SELECT id FROM wallets WHERE lower(address) = lower($1) AND cluster = $2 LIMIT 1`, [owner.address, CHAIN_KEY])) ??
    (await one<{ id: string }>(
      `INSERT INTO wallets (id, user_id, address, kind, cluster, active_at) VALUES ($1, $2, $3, 'embedded', $4, now()) RETURNING id`,
      [randomUUID(), `prove-perpl-${Date.now()}`, owner.address, CHAIN_KEY],
    ))!;

  step('2', "Owner signs Perpl's Create; xorr's operator consents; the executor submits createWithSignature");
  const existing = await deskState(owner.address);
  let made: { desk: Address; operator: Address; txHash: string };
  if (existing.desk) {
    made = { desk: existing.desk, operator: existing.operator, txHash: existing.createTx ?? '' };
    line(`   desk exists: ${made.desk} (created ${made.txHash})`);
  } else {
  const typed = await createTypedData(owner.address);
  line(`   operator (xorr, this owner only): ${typed.message.operator}`);
  const signature = await owner.signTypedData({
    domain: typed.domain,
    types: typed.types,
    primaryType: 'Create',
    message: { owner: owner.address, operator: typed.message.operator as Address, nonce: BigInt(typed.message.nonce), deadline: BigInt(typed.message.deadline) },
  });
  made = await createDesk({ owner: owner.address, walletId: w.id, signature, nonce: typed.message.nonce, deadline: typed.message.deadline });
  tx('createWithSignature (executor paid gas)', made.txHash);
  }
  line(`   desk ${made.desk} — owner ${await publicClient.readContract({ address: made.desk, abi: DESK_ABI, functionName: 'owner' })}, operator active: ${await publicClient.readContract({ address: made.desk, abi: DESK_ABI, functionName: 'isOperator', args: [made.operator] })}`);

  step('3', 'Owner funds the desk with 150 AUSD and opens its Perpl account');
  if ((await deskState(owner.address)).accountId === '0') {
    if ((await ausdOf(made.desk)) < 150_000_000n) {
      await send('AUSD.transfer(desk, 150)', { to: net.collateral, abi: erc20Abi, functionName: 'transfer', args: [made.desk, 150_000_000n] });
    }
    await send('desk.createAccount(150 AUSD)', { to: made.desk, abi: DESK_ABI, functionName: 'createAccount', args: [150_000_000n] });
  } else {
    line('   account already open');
  }
  let st = await deskState(owner.address);
  line(`   Perpl account #${st.accountId}: balance ${st.balance} AUSD, operator active ${st.operatorActive}`);
  if (!st.operatorActive) {
    line("   xorr's operator was removed by an earlier run — the owner adds it back (resume)");
    const c = await operatorConsent(owner.address);
    await send('desk.addOperator(operator, consent)', { to: made.desk, abi: DESK_ABI, functionName: 'addOperator', args: [c.operator, BigInt(c.deadline), c.signature] });
    st = await deskState(owner.address);
    line(`   operator active: ${st.operatorActive}`);
  }
  for (const m of st.allowlistMissing) {
    line(`   the desk does not allow the current ${m.name} (${m.selector}) — the owner enables it`);
    await send(`desk.setOperatorAllowlist(${m.selector}, true)`, { to: made.desk, abi: DESK_ABI, functionName: 'setOperatorAllowlist', args: [m.selector, true] });
  }

  step('4', 'The agent opens a $100 MON long at 2x through the desk (placePerpOrder)');
  const open = await placePerpOrder({ owner: owner.address, walletId: w.id, perpId: MON_PERP, side: 'open_long', usd: 100, leverage: 2, placedBy: 'Momentum Scout', reason: 'Prove' });
  tx(`execOrder via desk: ${open.status}`, open.txHash);
  if (open.status !== 'filled' || !open.position) fail(`the open did not fill: ${JSON.stringify(open)}`);
  line(`   position: long ${open.position.lots} MON, entry $${open.position.entry}, mark $${open.position.mark}, margin ${open.position.deposit} AUSD, liquidation $${open.position.liquidation?.toFixed(6)} (${((open.position.liqDistance ?? 0) * 100).toFixed(1)}% away)`);

  step('5', 'An order over the $250 per-order cap is refused before signing');
  try {
    await placePerpOrder({ owner: owner.address, walletId: w.id, perpId: MON_PERP, side: 'open_long', usd: 300, leverage: 2, placedBy: 'Momentum Scout' });
    fail('the $300 order was not refused');
  } catch (e) {
    if (!(e instanceof PerplRefusal) || e.code !== 'order_cap') throw e;
    line(`   refused (${e.code}): ${e.message}`);
  }

  step('6', 'The agent closes the long');
  const close = await placePerpOrder({ owner: owner.address, walletId: w.id, perpId: MON_PERP, side: 'close_long', placedBy: 'Momentum Scout', reason: 'Prove' });
  tx(`execOrder CloseLong via desk: ${close.status}`, close.txHash);
  if (close.status !== 'filled' || close.position) fail(`the close did not flatten: ${JSON.stringify(close)}`);
  st = await deskState(owner.address);
  line(`   flat. Perpl balance ${st.balance} AUSD`);

  step('7', "The owner removes xorr's operator — the one-tap stop");
  await send('desk.removeOperator(operator)', { to: made.desk, abi: DESK_ABI, functionName: 'removeOperator', args: [made.operator] });
  try {
    await placePerpOrder({ owner: owner.address, walletId: w.id, perpId: MON_PERP, side: 'open_long', usd: 50, leverage: 2, placedBy: 'Momentum Scout' });
    fail('an order was placed after the operator was removed');
  } catch (e) {
    if (!(e instanceof PerplRefusal) || e.code !== 'operator_removed') throw e;
    line(`   executor refused (${e.code}): ${e.message}`);
  }
  const op = operatorFor(owner.address);
  const m = (await perplMarkets()).find((x) => x.id === MON_PERP)!;
  const raw = execOrderData(planOrder(m, 'open_long', 50, 200), await publicClient.getBlockNumber(), BigInt(Date.now()));
  const rawHash = await sendWhenSpendable(() => op.wallet.sendTransaction({ account: op.account, chain, to: made.desk, data: raw, gas: 120_000n }));
  const rawReceipt = await publicClient.waitForTransactionReceipt({ hash: rawHash, timeout: 90_000 });
  tx(`raw operator order, mined: ${rawReceipt.status}`, rawHash);
  if (rawReceipt.status !== 'reverted') fail('the removed operator could still trade');
  line("   Perpl's DelegatedAccount refused it on chain (OnlyOwnerOrOperator)");

  step('8', 'The owner withdraws everything: it can only go to the owner');
  st = await deskState(owner.address);
  const before = await ausdOf(owner.address);
  await send(`desk.withdrawCollateral(${st.balance})`, { to: made.desk, abi: DESK_ABI, functionName: 'withdrawCollateral', args: [BigInt(Math.round(st.balance * 1e6))] });
  const after = await ausdOf(owner.address);
  line(`   owner AUSD ${Number(before) / 1e6} → ${Number(after) / 1e6} (+${(Number(after - before) / 1e6).toFixed(6)})`);
  if (after <= before) fail('nothing came back to the owner');

  line(`\nPROOF PASSED on ${CHAIN_KEY}: desk ${made.desk}, owner ${owner.address}.`);
} catch (e) {
  fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
} finally {
  await pool.end().catch(() => undefined);
}
process.exit(0);
