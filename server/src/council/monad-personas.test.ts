import { describe, expect, it } from 'vitest';
import type { MonadCouncilInputs } from './monad-inputs.js';
import { assertMonadSymbol, fundingPctPerHour } from './monad-inputs.js';
import { castBallots, perpsDesk, priceDesk, tally } from './personas.js';

const NOW = '2026-09-24T09:00:00.000Z';

// Numbers read on Monad mainnet and Perpl on 2026-09-24: MON $0.02407 on Chainlink, Kuru 0.024069/0.024085, Perpl
// funding rate 0 on BTC and 40 (millionths per 2,580 s interval) on MON and ETH.
function inputs(over: Partial<MonadCouncilInputs> = {}): MonadCouncilInputs {
  return {
    venue: 'monad',
    readAt: NOW,
    proposal: { side: 'buy', symbol: 'MON', usd: 25 },
    price: {
      ok: true,
      source: 'chainlink + uniswap + kuru',
      chainlink: { price: 0.02407, ageSec: 38, feed: '0xBcD78f76005B7515837af6b50c7C52BCf73822fb', updatedAt: NOW, maxAgeSec: 3600 },
      fill: { price: 0.024155, venue: 'Uniswap v3 USDC→WMON on monad-fork' },
      kuru: { mid: 0.024077, spreadBps: 6.6 },
      gapBps: 35.3,
      maxGapBps: 150,
    },
    trend: { ok: true, source: 'chainlink', rounds: [{ price: 0.0238, at: '2026-09-24T07:00:00Z' }, { price: 0.02407, at: NOW }], changePct: 1.13, spanHours: 2 },
    perps: {
      ok: true,
      source: 'perpl',
      markets: [
        { market: 'MON', mark: 0.024072, fundingPctPerHour: 0.0012, openInterest: 9_945_925 },
        { market: 'ETH', mark: 2684.18, fundingPctPerHour: 0.0012, openInterest: 1719 },
        { market: 'BTC', mark: 84396, fundingPctPerHour: 0, openInterest: 82 },
      ],
    },
    permission: { ok: true, source: 'chain', dailyCapUsd: 100, remainingTodayUsd: 100, expiresAt: Date.parse(NOW) / 1000 + 7 * 86400, revoked: false, grantUsd: 700 },
    holding: { ok: true, source: 'chain', shares: 0, valueUsd: 0 },
    ...over,
  };
}

describe('the council on Monad', () => {
  it('approves a small MON buy when the fill agrees with Chainlink, MON is rising and perps are calm', () => {
    const ballots = castBallots(inputs());
    expect(ballots.map((b) => [b.persona, b.vote])).toEqual([
      ['session-desk', 'yes'],
      ['risk-keeper', 'yes'],
      ['trend-reader', 'yes'],
      ['macro-desk', 'yes'],
    ]);
    expect(tally(ballots).decision).toBe('approved');
    expect(ballots[0]!.reason).toContain('Chainlink $0.02407 (1 min old), fill $0.02415');
    expect(ballots[0]!.reason).toContain('Kuru mid $0.02408');
  });

  it('vetoes a fill too far from Chainlink, naming both prices and the limit', () => {
    const wide = inputs({ price: { ...(inputs().price as Extract<MonadCouncilInputs['price'], { ok: true }>), fill: { price: 0.0246, venue: 'Uniswap v3' }, gapBps: 220 } });
    const b = priceDesk(wide);
    expect(b.vote).toBe('veto');
    expect(b.reason).toMatch(/220\.0 bps apart \(limit 150\)/);
    expect(tally(castBallots(wide)).decision).toBe('vetoed');
  });

  it('vetoes a stale feed, and an unreadable price check', () => {
    const p = inputs().price as Extract<MonadCouncilInputs['price'], { ok: true }>;
    expect(priceDesk(inputs({ price: { ...p, chainlink: { ...p.chainlink, ageSec: 4000 } } })).vote).toBe('veto');
    const blind = priceDesk(inputs({ price: { ok: false, error: 'rpc timeout' } }));
    expect(blind.vote).toBe('veto');
    expect(blind.reason).toContain('rpc timeout');
  });

  it('says no to a buy when longs pay heavy funding on the asset itself', () => {
    const crowded = inputs({
      perps: { ok: true, source: 'perpl', markets: [{ market: 'MON', mark: 0.024, fundingPctPerHour: 0.0056, openInterest: 1 }, { market: 'ETH', mark: 2680, fundingPctPerHour: 0.001, openInterest: 1 }, { market: 'BTC', mark: 84000, fundingPctPerHour: 0, openInterest: 1 }] },
    });
    const b = perpsDesk(crowded);
    expect(b.vote).toBe('no');
    expect(b.reason).toContain('MON longs pay 0.0056%/h');
  });

  it('abstains when Perpl cannot be read, and never invents a funding rate', () => {
    const b = perpsDesk(inputs({ perps: { ok: false, error: 'fetch failed' } }));
    expect(b.vote).toBe('abstain');
    expect(b.reason).toContain('fetch failed');
  });
});

describe('Monad council inputs', () => {
  it('converts Perpl funding per interval to percent per hour', () => {
    // Perpl's rate 40 is 40 millionths per 2,580 s interval.
    expect(fundingPctPerHour({ fundingPerInterval: 40 / 1e6, fundingIntervalSec: 2580 })).toBeCloseTo(0.00558, 5);
    expect(fundingPctPerHour({ fundingPerInterval: null, fundingIntervalSec: 2580 })).toBeNull();
    expect(fundingPctPerHour({ fundingPerInterval: 0.00004, fundingIntervalSec: null })).toBeNull();
  });

  it('takes MON, ETH and BTC, wrapped or not, and refuses the rest by name', () => {
    expect(assertMonadSymbol('wmon')).toBe('MON');
    expect(assertMonadSymbol('WETH')).toBe('ETH');
    expect(assertMonadSymbol('BTC')).toBe('BTC');
    expect(() => assertMonadSymbol('NVDA')).toThrow(/MON, ETH, BTC; NVDA/);
  });
});
