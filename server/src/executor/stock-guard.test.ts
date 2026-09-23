/**
 * The Stock Token gate the executor runs before any stock leg on Robinhood Chain (PLAN.md P1.7, 2026-09-23): that it
 * asks only where it applies, that a refusal carries its reason and lands in the audit trail, that a gate it cannot read
 * refuses, and — on the snapshot fork — which inputs it reads from where (see the file header of `stock-guard.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ append: vi.fn(async () => ({})), check: vi.fn() }));
vi.mock('../audit/log.js', () => ({ append: h.append }));
vi.mock('../db/index.js', () => ({ query: vi.fn(async () => []) }));
vi.mock('../robinhood/guards.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../robinhood/guards.js')>()),
  stockTradeCheck: h.check,
}));

const NVDA = '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC';

async function load(chain: string) {
  vi.resetModules();
  vi.stubEnv('XORR_CHAIN', chain);
  vi.stubEnv('ALLOW_MAINNET', chain === 'robinhood' ? 'yes' : '');
  const tokens = await import('../venues/tokens.js');
  if (chain.startsWith('robinhood')) {
    tokens.registerToken('NVDA', { address: NVDA, decimals: 18, toSettlement: [{ via: 'USDG', fee: 500 }], kind: 'stock' });
  }
  return {
    ...(await import('./stock-guard.js')),
    guards: await import('../robinhood/guards.js'),
    chain: await import('../robinhood/chain.js'),
    api: await import('../robinhood/api.js'),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  h.append.mockClear();
  h.check.mockReset();
});

describe('where the gate applies', () => {
  it('asks nothing off Robinhood Chain, and nothing for a token that is not a Stock Token', async () => {
    const off = await load('arbitrum-fork');
    expect(await off.stockGuard({ symbol: 'WETH', side: 'buy', usd: 50 })).toEqual({ ok: true, checked: false });
    const on = await load('robinhood-fork');
    expect(await on.stockGuard({ symbol: 'USDG', side: 'buy', usd: 50 })).toEqual({ ok: true, checked: false });
    expect(h.check).not.toHaveBeenCalled();
  });

  it('checks a Stock Token by its registry name, however the caller spelled it', async () => {
    const g = await load('robinhood-fork');
    h.check.mockResolvedValue({ ok: true, detail: { symbol: 'NVDA', side: 'buy', usdg: 50, message: 'ok' } });
    expect(await g.stockGuard({ symbol: 'nvda', side: 'buy', usd: 50 })).toMatchObject({ ok: true, checked: true });
    expect(h.check).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'NVDA', side: 'buy', usdg: 50 }), expect.anything());
  });
});

describe('a refusal', () => {
  it('names its reason, carries its numbers, and is written to the trail when a wallet is named', async () => {
    const g = await load('robinhood-fork');
    h.check.mockResolvedValue({
      ok: false,
      reason: 'closed',
      detail: { symbol: 'NVDA', side: 'buy', usdg: 50, message: 'Weekend: the US market is closed until Sun 20:00 ET', session: 'closed' },
    });
    const out = await g.stockGuard({ symbol: 'NVDA', side: 'buy', usd: 50, walletId: 'w-1', actor: 'Momentum' });
    expect(out).toMatchObject({ ok: false, reason: 'stock_closed', message: 'Weekend: the US market is closed until Sun 20:00 ET' });
    expect(h.append).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: 'w-1',
        agent: 'Momentum',
        action: 'Refused buying NVDA',
        kind: 'block',
        payload: expect.objectContaining({ reason: 'stock_closed', guard: expect.objectContaining({ session: 'closed' }) }),
      }),
    );
  });

  it('is not written anywhere when no wallet is named — the caller audits it (run.ts finishBlocked)', async () => {
    const g = await load('robinhood-fork');
    h.check.mockResolvedValue({ ok: false, reason: 'halted', detail: { symbol: 'NVDA', side: 'sell', usdg: 50, message: 'halted' } });
    expect((await g.stockGuard({ symbol: 'NVDA', side: 'sell', usd: 50 })).ok).toBe(false);
    expect(h.append).not.toHaveBeenCalled();
  });

  it('refuses when the checks cannot be read: an unanswered question is not a pass', async () => {
    const g = await load('robinhood-fork');
    h.check.mockRejectedValue(new Error('api.robinhood.com 503'));
    const out = await g.stockGuard({ symbol: 'NVDA', side: 'buy', usd: 50, walletId: 'w-1' });
    expect(out).toMatchObject({ ok: false, reason: 'stock_unreadable' });
    expect(out.ok === false && out.message).toContain('api.robinhood.com 503');
    expect(h.append).toHaveBeenCalledTimes(1);
  });
});

describe('where the inputs are read', () => {
  it('on Robinhood Chain: everything live', async () => {
    const g = await load('robinhood');
    expect(g.guardDeps()).toBe(g.guards.liveGuardDeps);
  });

  it('on the snapshot fork: session, halt and the Chainlink feed live; the pool and the quote from the fork itself', async () => {
    const g = await load('robinhood-fork');
    const deps = g.guardDeps();
    expect(deps).toBe(g.forkGuardDeps);
    // The live Robinhood Chain feed — the snapshot node carries none.
    expect(deps.chainlink).toBe(g.chain.chainlinkPrice);
    expect(deps.asset).toBe(g.api.fetchAsset);
    expect(deps.price).toBe(g.api.fetchPrice);
    // The pool the fill hits, not the live chain's.
    expect(deps.pool).not.toBe(g.guards.liveGuardDeps.pool);
    expect(deps.quoteBuy).not.toBe(g.guards.liveGuardDeps.quoteBuy);
    expect(deps.quoteSell).not.toBe(g.guards.liveGuardDeps.quoteSell);
  });
});
