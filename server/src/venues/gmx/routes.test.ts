/**
 * The GMX routes' rules: owner-scoped reads answer only for the caller's own wallets, bigints survive JSON, and a
 * missing GMX says so instead of answering an empty list. Chain and database are injected; the real reads ran in
 * `prove-gmx.ts`.
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { GmxApiUnavailable } from './api.js';
import { createGmxRoutes, type GmxRouteDeps } from './routes.js';

const MINE = '0x1111111111111111111111111111111111111111';
const THEIRS = '0x2222222222222222222222222222222222222222';

function app(over: Partial<GmxRouteDeps> = {}) {
  const deps: GmxRouteDeps = {
    callerWallets: async () => [MINE],
    client: async () => ({}) as never,
    markets: async () => [],
    orders: async (_c, owner) => ({ orders: [{ key: '0xk', owner, status: 'pending' } as never], stale: [] }),
    positions: async (_c, owner) => [{ account: owner, sizeInUsdRaw: 10n ** 32n, sizeInTokens: 36n } as never],
    ...over,
  };
  const a = new Hono();
  a.use(async (c, next) => {
    c.set('user', { userId: 'did:privy:test' });
    await next();
  });
  a.route('/', createGmxRoutes(deps));
  return a;
}

describe('GMX routes', () => {
  it('answers positions for the caller’s own wallet, bigints as strings', async () => {
    const res = await app().request(`/gmx/positions?owner=${MINE}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { owner: string; positions: { sizeInUsdRaw: string }[] };
    expect(body.owner).toBe(MINE);
    expect(body.positions[0]!.sizeInUsdRaw).toBe('100000000000000000000000000000000');
  });

  it('defaults to the current wallet', async () => {
    const res = await app().request('/gmx/orders');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { owner: string }).owner).toBe(MINE);
  });

  it('refuses someone else’s wallet', async () => {
    const res = await app().request(`/gmx/orders?owner=${THEIRS}`);
    expect(res.status).toBe(403);
  });

  it('refuses a malformed owner', async () => {
    expect((await app().request('/gmx/positions?owner=nope')).status).toBe(400);
  });

  it('says GMX is not reachable from this executor rather than answering nothing', async () => {
    const res = await app({ client: async () => ({ unavailable: 'GMX V2 runs on Arbitrum One' }) }).request('/gmx/positions');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/Arbitrum One/);
  });

  it('turns a GMX API outage into a 503 with the reason', async () => {
    const res = await app({
      markets: async () => {
        throw new GmxApiUnavailable('/markets/info', ['arbitrum-api.gmxinfra.io answered HTTP 502']);
      },
    }).request('/gmx/markets');
    expect(res.status).toBe(503);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/HTTP 502/);
  });
});
