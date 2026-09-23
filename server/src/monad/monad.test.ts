/**
 * The Monad read modules, without the network: Kuru's empty-side sentinel, Chainlink's staleness, Perpl's scaling, and
 * the gap between sources. The same reads against chain 143 itself are `monad.live.test.ts`.
 */
import { maxUint256, type PublicClient } from 'viem';
import { describe, expect, it } from 'vitest';
import { bookFrom, side } from './kuru.js';
import { feedFor, readFeed } from './chainlink.js';
import { parseContext, parseMarket } from './perpl.js';
import { maxGapBps } from './crosscheck.js';

describe('Kuru, the top of a book', () => {
  it('reads 18-decimal prices, and a mid and spread only when both sides rest', () => {
    const b = bookFrom('MON/USDC', 24_069_000_000_000_000n, 24_085_000_000_000_000n);
    expect(b.bid).toBeCloseTo(0.024069, 9);
    expect(b.ask).toBeCloseTo(0.024085, 9);
    expect(b.mid).toBeCloseTo(0.024077, 9);
    expect(b.spreadBps).toBeCloseTo(6.645, 2);
  });

  it('calls an empty side empty — 0 and 2^256−1 are sentinels, not prices', () => {
    expect(side(0n)).toBeNull();
    expect(side(maxUint256)).toBeNull();
    // What the MON/AUSD book answered on 2026-09-24.
    expect(bookFrom('MON/AUSD', maxUint256, 0n)).toMatchObject({ bid: null, ask: null, mid: null, spreadBps: null });
  });

  it('has no mid for a crossed book', () => {
    expect(bookFrom('MON/USDC', 25_000_000_000_000_000n, 24_000_000_000_000_000n).mid).toBeNull();
  });
});

describe('Chainlink, one feed', () => {
  const client = (answer: bigint, updatedAt: bigint) =>
    ({
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === 'decimals' ? 8 : [1n, answer, updatedAt, updatedAt, 1n],
    }) as unknown as PublicClient;

  it('scales by the feed decimals and dates the round', async () => {
    const r = await readFeed('MON', { client: client(2_407_000n, 1_790_192_796n), nowSec: 1_790_192_834 });
    expect(r).toMatchObject({ symbol: 'MON', price: 0.02407, ageSec: 38, stale: false });
    expect(r.updatedAt).toBe('2026-09-23T19:46:36.000Z');
  });

  it('says a round older than the limit is stale, and refuses an answer that is not a price', async () => {
    expect((await readFeed('ETH', { client: client(267_603_000_000n, 1_000n), nowSec: 10_000, maxAgeSec: 3600 })).stale).toBe(true);
    await expect(readFeed('MON', { client: client(0n, 1n), nowSec: 2 })).rejects.toThrow('not a price');
  });

  it('prices WMON by the MON feed and WETH by the ETH feed, and names no feed it does not have', () => {
    expect(feedFor('WMON')).toBe('MON');
    expect(feedFor('weth')).toBe('ETH');
    expect(feedFor('WBTC')).toBeUndefined();
  });
});

describe('Perpl, the public context', () => {
  it('scales mark, book and open interest by the market decimals, and passes funding through unconverted', () => {
    const m = parseMarket({
      id: 1,
      name: 'BTC',
      config: { is_open: true, price_decimals: 1, size_decimals: 5 },
      state: { at: { t: 1_790_192_836_000 }, mrk: 844_583, bid: 844_651, ask: 844_652, oi: 842_670 },
      funding: { rate: -40 },
    });
    expect(m).toMatchObject({ name: 'BTC', open: true, mark: 84_458.3, bid: 84_465.1, ask: 84_465.2, fundingRateRaw: -40 });
    expect(m.openInterest).toBeCloseTo(8.4267, 6);
    expect(m.at).toBe('2026-09-23T19:47:16.000Z');
  });

  it('leaves what is missing unknown, and keeps the geo block list', () => {
    const c = parseContext({ markets: [{ id: 9, name: 'MON' }], geo_block: ['US', 'GB'] });
    expect(c.markets[0]).toMatchObject({ open: false, mark: null, openInterest: null, fundingRateRaw: null, at: null });
    expect(c.geoBlock).toEqual(['US', 'GB']);
  });
});

describe('the gap between sources', () => {
  it('is the spread between the highest and lowest, in bps of the lowest, and needs two', () => {
    expect(maxGapBps([0.02407, 0.024077, 0.02416])).toBeCloseTo(37.39, 1);
    expect(maxGapBps([0.024])).toBeNull();
    expect(maxGapBps([])).toBeNull();
  });
});
