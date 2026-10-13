/**
 * Team-seeded activity on Monad testnet (13 Oct 2026; the owner: "seed activity").
 *
 * A new app has nothing to watch. Three team wallets — made here, labelled `team-seed` everywhere they appear — each do
 * what a user does: fund from xorr's own faucet, give the permission (Perpl's DelegatedAccount, created from the owner's
 * signature with xorr's operator, and per-order limits), put a trade to the council, and, when it approves, trade
 * through the desk. The rounds are recorded with `convened_by = 'team-seed'`, which is what `GET /council/public/:id`
 * serves, so a visitor can replay one without signing up. Real transactions; nothing here is a fixture.
 *
 * Run against the hosted database (the rounds must be where the hosted app reads them):
 *   set -a; . ./.env.testnet-monad; set +a; DATABASE_URL=<hosted> SEEDS=3 npx tsx src/seed-activity.ts
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createWalletClient, erc20Abi, formatEther, http, parseEther, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { CHAIN_KEY, chain, rpcUrl } from './evm/chains.js';
import { publicClient } from './evm/client.js';
import { faucetAccount } from './evm/gasDrip.js';
import { monadFees, sendWhenSpendable } from './evm/spendable.js';
import { one, pool } from './db/index.js';
import { DESK_ABI, perplHere } from './monad/perpl-chain.js';
import { createDesk, createTypedData, deskState, setCaps } from './monad/perpl-desk.js';
import { convene, setCouncilExecutor } from './council/convene.js';
import { councilExecutor } from './executor/council-executor.js';

if (CHAIN_KEY !== 'monad-testnet') throw new Error(`XORR_CHAIN=${CHAIN_KEY}; this seeds Monad testnet only.`);
const net = perplHere()!;
const SEEDS = Number(process.env.SEEDS ?? 3);
const faucet = faucetAccount();
if (!faucet) throw new Error('FAUCET_PRIVATE_KEY is not set');
const fw = createWalletClient({ account: faucet, chain, transport: http(rpcUrl) });
const out: string[] = [];
const say = (s: string) => {
  console.log(s);
  out.push(s);
};
const ausdOf = (a: Address) => publicClient.readContract({ address: net.collateral, abi: erc20Abi, functionName: 'balanceOf', args: [a] });

async function wait(hash: Hex, label: string) {
  const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  say(`  ${label}: ${r.status} ${hash}`);
  if (r.status !== 'success') throw new Error(`${label} reverted`);
}

setCouncilExecutor(councilExecutor);

for (let i = 1; i <= SEEDS; i++) {
  const file = path.join(import.meta.dirname, `../.keys/seed-owner-${i}.key`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, generatePrivateKey(), { mode: 0o600 });
  }
  const owner = privateKeyToAccount(fs.readFileSync(file, 'utf8').trim() as Hex);
  const ow = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
  say(`\nSeed ${i}: team wallet ${owner.address}`);

  // Gas and AUSD from xorr's own faucet key: 0.08 MON and 200 AUSD a wallet.
  const have = await publicClient.getBalance({ address: owner.address });
  if (have < parseEther('0.06')) await wait(await sendWhenSpendable(() => fw.sendTransaction({ account: faucet, chain, to: owner.address, value: parseEther('0.08') - have, gas: 21000n })), `${formatEther(parseEther('0.08') - have)} MON for gas`);
  if ((await ausdOf(owner.address)) < 150_000_000n) await wait(await sendWhenSpendable(() => fw.writeContract({ account: faucet, chain, address: net.collateral, abi: erc20Abi, functionName: 'transfer', args: [owner.address, 200_000_000n] })), '200 AUSD');

  const w =
    (await one<{ id: string }>(`SELECT id FROM wallets WHERE lower(address) = lower($1) AND cluster = $2 LIMIT 1`, [owner.address, CHAIN_KEY])) ??
    (await one<{ id: string }>(`INSERT INTO wallets (id, user_id, address, kind, cluster, active_at) VALUES ($1, $2, $3, 'embedded', $4, now()) RETURNING id`, [
      randomUUID(),
      `team-seed-${i}`,
      owner.address,
      CHAIN_KEY,
    ]))!;

  // The permission: Perpl's desk, created from the owner's own signature with xorr's operator, and its limits.
  let st = await deskState(owner.address);
  if (!st.desk) {
    const typed = await createTypedData(owner.address);
    const signature = await owner.signTypedData({
      domain: typed.domain,
      types: typed.types,
      primaryType: 'Create',
      message: { owner: owner.address, operator: typed.message.operator as Address, nonce: BigInt(typed.message.nonce), deadline: BigInt(typed.message.deadline) },
    });
    const made = await createDesk({ owner: owner.address, walletId: w.id, signature, nonce: typed.message.nonce, deadline: typed.message.deadline });
    say(`  permission — desk ${made.desk} created from the owner's signature (createWithSignature): ${made.txHash}`);
    st = await deskState(owner.address);
  }
  if (st.accountId === '0') {
    const fees = await monadFees(publicClient, chain.id);
    if ((await ausdOf(st.desk!)) < 150_000_000n) await wait(await ow.writeContract({ address: net.collateral, abi: erc20Abi, functionName: 'transfer', args: [st.desk!, 150_000_000n], gas: 80_000n, ...fees }), 'AUSD.transfer(desk, 150)');
    await wait(await ow.writeContract({ address: st.desk!, abi: DESK_ABI, functionName: 'createAccount', args: [150_000_000n], gas: 600_000n, ...fees }), 'desk.createAccount(150 AUSD)');
  }
  // A desk made before Perpl's current execOrder does not let the operator call it; the owner enables it (one tx).
  for (const m of (await deskState(owner.address)).allowlistMissing) {
    const fees = await monadFees(publicClient, chain.id);
    await wait(await ow.writeContract({ address: st.desk!, abi: DESK_ABI, functionName: 'setOperatorAllowlist', args: [m.selector, true], gas: 120_000n, ...fees }), `desk.setOperatorAllowlist(${m.name})`);
  }
  await setCaps(owner.address, { maxOrderUsd: 100, maxDayUsd: 300, maxLeverage: 2 });
  say('  limits: $100 an order, $300 a day, 2x');

  // The council, then the trade it decides.
  const round = await convene({ walletId: w.id, owner: owner.address, proposal: { side: 'buy', symbol: 'BTC', usd: 50 }, convenedBy: 'team-seed' });
  say(`  council round ${round.id}: ${round.summary} → ${round.outcome}${round.txHash ? ` ${round.txHash}` : ''}${round.outcomeDetail ? ` (${round.outcomeDetail})` : ''}`);
}

fs.writeFileSync(path.join(import.meta.dirname, '../../docs/evidence/seed-13oct.log'), `${out.join('\n')}\n`);
await pool.end();
