import { describe, expect, it } from 'vitest';
import { fundingSeries, priceSummary } from './perpl-risk.js';
import { perplNetwork } from './perpl.js';

describe('Perpl risk', () => {
  it('reads funding in millionths per interval: per hour, what a long paid, and the annual rate', () => {
    // Two intervals of 2,580 s: +40 (longs pay 0.004%) then -10 (longs are paid 0.001%).
    const f = fundingSeries(
      { d: [{ at: { t: Date.parse('2026-10-05T00:00:00Z') }, rate: 40 }, { at: { t: Date.parse('2026-10-05T00:43:00Z') }, rate: -10 }] },
      2580,
    );
    expect(f.points[0]).toEqual({ at: '2026-10-05T00:00:00.000Z', pctPerHour: (40 / 1e6) * 100 * (3600 / 2580) });
    expect(f.longsPaidPct).toBeCloseTo(0.003, 10);
    expect(f.aprPct).toBeCloseTo((((30 / 2) / 1e6) * 100 * (3600 / 2580)) * 24 * 365, 8);
  });

  it('says nothing rather than zero when there is no funding or no interval', () => {
    expect(fundingSeries({ d: [] }, 2580)).toEqual({ points: [], longsPaidPct: null, aprPct: null });
    expect(fundingSeries({ d: [{ at: { t: 1 }, rate: 40 }] }, null)).toEqual({ points: [], longsPaidPct: null, aprPct: null });
  });

  it('summarises hourly candles in the market’s own price decimals', () => {
    const p = priceSummary(
      { d: [{ t: 1, o: 3405, h: 3440, l: 3351, c: 3371, n: 297 }, { t: 2, o: 3371, h: 3386, l: 3240, c: 3266, n: 112 }] },
      5,
    );
    expect(p).toEqual({ open: 0.03405, close: 0.03266, high: 0.0344, low: 0.0324, changePct: ((0.03266 - 0.03405) / 0.03405) * 100, trades: 409 });
    expect(priceSummary({ d: [] }, 5)).toBeNull();
  });

  it('reads the Perpl this build trades on: testnet for the testnet build, mainnet for mainnet and the fork', () => {
    expect(perplNetwork('monad-testnet').name).toBe('Perpl testnet');
    expect(perplNetwork('monad').name).toBe('Perpl');
    expect(perplNetwork('monad-fork').name).toBe('Perpl');
  });
});

describe('Perpl on a fork', () => {
  it('trades only while the local keeper posts marks', async () => {
    const { perplHere } = await import('./perpl-chain.js');
    expect(perplHere('monad-fork', {})).toBeNull();
    expect(perplHere('monad-fork', { PERPL_FORK_KEEPER: '1' })).toMatchObject({ name: 'Perpl (fork)', exchange: '0x34B6552d57a35a1D042CcAe1951BD1C370112a6F' });
    expect(perplHere('monad-testnet', {})?.name).toBe('Perpl testnet');
  });
});

describe('the fork keeper', () => {
  it('keeps the live mark inside the fork book', async () => {
    const { markWithinBook } = await import('../fork/perpl-keeper.js');
    expect(markWithinBook(31083, 31491, 31562)).toBe(31491); // live fell below the fork's best bid
    expect(markWithinBook(31700, 31491, 31562)).toBe(31562);
    expect(markWithinBook(31500, 31491, 31562)).toBe(31500);
    expect(markWithinBook(31500, null, null)).toBe(31500);
  });
});
