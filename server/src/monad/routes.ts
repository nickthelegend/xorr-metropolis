/**
 * Monad market facts over HTTP, for the app and the council (PLAN.md P2.2, P3.1). Both are public, as the rest of
 * `/market/*` is: a price from three public sources and an exchange's public market list are not user data.
 *
 *   GET /monad/crosscheck — MON priced by Uniswap v3, Kuru and Chainlink on Monad mainnet, and the widest gap.
 *   GET /monad/perpl      — Perpl's markets: mark, book, open interest, raw funding, and where trading is not offered.
 *   GET /monad/feed/:sym  — one Chainlink feed on Monad mainnet (MON, ETH, BTC, USDC, AUSD): price, age, stale.
 *   GET /monad/perpl/risk — per Perpl market: funding over a window (paid by longs, APR), price move, OI, spread.
 */
import { Hono } from 'hono';
import { crosscheckMon } from './crosscheck.js';
import { perplContext } from './perpl.js';
import { perplRisk } from './perpl-risk.js';
import { CHAINLINK_MONAD, readFeed, type ChainlinkSymbol } from './chainlink.js';
import { chainCadence, monadPulse, speedReceipt } from './speed.js';
import { currentWallet } from '../routes/wallet-context.js';
import { one } from '../db/index.js';
import { CHAIN_KEY } from '../evm/chains.js';

export const monadRoutes = new Hono();

monadRoutes.get('/monad/crosscheck', async (c) => c.json(await crosscheckMon()));

monadRoutes.get('/monad/perpl', async (c) => {
  try {
    return c.json(await perplContext());
  } catch (e) {
    return c.json({ error: 'perpl_unavailable', detail: e instanceof Error ? e.message : String(e) }, 502);
  }
});

/** One Chainlink feed on Monad (AUSD's peg beside the balance, 2026-09-24). A symbol with no feed is a named 404. */
monadRoutes.get('/monad/feed/:symbol', async (c) => {
  const symbol = c.req.param('symbol').toUpperCase();
  if (!(symbol in CHAINLINK_MONAD)) {
    return c.json({ error: 'no_feed', detail: `No Chainlink feed on Monad for ${symbol}; there are ${Object.keys(CHAINLINK_MONAD).join(', ')}.` }, 404);
  }
  try {
    return c.json(await readFeed(symbol as ChainlinkSymbol));
  } catch (e) {
    return c.json({ error: 'feed_unavailable', detail: e instanceof Error ? e.message.split('\n')[0] : String(e) }, 502);
  }
});

/** Perpl risk, on the Perpl this build trades on (`perpl-risk.ts`). `?hours=` 1–168, default 24. */
monadRoutes.get('/monad/perpl/risk', async (c) => {
  const hours = Number(c.req.query('hours') ?? 24);
  if (!Number.isFinite(hours) || hours <= 0) return c.json({ error: 'bad_hours', detail: 'hours is a number from 1 to 168.' }, 400);
  try {
    return c.json(await perplRisk(hours));
  } catch (e) {
    return c.json({ error: 'perpl_unavailable', detail: e instanceof Error ? e.message.split('\n')[0] : String(e) }, 502);
  }
});

/*
 * The Monad speed receipt (docs/ROADMAP-WIN.md F1). `/monad/pulse` is public — Monad mainnet's head and measured cadence
 * are facts about a public chain — and `/speed/:tx` is a fill of the caller's own, priced at the pulse's rates.
 */
monadRoutes.get('/monad/pulse', async (c) => c.json(await monadPulse()));

monadRoutes.get('/speed/:tx', async (c) => {
  const w = await currentWallet(c);
  if (!w) return c.json({ error: 'not_signed_in' }, 401);
  const hash = c.req.param('tx');
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return c.json({ error: 'bad_hash', detail: 'A transaction hash is 0x and 64 hex characters.' }, 400);
  const row = await one<{ signature: string; tx_ms: number | null; tx_block: string | null; tx_gas_used: string | null; tx_gas_limit: string | null; tx_gas_price: string | null }>(
    `SELECT r.signature, r.tx_ms, r.tx_block::text, r.tx_gas_used::text, r.tx_gas_limit::text, r.tx_gas_price::text
       FROM strategy_runs r JOIN strategies s ON s.id = r.strategy_id
      WHERE lower(r.signature) = lower($1) AND s.wallet_id = $2 AND r.chain = current_setting('xorr.chain_key')`,
    [hash, w.id],
  );
  if (!row) return c.json({ error: 'unknown_fill', detail: 'No fill of yours has that transaction.' }, 404);
  const [pulse, chainMs] = await Promise.all([monadPulse(), chainCadence()]);
  return c.json(speedReceipt(row, pulse, CHAIN_KEY === 'monad-fork', chainMs));
});
