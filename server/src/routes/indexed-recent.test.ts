import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/index.js', () => ({ query: vi.fn(), one: vi.fn() }));
const { recentFill } = await import('./indexed.js');

const tokens = {
  USDC: { address: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', decimals: 6 },
  WMON: { address: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', decimals: 18 },
};

describe('a fill from the index, in words', () => {
  it('a spend: dollars of USDC through the venue it named', () => {
    const r = recentFill({ kind: 'spent', owner: '0xabc', venueName: 'Kuru', token: '0x754704bc059f8c67012fed69bc8a327a5aafb603', amount: '20000000', timestamp: 1791400000, block: 111413500, txHash: '0xt' }, tokens);
    expect(r).toEqual({ kind: 'spent', owner: '0xabc', venue: 'Kuru', symbol: 'USDC', amount: 20, at: new Date(1791400000 * 1000).toISOString(), block: 111413500, tx: '0xt' });
  });
  it('a close: the token sold, in its own decimals', () => {
    const r = recentFill({ kind: 'closed', owner: '0xabc', venueName: 'Uniswap v3', token: '0x3bd359c1119da7da1d913d1c4d2b7c461115433a', amount: '635950300000000000000', timestamp: 1, block: 2, txHash: '0x' }, tokens);
    expect(r.symbol).toBe('WMON');
    expect(r.amount).toBeCloseTo(635.9503, 4);
  });
  it('a token this build does not list keeps its address and no amount, rather than a guessed one', () => {
    const r = recentFill({ kind: 'spent', owner: '0xabc', venueName: 'X', token: '0x1111111111111111111111111111111111112222', amount: '5', timestamp: 1, block: 2, txHash: '0x' }, tokens);
    expect(r.symbol).toBe('0x1111…2222');
    expect(r.amount).toBeNull();
  });
});
