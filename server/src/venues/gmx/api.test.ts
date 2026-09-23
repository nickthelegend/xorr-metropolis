/**
 * The GMX REST decoding, fed responses recorded from arbitrum-api.gmxinfra.io on 2026-09-23 (trimmed to the markets
 * and tokens xorr uses). The fixtures live next to this test and nowhere a product path can reach them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  annualRateToPctPerHour,
  clearGmxApiCache,
  decodeMarkets,
  decodeTickers,
  fetchMarkets,
  gmxGet,
  GmxApiUnavailable,
  priceToUsd,
  usdFrom30,
  usdToPrice,
  type FetchLike,
  type RawMarketInfo,
  type RawTicker,
} from './api.js';

const dir = path.join(import.meta.dirname, '__fixtures__');
const info = JSON.parse(fs.readFileSync(path.join(dir, 'markets-info.2026-09-23.json'), 'utf8')) as { markets: RawMarketInfo[] };
const tickers = JSON.parse(fs.readFileSync(path.join(dir, 'prices-tickers.2026-09-23.json'), 'utf8')) as RawTicker[];

beforeEach(() => clearGmxApiCache());

describe('fixed point', () => {
  it('reads a price as USD per smallest unit × 1e30', () => {
    expect(priceToUsd('2784959467690360', 18)).toBeCloseTo(2784.95946769036, 8);
    expect(priceToUsd('872001586635084725000000000', 8)).toBeCloseTo(87200.1586635, 5);
    expect(priceToUsd('999919538243753600000000', 6)).toBeCloseTo(0.9999195382, 9);
  });

  it('writes a price back exactly', () => {
    expect(usdToPrice('2784.95946769036', 18)).toBe(2784959467690360n);
    expect(usdToPrice('1', 6)).toBe(10n ** 24n);
    expect(usdToPrice('87200', 8)).toBe(87200n * 10n ** 22n);
  });

  it('reads 30-decimal USD', () => {
    expect(usdFrom30('5858803287138183353401087733858072640')).toBeCloseTo(5_858_803.287, 2);
  });

  it('turns an annual rate into percent per hour', () => {
    // 0.0876 a year is 0.001% an hour.
    expect(annualRateToPctPerHour(876n * 10n ** 26n)).toBeCloseTo(0.001, 12);
    expect(annualRateToPctPerHour('-48599760942417115640914387996')).toBeLessThan(0);
  });
});

describe('decodeMarkets', () => {
  const t = decodeTickers(tickers);
  const markets = decodeMarkets(info, t);

  it('decodes all four xorr markets and only those', () => {
    expect(markets.map((m) => m.id)).toEqual(['ETH-USD', 'BTC-USD', 'ETH-USD-USDG', 'BTC-USD-USDG']);
  });

  it('decodes ETH/USD [ETH-USDC] as recorded', () => {
    const eth = markets.find((m) => m.id === 'ETH-USD')!;
    expect(eth.name).toBe('ETH/USD [ETH-USDC]');
    expect(eth.markPrice).toBeCloseTo(2784.9595, 3);
    expect(eth.openInterestUsd.long).toBeCloseTo(5_858_803.29, 1);
    expect(eth.openInterestUsd.short).toBeCloseTo(5_334_615.86, 1);
    expect(eth.availableLiquidityUsd.long).toBeCloseTo(71_551_706.34, 1);
    // 0.04425 a year → 0.000505% an hour, longs pay; shorts are paid.
    expect(eth.fundingPctPerHour.long).toBeCloseTo(0.000505155, 8);
    expect(eth.fundingPctPerHour.short).toBeLessThan(0);
    expect(eth.netPctPerHour.long).toBeCloseTo(eth.fundingPctPerHour.long + eth.borrowingPctPerHour.long, 10);
    expect(eth.collateral).toEqual(['WETH', 'USDC']);
  });

  it('prices the BTC markets off the synthetic BTC index token', () => {
    const btc = markets.find((m) => m.id === 'BTC-USD')!;
    expect(btc.markPrice).toBeCloseTo(87200.16, 1);
    const btcUsdg = markets.find((m) => m.id === 'BTC-USD-USDG')!;
    expect(btcUsdg.markPrice).toBe(btc.markPrice);
    expect(btcUsdg.openInterestUsd).toEqual({ long: 0, short: 0 });
    expect(btcUsdg.availableLiquidityUsd.long).toBeCloseTo(25.88, 2);
  });

  it('leaves the mark empty rather than inventing one when GMX has no price', () => {
    const noPrices = decodeMarkets(info, new Map());
    expect(noPrices.every((m) => m.markPrice === null)).toBe(true);
  });
});

describe('gmxGet', () => {
  function recorder(answers: Record<string, () => Promise<{ ok: boolean; status: number; body?: unknown }>>) {
    const calls: string[] = [];
    const impl: FetchLike = async (url) => {
      calls.push(url);
      const host = new URL(url).host;
      const a = answers[host];
      if (!a) throw new Error('no route');
      const r = await a();
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    return { impl, calls };
  }

  it('falls back to the second host when the first fails', async () => {
    const { impl, calls } = recorder({
      'arbitrum-api.gmxinfra.io': async () => ({ ok: false, status: 502 }),
      'arbitrum-api-fallback.gmxinfra.io': async () => ({ ok: true, status: 200, body: tickers }),
    });
    const got = await gmxGet<RawTicker[]>('/prices/tickers', { fetchImpl: impl });
    expect(got).toHaveLength(tickers.length);
    expect(calls).toEqual([
      'https://arbitrum-api.gmxinfra.io/prices/tickers',
      'https://arbitrum-api-fallback.gmxinfra.io/prices/tickers',
    ]);
  });

  it('names both hosts and why when neither answers', async () => {
    const { impl } = recorder({
      'arbitrum-api.gmxinfra.io': async () => {
        const e = new Error('aborted');
        e.name = 'TimeoutError';
        throw e;
      },
      'arbitrum-api-fallback.gmxinfra.io': async () => ({ ok: false, status: 503 }),
    });
    const err = await gmxGet('/markets/info', { fetchImpl: impl, timeoutMs: 5 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GmxApiUnavailable);
    expect(String((err as Error).message)).toMatch(/arbitrum-api\.gmxinfra\.io timed out after 5ms; arbitrum-api-fallback\.gmxinfra\.io answered HTTP 503/);
  });

  it('fetchMarkets reads /markets/info and /prices/tickers', async () => {
    const impl: FetchLike = async (url) => ({
      ok: true,
      status: 200,
      json: async () => (url.endsWith('/markets/info') ? info : tickers),
    });
    const markets = await fetchMarkets({ fetchImpl: impl });
    expect(markets).toHaveLength(4);
  });
});
