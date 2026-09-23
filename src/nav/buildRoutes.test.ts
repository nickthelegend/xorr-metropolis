import { describe, expect, it } from 'vitest';
import { PERPS_ROUTE, TRADE_ROUTE, buildRedirect, hiddenOn, shownHere } from './buildRoutes';

describe('the screens this build has', () => {
  it('hides a Base or Hyperliquid route and everything under it', () => {
    expect(hiddenOn('/perp/BTC')).toBe(true);
    expect(hiddenOn('/yield')).toBe(true);
    expect(hiddenOn('/limit-orders?x=1')).toBe(true);
    expect(buildRedirect('/futures')).toBe('/not-here?from=%2Ffutures');
  });

  it('keeps the EVM delegation screens the Solana build hid', () => {
    for (const p of ['/approvals', '/history', '/verify', '/judge', '/audit/anchor', '/policy', '/flatten', '/sell-everything', '/networks', '/order/NVDA']) {
      expect(hiddenOn(p), p).toBe(false);
      expect(shownHere(p), p).toBe(true);
      expect(buildRedirect(p), p).toBeNull();
    }
  });

  it('keeps the market and money screens', () => {
    for (const p of ['/', '/markets', '/search', '/safety', '/deposit', '/send', '/activity', '/strategies', '/council']) {
      expect(hiddenOn(p), p).toBe(false);
    }
  });

  it('on Monad, hides the Arbitrum and Robinhood Chain screens and sends Trade to Markets', () => {
    // The app builds for monad-fork by default (src/chain.ts).
    for (const p of ['/hedge', '/xstocks', '/xstock/NVDA', '/earnings']) {
      expect(hiddenOn(p), p).toBe(true);
    }
    expect(TRADE_ROUTE).toBe('/markets');
    // The desk needs Perpl on the chain itself, which a fork has not: the live read-only view stands in for it there.
    expect(hiddenOn('/perps'), 'no Perpl desk on a fork').toBe(true);
    expect(hiddenOn('/perpl'), 'Perpl live is every Monad build').toBe(false);
    expect(PERPS_ROUTE).toBe('/perpl');
  });
});
