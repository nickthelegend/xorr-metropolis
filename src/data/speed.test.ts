import { describe, expect, it, vi } from 'vitest';
import { cheaperBy, groupDigits, tinyUsd } from './speed';
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
