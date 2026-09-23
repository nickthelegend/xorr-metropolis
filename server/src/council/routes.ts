/**
 * The council over HTTP (PLAN.md P3.4, 2026-09-23).
 *
 *   GET  /council/seats            who sits on the council and what each seat asks (public)
 *   GET  /council/rounds           this wallet's rounds, newest first: proposal, every vote, decision, tx hash
 *   GET  /council/rounds/:id       one round with the inputs its votes rest on
 *   POST /council/convene          {side, symbol, usd, dryRun?}: put a trade to the council now; approved rounds execute
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Address } from 'viem';
import { requireWallet } from '../routes/wallet-context.js';
import { IS_MONAD } from '../evm/chains.js';
import { MONAD_SEATS, SEATS } from './personas.js';
import { MONAD_COUNCIL_SYMBOLS } from './monad-inputs.js';
import { convene, roundById, roundsFor } from './convene.js';

export const councilRoutes = new Hono();

// The seats as they sit on this chain, and what the council can be asked about here (Monad: MON, ETH, BTC).
councilRoutes.get('/council/seats', (c) => c.json({ seats: IS_MONAD ? MONAD_SEATS : SEATS, symbols: IS_MONAD ? MONAD_COUNCIL_SYMBOLS : null }));

councilRoutes.get('/council/rounds', async (c) => {
  const w = await requireWallet(c);
  const limit = Number(c.req.query('limit') ?? 50);
  return c.json({ rounds: await roundsFor(w.id, Number.isFinite(limit) ? limit : 50) });
});

councilRoutes.get('/council/rounds/:id', async (c) => {
  const w = await requireWallet(c);
  const round = await roundById(c.req.param('id'), w.id);
  if (!round) return c.json({ error: 'not_found', message: 'No such round on this wallet.' }, 404);
  return c.json({ round });
});

const conveneBody = z.object({
  side: z.enum(['buy', 'sell']),
  symbol: z.string().regex(/^[A-Za-z.]{1,12}$/),
  usd: z.number().positive().max(100_000),
  dryRun: z.boolean().optional(),
});

councilRoutes.post('/council/convene', async (c) => {
  const w = await requireWallet(c);
  const parsed = conveneBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'invalid_proposal', message: 'Send {side: "buy"|"sell", symbol, usd > 0}.', issues: parsed.error.issues }, 400);
  }
  const { side, symbol, usd, dryRun } = parsed.data;
  const round = await convene({ walletId: w.id, owner: w.address as Address, proposal: { side, symbol, usd }, convenedBy: 'user', dryRun });
  return c.json({ round }, 201);
});
