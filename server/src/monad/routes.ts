/**
 * Monad market facts over HTTP, for the app and the council (PLAN.md P2.2, P3.1). Both are public, as the rest of
 * `/market/*` is: a price from three public sources and an exchange's public market list are not user data.
 *
 *   GET /monad/crosscheck — MON priced by Uniswap v3, Kuru and Chainlink on Monad mainnet, and the widest gap.
 *   GET /monad/perpl      — Perpl's markets: mark, book, open interest, raw funding, and where trading is not offered.
 *   GET /monad/feed/:sym  — one Chainlink feed on Monad mainnet (MON, ETH, BTC, USDC, AUSD): price, age, stale.
 */
import { Hono } from 'hono';
import { crosscheckMon } from './crosscheck.js';
import { perplContext } from './perpl.js';
import { CHAINLINK_MONAD, readFeed, type ChainlinkSymbol } from './chainlink.js';

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
