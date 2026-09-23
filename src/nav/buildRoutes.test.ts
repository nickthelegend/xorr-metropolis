import { describe, expect, it } from 'vitest';
import { buildRedirect, hiddenOn, shownHere } from './buildRoutes';

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

  it('keeps the stock, market and money screens', () => {
    for (const p of ['/', '/xstocks', '/xstock/NVDA', '/markets', '/search', '/safety', '/deposit', '/send', '/activity', '/strategies']) {
      expect(hiddenOn(p), p).toBe(false);
    }
  });
});
