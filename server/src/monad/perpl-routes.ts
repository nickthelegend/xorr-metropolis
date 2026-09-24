/**
 * The Perpl desk over HTTP (FEATURES-100 #2–#7, #12, #37, 2026-09-24). Everything about a person's desk starts with
 * `requireUser` and acts on the caller's current wallet; the market list is public, like `/market/*`.
 *
 *   GET  /perps/markets            Perpl's open markets now (book top, mark, funding, OI, leverage limits)
 *   GET  /perps/desk               the caller's desk, read from the chain now
 *   POST /perps/desk/create-data   the EIP-712 `Create` the owner signs
 *   POST /perps/desk/create        submit it (the executor pays gas) → the desk
 *   POST /perps/desk/consent       xorr's operator consent, for the owner's `addOperator` (resume)
 *   PUT  /perps/caps               the owner's per-order / per-day / leverage limits for agents
 *   POST /perps/order              an order through the desk by xorr's operator, within the caps
 *   GET  /perps/orders             the orders the agent sent for this owner
 *   POST /perps/fund-test          testnet only: MON for gas and AUSD (Agora's faucet, else the deployment's AUSD reserve)
 */
import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { createWalletClient, erc20Abi, formatEther, getAddress, http, parseAbi, parseEther, type Address } from 'viem';
import { requireUser } from '../auth/middleware.js';
import { chain, CHAIN_KEY, explorerTx, rpcUrl } from '../evm/chains.js';
import { publicClient } from '../evm/client.js';
import { faucetAccount } from '../evm/gasDrip.js';
import { monadFees, sendWhenSpendable } from '../evm/spendable.js';
import { one, query } from '../db/index.js';
import { currentWallet } from '../routes/wallet-context.js';
import {
  PerplRefusal,
  createDesk,
  createTypedData,
  deskState,
  operatorConsent,
  perplMarkets,
  placePerpOrder,
  recentOrders,
  setCaps,
} from './perpl-desk.js';
import { perplHere } from './perpl-chain.js';

export const perplRoutes = new Hono();

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

async function caller(c: Context): Promise<{ owner: Address; walletId: string }> {
  requireUser(c);
  const w = await currentWallet(c);
  if (!w) throw new PerplRefusal('no_wallet', 'No wallet for this user yet. Finish sign-in first.');
  return { owner: getAddress(w.address), walletId: w.id };
}

/** A named refusal as the screen shows it; anything unforeseen as a named 502, never a raw client error dumped on a person. */
function refusal(c: Context, e: unknown) {
  if (e instanceof PerplRefusal) return c.json({ error: e.code, detail: e.message }, e.status);
  const short = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message).split('\n')[0]! : String(e);
  console.warn(`[perpl] ${c.req.method} ${c.req.path}: ${e instanceof Error ? e.message : String(e)}`);
  return c.json({ error: 'perpl_failed', detail: `That did not go through: ${short}` }, 502);
}

perplRoutes.get('/perps/markets', async (c) => {
  if (!perplHere()) return c.json({ error: 'perpl_not_here', detail: `Perpl runs on Monad mainnet and testnet; this executor serves ${CHAIN_KEY}.` }, 409);
  return c.json({ network: perplHere()!.name, markets: await perplMarkets() });
});

perplRoutes.get('/perps/desk', async (c) => {
  try {
    const { owner } = await caller(c);
    return c.json(json(await deskState(owner)));
  } catch (e) {
    return refusal(c, e);
  }
});

perplRoutes.post('/perps/desk/create-data', async (c) => {
  try {
    const { owner } = await caller(c);
    return c.json(json(await createTypedData(owner)));
  } catch (e) {
    return refusal(c, e);
  }
});

const CreateInput = z.object({
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  nonce: z.string().regex(/^\d+$/),
  deadline: z.string().regex(/^\d+$/),
});

perplRoutes.post('/perps/desk/create', async (c) => {
  try {
    const { owner, walletId } = await caller(c);
    const body = CreateInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_request', detail: body.error.issues.map((i) => i.message).join('; ') }, 400);
    return c.json(json(await createDesk({ owner, walletId, signature: body.data.signature as `0x${string}`, nonce: body.data.nonce, deadline: body.data.deadline })));
  } catch (e) {
    return refusal(c, e);
  }
});

perplRoutes.post('/perps/desk/consent', async (c) => {
  try {
    const { owner } = await caller(c);
    return c.json(json(await operatorConsent(owner)));
  } catch (e) {
    return refusal(c, e);
  }
});

const CapsInput = z.object({
  maxOrderUsd: z.number().positive().max(100_000),
  maxDayUsd: z.number().positive().max(1_000_000),
  maxLeverage: z.number().min(1).max(50),
});

perplRoutes.put('/perps/caps', async (c) => {
  try {
    const { owner } = await caller(c);
    const body = CapsInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_request', detail: body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    if (body.data.maxOrderUsd > body.data.maxDayUsd) return c.json({ error: 'invalid_request', detail: 'The per-order limit cannot be above the daily limit.' }, 400);
    await setCaps(owner, body.data);
    return c.json(json(await deskState(owner)));
  } catch (e) {
    return refusal(c, e);
  }
});

const OrderInput = z.object({
  perpId: z.number().int().positive(),
  side: z.enum(['open_long', 'open_short', 'close_long', 'close_short']),
  usd: z.number().positive().max(1_000_000).optional(),
  leverage: z.number().min(1).max(50).optional(),
  agent: z.string().min(1).max(40).optional(),
});

perplRoutes.post('/perps/order', async (c) => {
  try {
    const { owner, walletId } = await caller(c);
    const body = OrderInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_request', detail: body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    const r = await placePerpOrder({ owner, walletId, ...body.data, placedBy: body.data.agent ?? 'owner' });
    return c.json(json(r));
  } catch (e) {
    return refusal(c, e);
  }
});

perplRoutes.get('/perps/orders', async (c) => {
  try {
    const { owner } = await caller(c);
    return c.json(json({ orders: await recentOrders(owner) }));
  } catch (e) {
    return refusal(c, e);
  }
});

const AGORA_FAUCET = '0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C' as Address;
const TEST_AUSD = 500_000_000n;
// The owner's six desk transactions (fund, open, allow, stop, resume, withdraw) cost ~0.07 MON on testnet.
const TEST_GAS = parseEther('0.08');

/**
 * Testnet only: MON for gas and AUSD to trade. AUSD comes from Agora's own faucet when it will serve; it is rate-limited for
 * everyone at once (`MaxFrequencyExceeded()`), so otherwise from this deployment's AUSD reserve — Agora testnet AUSD
 * claimed from that faucet earlier — by an ordinary transfer. Once a day per wallet (recorded in `faucet_claims`).
 */
perplRoutes.post('/perps/fund-test', async (c) => {
  try {
    const { owner, walletId } = await caller(c);
    if (CHAIN_KEY !== 'monad-testnet') return c.json({ error: 'not_testnet', detail: 'Test funds are only on Monad testnet.' }, 409);
    const faucet = faucetAccount();
    if (!faucet) return c.json({ error: 'no_faucet_key', detail: 'This deployment has no faucet key, so it has no test funds to send.' }, 409);
    const recent = await one<{ at: Date }>(
      `SELECT claimed_at AS at FROM faucet_claims WHERE wallet_id = $1 AND chain = $2 AND claimed_at > now() - interval '1 day' ORDER BY claimed_at DESC LIMIT 1`,
      [walletId, CHAIN_KEY],
    );
    if (recent) return c.json({ error: 'claimed_recently', detail: `Test funds were sent to this wallet at ${recent.at.toISOString()}; ask again a day later.`, retryAt: new Date(recent.at.getTime() + 86_400_000).toISOString() }, 409);
    const wallet = createWalletClient({ account: faucet, chain, transport: http(rpcUrl) });
    const fees = await monadFees(publicClient, chain.id);
    const sent: { what: string; tx: string; explorer: string }[] = [];
    const gasHave = await publicClient.getBalance({ address: owner });
    const gasAdded = gasHave < TEST_GAS ? TEST_GAS - gasHave : 0n;
    /*
     * The faucet must be able to pay before it is asked to.
     *
     * With its key down to 0.0074 MON this sent anyway: every attempt was refused ("insufficient balance"),
     * `sendWhenSpendable` kept retrying, and the button answered 502 after 44.8 s (2026-09-24) — a person waited most of a
     * minute to be told nothing. Monad bills the gas limit, so the two sends' limits are what it must hold beside the MON
     * it gives away; short of that, it says so at once, with what it holds and where test MON comes from.
     */
    const feeBudget = (21_000n + 150_000n) * ((fees as { maxFeePerGas?: bigint }).maxFeePerGas ?? 0n);
    const faucetHas = await publicClient.getBalance({ address: faucet.address });
    if (faucetHas < gasAdded + feeBudget) {
      return c.json(
        {
          error: 'faucet_empty',
          detail: `The test faucet is out of MON: it holds ${formatEther(faucetHas).slice(0, 8)} MON and needs ${formatEther(gasAdded + feeBudget).slice(0, 6)} to send yours. Get test MON at faucet.monad.xyz for ${owner}, or ask this deployment's operator to top up ${faucet.address}.`,
          faucet: faucet.address,
          faucetMon: Number(formatEther(faucetHas)),
        },
        409,
      );
    }
    if (gasAdded > 0n) {
      const h = await sendWhenSpendable(() => wallet.sendTransaction({ account: faucet, chain, to: owner, value: TEST_GAS - gasHave, gas: 21000n, ...fees }));
      await publicClient.waitForTransactionReceipt({ hash: h });
      sent.push({ what: `${Number(TEST_GAS - gasHave) / 1e18} MON for gas`, tx: h, explorer: explorerTx(h) });
    }
    const net = perplHere()!;
    const agora = parseAbi(['function requestFunds(address)', 'error MaxFrequencyExceeded()']);
    const agoraServes = await publicClient.simulateContract({ account: faucet, address: AGORA_FAUCET, abi: agora, functionName: 'requestFunds', args: [owner] }).then(() => true, () => false);
    const h2 = agoraServes
      ? await sendWhenSpendable(() => wallet.writeContract({ account: faucet, chain, address: AGORA_FAUCET, abi: agora, functionName: 'requestFunds', args: [owner], ...fees }))
      : await sendWhenSpendable(() => wallet.writeContract({ account: faucet, chain, address: net.collateral, abi: erc20Abi, functionName: 'transfer', args: [owner, TEST_AUSD], ...fees }));
    const r2 = await publicClient.waitForTransactionReceipt({ hash: h2 });
    if (r2.status !== 'success') return c.json({ error: 'faucet_reverted', detail: `The AUSD transfer reverted (${h2}).` }, 502);
    sent.push({ what: agoraServes ? "AUSD from Agora's faucet" : '500 AUSD (Agora testnet) from the reserve', tx: h2, explorer: explorerTx(h2) });
    await query(
      `INSERT INTO faucet_claims (id, chain, wallet_id, address, paid_by, usdc_raw, usdc_tx, eth_added_wei, claimed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
      [randomUUID(), CHAIN_KEY, walletId, owner, agoraServes ? AGORA_FAUCET : faucet.address, agoraServes ? '0' : TEST_AUSD.toString(), h2, gasAdded.toString()],
    );
    return c.json({ sent });
  } catch (e) {
    return refusal(c, e);
  }
});
