/**
 * The exit guard closes real positions with no one watching, so each rule is pinned here: when it fires, when it must
 * not, and which wins when two apply.
 */
import { describe, expect, it } from 'vitest';
import type { DeskPosition } from './perpl-chain.js';
import { DEFAULT_EXITS, exitFor, fundingPctPerHourOf, rulesFrom, unrealised, type ExitRules } from './perpl-exits.js';

// A $100 MON long at 2x, as the desk proof opened one: 4,166 MON at $0.024, $50 of margin, liquidated near $0.015.
const long = (over: Partial<DeskPosition> = {}): DeskPosition => ({
  perpId: 64,
  market: 'MON',
  long: true,
  lots: 4166,
  entry: 0.024,
  mark: 0.024,
  deposit: 50,
  pnl: 0,
  liquidation: 0.015,
  liqDistance: 0.375,
  ...over,
});

const ALL: ExitRules = { takeProfitPct: 20, stopLossPct: 50, liqBufferPct: 10, maxFundingAprPct: 50 };

describe('profit and loss at the mark', () => {
  it('is worked out from mark, entry and size, for a long and a short', () => {
    // (0.0252 − 0.024) × 4,166 = $5.00, a tenth of the margin.
    expect(unrealised(long({ mark: 0.0252 }))!.usd).toBeCloseTo(5.0, 2);
    expect(unrealised(long({ mark: 0.0252 }))!.pctOfMargin).toBeCloseTo(10, 1);
    expect(unrealised(long({ mark: 0.0252, long: false }))!.usd).toBeCloseTo(-5.0, 2);
  });

  it('says nothing without a mark or a margin', () => {
    expect(unrealised(long({ mark: null }))).toBeNull();
    expect(unrealised(long({ deposit: 0 }))).toBeNull();
  });
});

describe('the rules', () => {
  it('leaves a calm position alone', () => {
    expect(exitFor(long({ mark: 0.0242 }), 0.001, ALL)).toBeNull();
  });

  it('closes inside the liquidation buffer, first, whatever else applies', () => {
    const d = exitFor(long({ mark: 0.0165, liqDistance: 0.09 }), 0.01, ALL);
    expect(d?.rule).toBe('liquidation');
    expect(d?.text).toBe('The MON long was 9% from liquidation (your buffer: 10%), so it was closed before Perpl liquidated it.');
  });

  it('stops a loss at its share of the margin', () => {
    // (0.01799 − 0.024) × 4,166 = −$25.04, just past half the margin.
    expect(exitFor(long({ mark: 0.01799 }), null, ALL)?.rule).toBe('stop_loss');
    expect(exitFor(long({ mark: 0.0181 }), null, ALL)).toBeNull();
  });

  it('takes profit only when the owner set one', () => {
    // +$10.04, just over 20% of the margin.
    const up = long({ mark: 0.02641 });
    expect(exitFor(up, null, ALL)?.text).toBe('The MON long was up 20.1% of its $50 margin (your take-profit: 20%).');
    expect(exitFor(up, null, DEFAULT_EXITS)).toBeNull();
  });

  it('closes a loser that pays heavy funding, and keeps a winner that does', () => {
    // 0.006%/h is 52.6% a year; longs pay.
    expect(exitFor(long({ mark: 0.0239 }), 0.006, ALL)?.rule).toBe('funding');
    expect(exitFor(long({ mark: 0.0241 }), 0.006, ALL)).toBeNull();
    // A short is paid when longs pay: no funding exit.
    expect(exitFor(long({ long: false, mark: 0.0241 }), 0.006, ALL)).toBeNull();
    // A short pays when shorts pay.
    expect(exitFor(long({ long: false, mark: 0.0241 }), -0.006, ALL)?.rule).toBe('funding');
  });

  it('does nothing with every rule off', () => {
    const off: ExitRules = { takeProfitPct: null, stopLossPct: null, liqBufferPct: null, maxFundingAprPct: null };
    expect(exitFor(long({ mark: 0.0165, liqDistance: 0.02 }), 0.05, off)).toBeNull();
  });
});

describe('reading what is stored', () => {
  it('turns the row into rules, null staying off', () => {
    expect(rulesFrom({ take_profit_pct: null, stop_loss_pct: '50', liq_buffer_pct: '10', max_funding_apr_pct: null })).toEqual({
      takeProfitPct: null,
      stopLossPct: 50,
      liqBufferPct: 10,
      maxFundingAprPct: null,
    });
  });

  it('converts Perpl funding per interval to per hour', () => {
    // 0.00004 per 2,580 s interval (40 millionths) is 0.00558% an hour.
    expect(fundingPctPerHourOf({ fundingPerInterval: 0.00004, fundingIntervalSec: 2580 })).toBeCloseTo(0.005581, 5);
    expect(fundingPctPerHourOf({ fundingPerInterval: null, fundingIntervalSec: 2580 })).toBeNull();
    expect(fundingPctPerHourOf(undefined)).toBeNull();
  });
});
