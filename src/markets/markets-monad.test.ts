/**
 * What the Monad build (the default) lists and buys: MON first, then ETH and BTC, each bought as the ERC-20 Monad's
 * Uniswap v3 pools hold; no Stock Token class; perps on their own screen.
 */
import { describe, expect, it } from 'vitest';
import { assetClasses } from '@/data/fixtures/markets';
import { DEFAULT_BUY, isTradable, settlementSymbol } from '@/data/tradable';

describe('the Monad market catalog', () => {
  it('lists MON, ETH and BTC as crypto, and no Stock Token class', () => {
    expect(assetClasses.map((c) => c.id)).toEqual(['crypto']);
    expect(assetClasses[0]!.instruments.map((i) => i.sym)).toEqual(['MON', 'ETH', 'BTC']);
  });

  it('buys MON as WMON, ETH as WETH and BTC as WBTC, and defaults to WMON', () => {
    expect(settlementSymbol('MON')).toBe('WMON');
    expect(settlementSymbol('ETH')).toBe('WETH');
    expect(settlementSymbol('BTC')).toBe('WBTC');
    expect(DEFAULT_BUY).toBe('WMON');
    for (const s of ['MON', 'ETH', 'BTC', 'USDT0']) expect(isTradable(s), s).toBe(true);
  });
});
