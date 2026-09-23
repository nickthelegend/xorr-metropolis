/**
 * Monad market facts over HTTP, for the app and the council (PLAN.md P2.2, P3.1). Both are public, as the rest of
 * `/market/*` is: a price from three public sources and an exchange's public market list are not user data.
 *
 *   GET /monad/crosscheck — MON priced by Uniswap v3, Kuru and Chainlink on Monad mainnet, and the widest gap.
 *   GET /monad/perpl      — Perpl's markets: mark, book, open interest, raw funding, and where trading is not offered.
 */
import { Hono } from 'hono';
import { crosscheckMon } from './crosscheck.js';
import { perplContext } from './perpl.js';

export const monadRoutes = new Hono();

monadRoutes.get('/monad/crosscheck', async (c) => c.json(await crosscheckMon()));

monadRoutes.get('/monad/perpl', async (c) => {
  try {
    return c.json(await perplContext());
  } catch (e) {
    return c.json({ error: 'perpl_unavailable', detail: e instanceof Error ? e.message : String(e) }, 502);
  }
});
