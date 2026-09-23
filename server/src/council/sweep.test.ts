import { describe, expect, it } from 'vitest';
import { pickCandidate, sizeFor } from './sweep.js';

describe('the agents’ council sweep', () => {
  it('proposes the strongest rising stock not already entered today', () => {
    expect(pickCandidate([{ symbol: 'NVDA', changePct: 0.8 }, { symbol: 'TSLA', changePct: 1.9 }, { symbol: 'SPY', changePct: -0.4 }], new Set(['TSLA']))).toEqual({ symbol: 'NVDA', changePct: 0.8 });
  });
  it('proposes nothing on a flat or falling tape, and says so', () => {
    const r = pickCandidate([{ symbol: 'NVDA', changePct: 0.1 }, { symbol: 'SPY', changePct: -1 }], new Set());
    expect('none' in r && r.none).toContain('nothing rising');
  });
  it('sizes at a tenth of the cap, bounded by what is left, and never dust', () => {
    expect(sizeFor(1600, 1550)).toBe(160);
    expect(sizeFor(1600, 40)).toBe(40);
    expect(sizeFor(100, 3)).toBeNull();
  });
});

import { pickDrawdown } from './sweep.js';
describe('Drawdown Guard', () => {
  it('sells the holding furthest below its cost, once it is 3% or more under', () => {
    const r = pickDrawdown([
      { symbol: 'NVDA', units: 1, costUsd: 230, price: 220 }, // −4.3%
      { symbol: 'TSLA', units: 1, costUsd: 380, price: 370 }, // −2.6%
    ]);
    expect(r).toMatchObject({ symbol: 'NVDA' });
  });
  it('sells nothing when every holding is within 3% of its cost', () => {
    expect(pickDrawdown([{ symbol: 'SPY', units: 1, costUsd: 775, price: 770 }])).toHaveProperty('none');
  });
});
