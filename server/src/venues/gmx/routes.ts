/**
 * GMX V2 reads for the app (PLAN.md P2.3/P2.5, P4.5).
 *
 *   GET /gmx/markets                 the four xorr markets, decoded: mark, OI, liquidity, funding/borrowing/net %/hour
 *   GET /gmx/orders?owner=0x…        the owner's GMX orders, pending ones re-read from the chain first
 *   GET /gmx/positions?owner=0x…     the owner's open GMX positions, read from GMX's Reader now
 *
 * `/gmx/markets` is market data: public in spirit, like `/market/*` — to serve it signed-out, add it to
 * `PUBLIC_PATHS` in auth/middleware.ts (not done here: that file is shared). The other two are about a person's
 * money: each starts with `requireUser`, and `owner` must be one of the caller's own wallets (default: the current
 * one). An agent key is refused by `requireUser` like on every person's route.
 *
 * Reads go to GMX on Arbitrum One — the executor's own node on `arbitrum` / `arbitrum-fork`, or `GMX_RPC` when this
 * executor serves another chain. Anywhere else the answer is a 409 that says so, never an empty list that reads as
 * "no positions".
 */
import { Hono, type Context } from 'hono';
import { createPublicClient, getAddress, http, isAddress, type PublicClient } from 'viem';
import { arbitrum } from 'viem/chains';
import { requireUser } from '../../auth/middleware.js';
import { z } from 'zod';
import { GmxNotHere, closeHedge, hedgeSetup, openHedge } from './actions.js';
import { GmxApiUnavailable, fetchMarkets, type MarketView } from './api.js';
import { accountPositions, type PositionView } from './tracker.js';
import type { GmxOrderRow } from './store.js';

type GmxClient = Pick<PublicClient, 'readContract' | 'getLogs' | 'getBlockNumber' | 'getTransactionReceipt'>;

export type GmxRouteDeps = {
  /** The caller's wallet addresses, current first. */
  callerWallets: (c: Context) => Promise<string[]>;
  /** A client on Arbitrum One (or its fork), or why there is none. */
  client: () => Promise<GmxClient | { unavailable: string }>;
  markets: () => Promise<MarketView[]>;
  orders: (client: GmxClient, owner: string) => Promise<{ orders: GmxOrderRow[]; stale: string[] }>;
  positions: (client: GmxClient, owner: `0x${string}`) => Promise<PositionView[]>;
};

async function defaultClient(): Promise<GmxClient | { unavailable: string }> {
  const { CHAIN_KEY } = await import('../../evm/chains.js');
  if (CHAIN_KEY === 'arbitrum' || CHAIN_KEY === 'arbitrum-fork') return (await import('../../evm/client.js')).publicClient;
  const rpc = process.env.GMX_RPC;
  if (rpc) return createPublicClient({ chain: arbitrum, transport: http(rpc) });
  return { unavailable: `GMX V2 runs on Arbitrum One; this executor serves ${CHAIN_KEY} and GMX_RPC is not set.` };
}

export const defaultGmxDeps: GmxRouteDeps = {
  callerWallets: async (c) => {
    const { walletsFor } = await import('../../routes/wallet-context.js');
    return (await walletsFor(c)).map((w) => w.address);
  },
  client: defaultClient,
  markets: () => fetchMarkets(),
  orders: async (client, owner) => (await import('./store.js')).listGmxOrdersFresh(client, owner),
  positions: (client, owner) => accountPositions(client, owner),
};

/** bigint → string, so a position's exact GMX values survive JSON. */
function jsonSafe<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));
}

/** The owner asked for, which must be the caller's own. Returns a Response when it is not. */
async function ownerFor(c: Context, deps: GmxRouteDeps): Promise<`0x${string}` | Response> {
  requireUser(c);
  const mine = (await deps.callerWallets(c)).filter((a) => isAddress(a)).map((a) => getAddress(a));
  const asked = c.req.query('owner');
  if (!asked) {
    if (!mine[0]) return c.json({ error: 'no_wallet', detail: 'No wallet for this user. POST /wallet/create first.' }, 409);
    return mine[0];
  }
  if (!isAddress(asked)) return c.json({ error: 'invalid_request', detail: `owner: ${asked} is not an address` }, 400);
  const owner = getAddress(asked);
  if (!mine.includes(owner)) return c.json({ error: 'forbidden', detail: 'owner is not one of your wallets.' }, 403);
  return owner;
}

export function createGmxRoutes(deps: GmxRouteDeps = defaultGmxDeps): Hono {
  const app = new Hono();

  app.get('/gmx/markets', async (c) => {
    try {
      return c.json({ markets: await deps.markets() });
    } catch (e) {
      if (e instanceof GmxApiUnavailable) return c.json({ error: 'gmx_api_unavailable', detail: e.message }, 503);
      throw e;
    }
  });

  app.get('/gmx/orders', async (c) => {
    const owner = await ownerFor(c, deps);
    if (owner instanceof Response) return owner;
    const client = await deps.client();
    if ('unavailable' in client) return c.json({ error: 'gmx_unavailable_here', detail: client.unavailable }, 409);
    const { orders, stale } = await deps.orders(client, owner);
    return c.json(jsonSafe({ owner, orders, ...(stale.length ? { stale, note: 'These pending orders could not be re-read from the chain just now.' } : {}) }));
  });

  app.get('/gmx/positions', async (c) => {
    const owner = await ownerFor(c, deps);
    if (owner instanceof Response) return owner;
    const client = await deps.client();
    if ('unavailable' in client) return c.json({ error: 'gmx_unavailable_here', detail: client.unavailable }, 409);
    return c.json(jsonSafe({ owner, positions: await deps.positions(client, owner), source: 'GMX Reader.getAccountPositions' }));
  });

  /*
   * Hedges from the product: the owner's setup to sign, then open and close — placed by the hedge agent (its own wallet,
   * a GMX subaccount of the owner). Owner-scoped: the position is always the signed-in wallet's.
   */
  app.get('/gmx/hedge/setup', async (c) => {
    const owner = await ownerFor(c, deps);
    if (owner instanceof Response) return owner;
    try {
      return c.json(jsonSafe(await hedgeSetup(owner)));
    } catch (e) {
      if (e instanceof GmxNotHere) return c.json({ error: 'gmx_unavailable_here', detail: e.message }, 409);
      throw e;
    }
  });

  const HedgeBody = z.object({ marketId: z.enum(['ETH-USD', 'BTC-USD']), isLong: z.boolean(), collateralUsd: z.number().min(5).max(10_000).optional(), leverage: z.number().min(1).max(5).optional() });
  app.post('/gmx/hedge/open', async (c) => {
    const owner = await ownerFor(c, deps);
    if (owner instanceof Response) return owner;
    const b = HedgeBody.safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: 'invalid_request', detail: 'Send {marketId: ETH-USD|BTC-USD, isLong, collateralUsd 5–10000, leverage 1–5}.' }, 400);
    try {
      return c.json(jsonSafe(await openHedge({ owner, marketId: b.data.marketId, isLong: b.data.isLong, collateralUsd: b.data.collateralUsd ?? 25, leverage: b.data.leverage ?? 2 })), 201);
    } catch (e) {
      if (e instanceof GmxNotHere) return c.json({ error: 'gmx_unavailable_here', detail: e.message }, 409);
      return c.json({ error: 'refused', detail: e instanceof Error ? e.message : String(e) }, 409);
    }
  });

  app.post('/gmx/hedge/close', async (c) => {
    const owner = await ownerFor(c, deps);
    if (owner instanceof Response) return owner;
    const b = HedgeBody.pick({ marketId: true, isLong: true }).safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: 'invalid_request', detail: 'Send {marketId, isLong}.' }, 400);
    try {
      return c.json(jsonSafe(await closeHedge({ owner, marketId: b.data.marketId, isLong: b.data.isLong })), 201);
    } catch (e) {
      if (e instanceof GmxNotHere) return c.json({ error: 'gmx_unavailable_here', detail: e.message }, 409);
      return c.json({ error: 'refused', detail: e instanceof Error ? e.message : String(e) }, 409);
    }
  });

  return app;
}

/** The router to mount: `app.route('/', gmxRoutes)`. */
export const gmxRoutes = createGmxRoutes();
