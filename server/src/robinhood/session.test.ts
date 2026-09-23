import { describe, expect, it } from 'vitest';
import assetsFixture from './fixtures/assets.json';
import { assetsResponseSchema } from './api.js';
import { marketClock, tradability } from './session.js';

const assets = assetsResponseSchema.parse(assetsFixture).assets;
const bySymbol = (s: string) => assets.find((a) => a.tokenSymbol === s)!;

// 2026-09-23 is a Wednesday; New York is on EDT (UTC−4) until 2026-11-01, EST (UTC−5) after.
const at = (iso: string) => marketClock(new Date(iso));

describe('marketClock', () => {
  it.each([
    ['2026-09-23T04:30:00Z', 'overnight', 'overnight'], // Wed 00:30 ET
    ['2026-09-23T07:59:00Z', 'overnight', 'overnight'], // Wed 03:59 ET
    ['2026-09-23T08:00:00Z', 'extended', 'pre-market'], // Wed 04:00 ET
    ['2026-09-23T13:29:00Z', 'extended', 'pre-market'], // Wed 09:29 ET
    ['2026-09-23T13:30:00Z', 'market', 'regular'], // Wed 09:30 ET
    ['2026-09-23T19:59:00Z', 'market', 'regular'], // Wed 15:59 ET
    ['2026-09-23T20:00:00Z', 'extended', 'post-market'], // Wed 16:00 ET
    ['2026-09-24T00:00:00Z', 'overnight', 'overnight'], // Wed 20:00 ET
    ['2026-09-25T23:59:00Z', 'extended', 'post-market'], // Fri 19:59 ET
    ['2026-09-26T00:00:00Z', 'closed', 'closed'], // Fri 20:00 ET
    ['2026-09-26T16:00:00Z', 'closed', 'closed'], // Sat
    ['2026-09-27T23:59:00Z', 'closed', 'closed'], // Sun 19:59 ET
    ['2026-09-28T00:00:00Z', 'overnight', 'overnight'], // Sun 20:00 ET
  ])('%s → %s (%s)', (iso, session, phase) => {
    const r = at(iso);
    expect(r.session).toBe(session);
    expect(r.phase).toBe(phase);
    expect(r.calendarUnknown).toBe(false);
  });

  it('closes for an NYSE holiday and the night before it, reopening the evening of the holiday', () => {
    expect(at('2026-09-07T00:30:00Z').session).toBe('closed'); // Sun 20:30 ET before Labor Day
    const labor = at('2026-09-07T15:00:00Z'); // Labor Day 11:00 ET
    expect(labor.session).toBe('closed');
    expect(labor.reason).toContain('Labor Day');
    expect(at('2026-09-08T00:30:00Z').session).toBe('overnight'); // Mon 20:30 ET → Tue trades
    expect(at('2026-11-26T02:00:00Z').session).toBe('closed'); // Wed 21:00 EST before Thanksgiving
    expect(at('2026-11-26T15:00:00Z').session).toBe('closed'); // Thanksgiving
  });

  it('shortens the day on an early close', () => {
    // Fri 2026-11-27, EST: 12:00 regular, 14:00 post-market, 17:30 closed.
    expect(at('2026-11-27T17:00:00Z').session).toBe('market');
    expect(at('2026-11-27T18:00:00Z').phase).toBe('post-market');
    expect(at('2026-11-27T22:30:00Z').session).toBe('closed');
    // Christmas Eve (Thu): after the early post-market, no overnight into Christmas.
    expect(at('2026-12-24T22:30:00Z').session).toBe('closed');
    expect(at('2026-12-25T01:30:00Z').reason).toContain('Christmas');
  });

  it('follows daylight saving: 09:30 ET is 13:30Z in October and 14:30Z in November', () => {
    expect(at('2026-10-30T13:30:00Z').session).toBe('market');
    expect(at('2026-11-02T13:30:00Z').session).toBe('extended');
    expect(at('2026-11-02T14:30:00Z').session).toBe('market');
  });

  it('flags years the holiday table does not cover', () => {
    expect(at('2028-03-01T15:00:00Z').calendarUnknown).toBe(true);
  });
});

describe('tradability', () => {
  it('uses the live capability flags for the session the clock picks', () => {
    const t = tradability(bySymbol('NVDA'), new Date('2026-09-23T15:00:00Z'));
    expect(t).toMatchObject({ session: 'market', whole: true, fractional: true });
    expect(t.reason).toContain('NVDA tradable in the market session');
  });

  it('reports fractional as not allowed where Robinhood says UNTRADABLE (WYFI, real 2026-09-23 flags)', () => {
    const t = tradability(bySymbol('WYFI'), new Date('2026-09-23T04:30:00Z'));
    expect(t).toMatchObject({ session: 'overnight', whole: true, fractional: false });
    expect(t.reason).toContain('fractional untradable');
  });

  it('is closed on a weekend whatever the flags say', () => {
    const t = tradability(bySymbol('NVDA'), new Date('2026-09-26T16:00:00Z'));
    expect(t).toMatchObject({ session: 'closed', whole: false, fractional: false });
  });

  it('a flag beats the clock: an untradable extended session stays untradable', () => {
    const a = structuredClone(bySymbol('NVDA'));
    a.tradingCapabilities.extended = { whole: 'TRADING_STATUS_UNTRADABLE', fractional: 'TRADING_STATUS_UNTRADABLE' };
    const t = tradability(a, new Date('2026-09-23T21:00:00Z'));
    expect(t).toMatchObject({ session: 'extended', whole: false, fractional: false });
    expect(t.reason).toContain('not tradable');
  });
});
