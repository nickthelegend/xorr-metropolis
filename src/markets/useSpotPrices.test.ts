import { describe, expect, it } from 'vitest';
import { sharePriced } from './useSpotPrices';

describe('sharePriced', () => {
  it('prices the tokenized shares from the snapshot', () => {
    expect(sharePriced('NVDAc')).toBe(true);
  });

  it('leaves SPYx to the feed, where it is an index row', () => {
    expect(sharePriced('SPYx')).toBe(false);
  });

  it('never sends crypto or cash to the snapshot', () => {
    for (const s of ['ETH', 'BTC', 'USDC', 'USDG', 'XAUT']) expect(sharePriced(s)).toBe(false);
  });
});
