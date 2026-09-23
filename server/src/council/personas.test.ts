import { describe, expect, it } from 'vitest';
import type { CouncilInputs } from './inputs.js';
import { castBallots, macroDesk, riskKeeper, sessionDesk, tally, trendReader } from './personas.js';

const NOW = '2026-09-23T15:00:00.000Z';

function inputs(over: Partial<CouncilInputs> = {}): CouncilInputs {
  return {
    readAt: NOW,
    proposal: { side: 'buy', symbol: 'NVDA', usd: 50 },
    guard: {
      ok: true,
      result: {
        ok: true,
        detail: {
          symbol: 'NVDA',
          side: 'buy',
          usdg: 50,
          message: 'ok',
          session: 'market',
          chainlink: { price: 229.03, ageSec: 600, maxAgeSec: 86400, feed: '0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15', updatedAt: NOW },
          quote: { amountIn: '50000000', amountOut: '218477594159654974', impliedPrice: 228.86, tokens: 0.2185, shares: 0.2186 },
          deviationBps: 7.5,
          maxDeviationBps: 150,
        },
      },
    },
    trend: { ok: true, source: 'chainlink', rounds: [{ price: 225, at: '2026-09-21T15:00:00Z' }, { price: 229, at: '2026-09-22T15:00:00Z' }], changePct: 1.78, spanHours: 24 },
    day: { ok: true, source: 'robinhood', bid: 228.8, ask: 228.9, high: 231, low: 226, positionInRange: 0.58 },
    gmx: {
      ok: true,
      source: 'gmx',
      eth: { market: 'ETH/USD', fundingLongPctPerHour: 0.001, fundingShortPctPerHour: -0.001, longSharePct: 52, openInterestUsd: 50e6 },
      btc: { market: 'BTC/USD', fundingLongPctPerHour: 0.001, fundingShortPctPerHour: -0.001, longSharePct: 55, openInterestUsd: 60e6 },
    },
    permission: { ok: true, source: 'chain', dailyCapUsd: 100, remainingTodayUsd: 100, expiresAt: Date.parse(NOW) / 1000 + 7 * 86400, revoked: false, grantUsd: 700 },
    holding: { ok: true, source: 'chain', shares: 0, valueUsd: 0 },
    ...over,
  };
}

describe('the council', () => {
  it('approves a small buy of an open, agreeing, rising stock inside the cap', () => {
    const ballots = castBallots(inputs());
    expect(ballots.map((b) => b.vote)).toEqual(['yes', 'yes', 'yes', 'yes']);
    expect(tally(ballots).decision).toBe('approved');
  });

  it('vetoes when Robinhood says the session is closed, naming the reason', () => {
    const closed = inputs({
      guard: { ok: true, result: { ok: false, reason: 'closed', detail: { symbol: 'NVDA', side: 'buy', usdg: 50, message: 'Markets are closed (weekend).' } } },
    });
    const b = sessionDesk(closed);
    expect(b.vote).toBe('veto');
    expect(b.reason).toContain('closed');
    expect(tally(castBallots(closed)).decision).toBe('vetoed');
  });

  it('vetoes a buy bigger than what is left of today’s cap', () => {
    const b = riskKeeper(inputs({ proposal: { side: 'buy', symbol: 'NVDA', usd: 150 } }));
    expect(b.vote).toBe('veto');
    expect(b.reason).toContain('$100.00 left');
  });

  it('vetoes a position past a quarter of the grant', () => {
    const b = riskKeeper(inputs({ holding: { ok: true, source: 'chain', shares: 0.6, valueUsd: 140 } }));
    expect(b.vote).toBe('veto');
    expect(b.reason).toContain('25%');
  });

  it('vetoes without a readable permission instead of assuming one', () => {
    expect(riskKeeper(inputs({ permission: { ok: false, error: 'no grant on XorrDelegation for this owner' } })).vote).toBe('veto');
  });

  it('abstains, and says why, when it cannot read a price history', () => {
    const b = trendReader(inputs({ trend: { ok: false, error: 'rpc down' }, day: { ok: false, error: '429' } }));
    expect(b.vote).toBe('abstain');
    expect(b.reason).toContain('rpc down');
  });

  it('votes no on a buy at the top of a falling tape', () => {
    const b = trendReader(inputs({ trend: { ok: true, source: 'c', rounds: [{ price: 240, at: 'a' }, { price: 229, at: 'b' }], changePct: -4.6, spanHours: 48 }, day: { ok: true, source: 'r', bid: 1, ask: 230.9, high: 231, low: 226, positionInRange: 0.98 } }));
    expect(b.vote).toBe('no');
  });

  it('reads a crowded long on both majors as a no', () => {
    const crowded = { market: 'x', fundingLongPctPerHour: 0.01, fundingShortPctPerHour: -0.01, longSharePct: 72, openInterestUsd: 1e8 };
    const b = macroDesk(inputs({ gmx: { ok: true, source: 'gmx', eth: crowded, btc: crowded } }));
    expect(b.vote).toBe('no');
    expect(b.reason).toContain('72%');
  });

  it('does not approve on a single yes', () => {
    expect(tally([
      { persona: 'session-desk', vote: 'yes', confidence: 1, reason: '', cites: [] },
      { persona: 'risk-keeper', vote: 'abstain', confidence: 0, reason: '', cites: [] },
      { persona: 'trend-reader', vote: 'abstain', confidence: 0, reason: '', cites: [] },
      { persona: 'macro-desk', vote: 'abstain', confidence: 0, reason: '', cites: [] },
    ]).decision).toBe('rejected');
  });
});
