import { describe, expect, it, vi } from 'vitest';

vi.mock('./chains.js', () => ({ IS_MONAD: false }));
const { gasHeadroomPct, withHeadroom } = await import('./gas-limit.js');

describe('the gas a delegated call declares', () => {
  it('on Monad, where the limit is billed, carries 10% over the estimate', () => {
    expect(gasHeadroomPct(true)).toBe(10n);
    expect(withHeadroom(386_000n, true)).toBe(424_600n);
  });
  it('elsewhere, where unused gas is refunded, 30%', () => {
    expect(withHeadroom(172_488n, false)).toBe(224_234n);
  });
  it('either way covers the 3% shortfall measured between estimate and execution (172,488 → 177,503)', () => {
    expect(withHeadroom(172_488n, true)).toBeGreaterThan(177_503n);
  });
});
