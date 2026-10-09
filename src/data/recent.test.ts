import { describe, expect, it, vi } from 'vitest';
import { fillWords } from './recent';

// The words never call the executor (vi.mock is hoisted).
vi.mock('./api', () => ({ api: {} }));

describe('a fill as a sentence', () => {
  it('a spend in dollars, through its venue', () => {
    expect(fillWords({ kind: 'spent', symbol: 'USDC', amount: 20, venue: 'Kuru' })).toBe('Bought with $20.00 through Kuru');
  });
  it('a sale of the token sold', () => {
    expect(fillWords({ kind: 'closed', symbol: 'WMON', amount: 635.9503, venue: 'Uniswap v3' })).toBe('Sold 635.95 WMON through Uniswap v3');
  });
  it('an amount it could not read is left out, not made up', () => {
    expect(fillWords({ kind: 'closed', symbol: 'WMON', amount: null, venue: '' })).toBe('Sold WMON');
  });
});
