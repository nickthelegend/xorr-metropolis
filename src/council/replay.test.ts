import { describe, expect, it, vi } from 'vitest';
import { ageWords, beatMs, beats, readingsFor, seated, strategistModel, tally } from './replay';
import type { CouncilBallot } from '@/data/council';

// The replay's words never call the executor; the client and what it imports are left out (vi.mock is hoisted).
vi.mock('@/data/api', () => ({ api: {} }));

const ballot = (persona: CouncilBallot['persona'], vote: CouncilBallot['vote'], cites: string[]): CouncilBallot => ({ persona, vote, confidence: 0.8, reason: '', cites });

// Round 66 on the local fork, 7 Oct, as the executor stored it (trend rounds trimmed to their count).
const inputs = {
  readAt: '2026-10-07T12:08:49.925Z',
  price: {
    ok: true,
    source: 'Chainlink MON/USD on this fork; the fill from Uniswap v3; Kuru MON/USDC book',
    chainlink: { feed: '0xBcD7', price: 0.03136504, ageSec: 16, maxAgeSec: 3600, updatedAt: '2026-10-05T22:41:24.000Z' },
    fill: { price: 0.0314441237607972, venue: 'Uniswap v3 USDC→WMON on the fork, $50 quoted' },
    kuru: { mid: 0.0314185, spreadBps: 12.413068733388725 },
    gapBps: 25.21398372111231,
    maxGapBps: 150,
    halt: null,
  },
  trend: { ok: true, source: 'Chainlink MON/USD on Monad mainnet, 8 rounds', rounds: new Array(8).fill({}), changePct: -2.369878183831673, spanHours: 6.077 },
  perps: {
    ok: true,
    source: 'Perpl (fork)',
    markets: [
      { market: 'MON', mark: 0.026427, openInterest: 2905508, fundingPctPerHour: 0 },
      { market: 'BTC', mark: 83624, openInterest: 7.84846, fundingPctPerHour: 0.005581395348837209 },
    ],
  },
  permission: { ok: true, source: 'XorrDelegation', revoked: false, grantUsd: 4800, expiresAt: 1791634085, dailyCapUsd: 1600, remainingTodayUsd: 1580 },
  holding: { ok: true, source: 'WMON balanceOf on the fork', shares: 636.058544564164, valueUsd: 16.83286958325119 },
};

describe('the beats of a replay', () => {
  // The executor stores votes ordered by persona name; the bench sits them Price, Risk, Trend, Perps, Kimi.
  const votes = [ballot('macro-desk', 'abstain', ['perps']), ballot('risk-keeper', 'yes', ['permission', 'holding']), ballot('session-desk', 'yes', ['price']), ballot('trend-reader', 'no', ['trend'])];

  it('seats the votes in bench order', () => {
    expect(seated(votes).map((v) => v.persona)).toEqual(['session-desk', 'risk-keeper', 'trend-reader', 'macro-desk']);
  });
  it('goes proposal, each seat, verdict, outcome', () => {
    expect(beats({ votes }).map((b) => (b.kind === 'seat' ? b.ballot.persona : b.kind))).toEqual([
      'proposal',
      'session-desk',
      'risk-keeper',
      'trend-reader',
      'macro-desk',
      'verdict',
      'outcome',
    ]);
  });
  it('holds a seat longer than a glance, and the last beat for good', () => {
    expect(beatMs({ kind: 'seat', ballot: votes[0]! })).toBeGreaterThan(beatMs({ kind: 'proposal' }));
    expect(beatMs({ kind: 'outcome' })).toBe(0);
  });
  it('tallies every kind of vote', () => {
    expect(tally([...votes, ballot('strategist', 'veto', [])])).toEqual({ yes: 2, no: 1, abstain: 1, veto: 1 });
  });
});

describe('what each desk read, from the round’s own inputs', () => {
  it('the price desk: Chainlink and its age, the fill’s quote, Kuru’s book, the gap and its limit', () => {
    const [g] = readingsFor(inputs, ['price'], 'MON');
    expect(g!.source).toMatch(/^Chainlink MON\/USD/);
    expect(g!.readings).toEqual([
      { label: 'Chainlink MON/USD', value: '$0.03137 · 16 s old' },
      { label: 'The fill’s quote', value: '$0.03144 · Uniswap v3 USDC→WMON on the fork, $50 quoted' },
      { label: 'Kuru book', value: 'mid $0.03142 · spread 12.4 bps' },
      { label: 'Gap to Chainlink', value: '25.2 bps (limit 150 bps)' },
    ]);
  });
  it('the risk keeper: the cap left today, the end date, and what is held', () => {
    const r = readingsFor(inputs, ['permission', 'holding'], 'MON').flatMap((g) => g.readings);
    expect(r[0]).toEqual({ label: 'Left today', value: '$1,580 of $1,600' });
    expect(r[1]!.label).toBe('Ends');
    expect(r[1]!.value).toMatch(/2026$/);
    expect(r[2]).toEqual({ label: 'Held', value: '636.06 MON · $16.83' });
  });
  it('nothing held reads as nothing, not as 0.0000 at $0.00', () => {
    const h = { ok: true, source: 'WETH balanceOf', shares: 0, valueUsd: 0 };
    expect(readingsFor({ holding: h }, ['holding'], 'ETH')[0]!.readings).toEqual([{ label: 'Held', value: 'no ETH yet' }]);
  });
  it('the trend reader: Chainlink’s change over its span', () => {
    expect(readingsFor(inputs, ['trend'], 'MON')[0]!.readings).toEqual([{ label: 'Chainlink over 6.1 h', value: '−2.37% across 8 rounds' }]);
  });
  it('the perps desk: who pays funding on each Perpl market', () => {
    expect(readingsFor(inputs, ['perps'], 'MON')[0]!.readings.map((r) => `${r.label}: ${r.value}`)).toEqual([
      'Perpl MON: no funding · OI 2,905,508',
      'Perpl BTC: longs pay 0.0056%/h · OI 7.85',
    ]);
  });
  it('a read that failed when the round convened says so, with its error', () => {
    const [g] = readingsFor({ price: { ok: false, error: 'feed reverted' } }, ['price'], 'MON');
    expect(g!.readings).toEqual([{ label: 'Price', value: 'could not be read: feed reverted', failed: true }]);
  });
  it('the Strategist cites the ballots and its model, not inputs: no readings, and the model named', () => {
    expect(readingsFor(inputs, ['ballots', 'kimi:kimi-k2'], 'MON')).toEqual([]);
    expect(strategistModel(['ballots', 'kimi:kimi-k2'])).toBe('kimi-k2');
    expect(strategistModel(['price'])).toBeNull();
  });
  it('a round without inputs has nothing to show, not something invented', () => {
    expect(readingsFor(undefined, ['price'], 'MON')).toEqual([]);
  });
});

describe('ageWords', () => {
  it('seconds, minutes, hours', () => {
    expect(ageWords(16)).toBe('16 s old');
    expect(ageWords(240)).toBe('4 min old');
    expect(ageWords(7200)).toBe('2 h old');
    expect(ageWords(Number.NaN)).toBe('age unknown');
  });
});
