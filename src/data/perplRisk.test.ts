/**
 * The risk screen's alerts are only worth showing when each one is true and the order says what to look at first.
 */
import { describe, expect, it } from 'vitest';
import type { DeskPosition, PerplMarketRisk } from './perps';
import { aprOf, bucket, fundingPerHourUsd, riskAlerts } from './perplRisk';

const NOW = Date.parse('2026-10-05T12:00:00Z');

const market = (over: Partial<PerplMarketRisk> = {}): PerplMarketRisk => ({
  id: 64,
  name: 'MON',
  mark: 0.025,
  at: new Date(NOW - 5_000).toISOString(),
  oiUsd: 100_000,
  spreadBps: 4,
  fundingNowPctPerHour: 0.001,
  funding: { points: [], longsPaidPct: 0.02, aprPct: 8.8 },
  price: { open: 0.025, close: 0.0252, high: 0.026, low: 0.024, changePct: 0.8, trades: 120 },
  ...over,
});

const position = (over: Partial<DeskPosition> = {}): DeskPosition => ({
  perpId: 64,
  market: 'MON',
  long: true,
  lots: 10_000,
  entry: 0.024,
  mark: 0.025,
  deposit: 100,
  pnl: 10,
  liquidation: 0.02,
  liqDistance: 0.2,
  ...over,
});

describe('alerts', () => {
  it('says nothing about a calm market', () => {
    expect(riskAlerts([market()], 24, NOW)).toEqual([]);
  });

  it('calls a market crowded from the current rate, by who pays', () => {
    // 0.004%/h is 35% a year.
    const [a] = riskAlerts([market({ fundingNowPctPerHour: -0.004 })], 24, NOW);
    expect(a?.text).toBe('MON: shorts pay 35% a year at the current rate.');
  });

  it('says markets paying the same rate once', () => {
    const alerts = riskAlerts(
      [market({ id: 1, name: 'ETH', fundingNowPctPerHour: 0.0056 }), market({ id: 2, name: 'SOL', fundingNowPctPerHour: 0.0056 }), market({ id: 3, name: 'ZEC', fundingNowPctPerHour: 0.0056 })],
      24,
      NOW,
    );
    expect(alerts.map((a) => a.text)).toEqual(['ETH, SOL and ZEC: longs pay 49% a year at the current rate.']);
  });

  it('names a big move over the window, a wide book and a stale mark', () => {
    const alerts = riskAlerts(
      [
        market({
          price: { open: 1, close: 0.93, high: 1, low: 0.9, changePct: -7, trades: 5 },
          spreadBps: 40,
          at: new Date(NOW - 120_000).toISOString(),
        }),
      ],
      168,
      NOW,
    );
    expect(alerts.map((a) => a.text)).toEqual([
      'MON’s mark is over a minute old: Perpl treats a price that old as stale.',
      'MON fell 7% in 7 days.',
      'MON’s book is 40 bps wide: a market order pays for it.',
    ]);
  });

  it('puts a position near liquidation first', () => {
    const alerts = riskAlerts([market({ fundingNowPctPerHour: 0.01 })], 24, NOW, [position({ liqDistance: 0.08, long: false })]);
    expect(alerts[0]).toMatchObject({ level: 'high', text: 'Your MON short is 8% from liquidation.' });
    expect(alerts).toHaveLength(2);
  });
});

describe('funding a position pays', () => {
  it('charges a long when longs pay, and pays a short', () => {
    // 10,000 MON at $0.025 is $250; 0.01%/h of that is 2.5 cents an hour.
    expect(fundingPerHourUsd(position(), market({ fundingNowPctPerHour: 0.01 }))).toBeCloseTo(0.025);
    expect(fundingPerHourUsd(position({ long: false }), market({ fundingNowPctPerHour: 0.01 }))).toBeCloseTo(-0.025);
  });

  it('does not guess without a rate', () => {
    expect(fundingPerHourUsd(position(), market({ fundingNowPctPerHour: null }))).toBeNull();
    expect(fundingPerHourUsd(position(), undefined)).toBeNull();
  });
});

describe('the funding strip', () => {
  it('keeps a short series as it is and averages a long one down', () => {
    expect(bucket([1, 2, 3], 48)).toEqual([1, 2, 3]);
    expect(bucket([1, 3, 5, 7], 2)).toEqual([2, 6]);
    expect(bucket(Array.from({ length: 234 }, () => 1), 48)).toHaveLength(48);
  });

  it('annualises per-hour funding', () => {
    expect(aprOf(0.001)).toBeCloseTo(8.76);
  });
});
