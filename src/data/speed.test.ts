import { describe, expect, it, vi } from 'vitest';
import { cheaperBy, groupDigits, headroomPct, median, msWords, speedBarHeight, tinyUsd } from './speed';
import { voteToFillSec } from './council';

// The helpers under test never call the executor; the client and what it imports are left out (vi.mock is hoisted).
vi.mock('./api', () => ({ api: {} }));

describe('the speed receipt in words', () => {
  it('groups a block number and refuses anything that is not one', () => {
    expect(groupDigits('110900123')).toBe('110,900,123');
    expect(groupDigits(null)).toBeNull();
    expect(groupDigits('0x1f')).toBeNull();
  });
  it('a tiny cost keeps two significant digits; a dollar or more keeps cents', () => {
    expect(tinyUsd(0.000912)).toBe('$0.00091');
    expect(tinyUsd(1.5634)).toBe('$1.56');
    expect(tinyUsd(0.4)).toBe('$0.40');
    expect(tinyUsd(0)).toBe('$0');
    expect(tinyUsd(null)).toBeNull();
  });
  it('says how many times cheaper, only when Monad was', () => {
    expect(cheaperBy(0.0009, 1.56)).toBe(1730);
    expect(cheaperBy(0.1, 1.5)).toBe(15);
    expect(cheaperBy(0.5, 1.2)).toBe(2.4);
    expect(cheaperBy(2, 1)).toBeNull();
    expect(cheaperBy(null, 1)).toBeNull();
  });
  it('keeps very small fee exponents intact', () => {
    expect(tinyUsd(1e-10)).toBe('$1e-10');
    expect(tinyUsd(1e-20)).toBe('$1e-20');
    expect(tinyUsd(1.23e-10)).toBe('$1.2e-10');
    expect(tinyUsd(0.001)).toBe('$0.001');
  });
});

describe('voteToFillSec — a round, convened to confirmed', () => {
  it('measures an executed round', () => {
    expect(voteToFillSec({ outcome: 'executed', createdAt: '2026-10-07T10:00:00.000Z', settledAt: '2026-10-07T10:00:01.800Z' })).toBe(1.8);
  });
  it('a round that sent nothing has no fill time', () => {
    expect(voteToFillSec({ outcome: 'not_executed', createdAt: '2026-10-07T10:00:00.000Z', settledAt: '2026-10-07T10:00:00.500Z' })).toBeNull();
    expect(voteToFillSec({ outcome: 'executed', createdAt: '2026-10-07T10:00:00.000Z', settledAt: null })).toBeNull();
  });
});

describe('msWords', () => {
  it('ms under a second, seconds from one', () => {
    expect(msWords(422)).toBe('422 ms');
    expect(msWords(1337)).toBe('1.3 s');
    expect(msWords(null)).toBeNull();
  });
});

describe('the speed history in numbers', () => {
  it('renders zero-duration fills with a finite visible height', () => {
    expect(speedBarHeight(0, 0, 64)).toBe(4);
    expect(speedBarHeight(0, 100, 64)).toBe(4);
    expect(speedBarHeight(50, 100, 64)).toBe(32);
    expect(speedBarHeight(100, 100, 64)).toBe(64);
  });
  it('a median of an odd and an even count', () => {
    expect(median([559, 651, 592])).toBe(592);
    expect(median([150, 686])).toBe(418);
    expect(median([])).toBeNull();
  });
  it('declared over used, as the median percentage, over fills that recorded both', () => {
    expect(headroomPct([{ gasUsed: 199326, gasLimit: 263038 }, { gasUsed: 165126, gasLimit: 225418 }, { gasUsed: null, gasLimit: 1 }])).toBe(34);
    expect(headroomPct([])).toBeNull();
  });
});
