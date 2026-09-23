import { afterEach, describe, expect, it, vi } from 'vitest';
import assetsFixture from './fixtures/assets.json';
import corpFixture from './fixtures/corporate-actions.json';
import nvdaFixture from './fixtures/prices-nvda.json';
import {
  assetsResponseSchema,
  clearRobinhoodApiCaches,
  corporateActionsResponseSchema,
  describeCorporateAction,
  fetchAssets,
  fetchPrice,
  openCorporateActions,
  pendingMultiplierOf,
  pricesResponseSchema,
  toWad,
  tokenPrice,
} from './api.js';
import { RobinhoodHttpError } from './http.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

afterEach(() => {
  vi.unstubAllGlobals();
  clearRobinhoodApiCaches();
});

describe('schemas against the live responses captured 2026-09-23', () => {
  it('parses /rhj/assets, including the real tradingCapabilities shape and empty pendingMultiplier', () => {
    const assets = assetsResponseSchema.parse(assetsFixture).assets;
    const nvda = assets.find((a) => a.tokenSymbol === 'NVDA')!;
    expect(nvda.deployments[0]).toMatchObject({ chainId: 4663, contractAddress: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC' });
    expect(nvda.tradingCapabilities.overnight.fractional).toBe('TRADING_STATUS_TRADABLE');
    expect(nvda.pendingMultiplier).toBe('');
    expect(pendingMultiplierOf(nvda)).toBeUndefined();
  });

  it('parses /rhj/prices/NVDA and converts the underlying price to a per-token price', () => {
    const q = pricesResponseSchema.parse(nvdaFixture).quotes[0]!;
    expect(q.isTradingHalt).toBe(false);
    const p = tokenPrice(q, '1.000775159164630595');
    expect(p.bid).toBeCloseTo(228.57 * 1.000775159164630595, 6);
    expect(p.mid).toBeCloseTo(((228.57 + 228.61) / 2) * 1.000775159164630595, 6);
  });

  it('parses /rhj/corporate-actions and lists only the open ones', () => {
    const actions = corporateActionsResponseSchema.parse(corpFixture).corpActions;
    expect(openCorporateActions(actions, 'META')).toHaveLength(1);
    expect(openCorporateActions(actions, 'UPS')).toHaveLength(0); // completed
    expect(describeCorporateAction(openCorporateActions(actions, 'META')[0]!)).toBe(
      'META cash dividend of $0.525/share, processing 2026-09-28 (in progress)',
    );
  });

  it('rejects a response that does not match', () => {
    expect(() => assetsResponseSchema.parse({ assets: [{ tokenSymbol: 'X' }] })).toThrow();
  });
});

describe('pendingMultiplierOf', () => {
  it('surfaces a scheduled multiplier change', () => {
    const a = structuredClone(assetsResponseSchema.parse(assetsFixture).assets[0]!);
    a.pendingMultiplier = '2.002296645601428586';
    a.pendingMultiplierEffectiveTime = '2026-10-01T13:30:00Z';
    expect(pendingMultiplierOf(a)).toEqual({ multiplier: '2.002296645601428586', effectiveTime: '2026-10-01T13:30:00Z' });
  });
});

describe('toWad', () => {
  it('scales decimal strings to 1e18 exactly', () => {
    expect(toWad('1.000775159164630595')).toBe(1_000775159164630595n);
    expect(toWad('1')).toBe(10n ** 18n);
    expect(toWad('0.5')).toBe(5n * 10n ** 17n);
  });
});

describe('clients', () => {
  it('retries a 429 (honouring Retry-After) and caches the result', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ code: 8 }, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(json(assetsFixture));
    vi.stubGlobal('fetch', f);
    const a = await fetchAssets();
    const b = await fetchAssets();
    expect(a).toBe(b);
    expect(a.length).toBe(7);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 404 (unknown symbol) and surfaces the API message', async () => {
    const f = vi.fn().mockResolvedValue(json({ code: 5, message: 'no whitelisted asset with symbol "ZZZZ"' }, 404));
    vi.stubGlobal('fetch', f);
    const err = await fetchPrice('zzzz').catch((e) => e);
    expect(err).toBeInstanceOf(RobinhoodHttpError);
    expect(err.status).toBe(404);
    expect(err.message).toContain('no whitelisted asset');
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toBe('https://api.robinhood.com/rhj/prices/ZZZZ');
  });

  it('coalesces concurrent misses into one request', async () => {
    const f = vi.fn().mockImplementation(async () => json(nvdaFixture));
    vi.stubGlobal('fetch', f);
    const [a, b] = await Promise.all([fetchPrice('NVDA'), fetchPrice('nvda')]);
    expect(a).toBe(b);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
