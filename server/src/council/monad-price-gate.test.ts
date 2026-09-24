/**
 * The council's price check applied to a buy placed by hand (PLAN P2.2): the fill against Chainlink on Monad, the same
 * limit, the same staleness rule — and a price that cannot be checked is refused, never waved through.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  // The real registry, for Monad's fork: every module monad-inputs imports reads it.
  process.env.XORR_CHAIN = 'monad-fork';
  return {
  feed: { price: 0.024, ageSec: 60 },
  fillOut: 4166.6, // WMON for $100 → $0.0240/MON
  feedThrows: false,
  };
});

vi.mock('../monad/mainnet.js', () => ({ monadMainnet: () => ({}) }));
vi.mock('../monad/chainlink.js', () => ({
  CHAINLINK_MONAD: {},
  feedFor: (s: string) => (s === 'BTC' ? 'BTC' : s === 'ETH' ? 'ETH' : 'MON'),
  readFeed: vi.fn(async (symbol: string) => {
    if (h.feedThrows) throw new Error('execution reverted');
    return { symbol, feed: '0xfeed', price: h.feed.price, ageSec: h.feed.ageSec, updatedAt: '2026-09-24T00:00:00Z', stale: false };
  }),
}));
vi.mock('../monad/kuru.js', () => ({ readBook: vi.fn(async () => ({ mid: 0.02401, spreadBps: 4 })) }));
vi.mock('../venues/uniswap.js', () => ({ quote: vi.fn(async () => ({ outAmount: h.fillOut })) }));
vi.mock('../venues/tokens.js', () => ({ canonicalSymbol: (s: string) => s, ensureRegistry: async () => undefined }));

const { manualPriceGate, MAX_FILL_GAP_BPS } = await import('./monad-inputs.js');

beforeEach(() => {
  h.feed = { price: 0.024, ageSec: 60 };
  h.fillOut = 4166.6;
  h.feedThrows = false;
});

describe('a buy placed by hand on Monad', () => {
  it('passes when the fill is within the limit of Chainlink', async () => {
    const g = await manualPriceGate('WMON', 100);
    expect(g).toMatchObject({ ok: true });
    expect((g as { gapBps: number }).gapBps).toBeLessThan(MAX_FILL_GAP_BPS);
  });

  it('is refused past the limit, naming the fill, Chainlink, the gap and Kuru', async () => {
    h.fillOut = 3800; // $0.02632 a MON against Chainlink's $0.024: ~966 bps
    const g = await manualPriceGate('WMON', 100);
    expect(g).toMatchObject({ ok: false });
    const detail = (g as { detail: string }).detail;
    expect(detail).toMatch(/is \d+ bps from Chainlink \(\$0\.02400\), past the 150 bps limit; Kuru's mid is \$0\.02401\. Nothing was placed\./);
  });

  it('is refused when Chainlink’s round is older than its heartbeat', async () => {
    h.feed = { price: 0.024, ageSec: 7200 };
    const g = await manualPriceGate('WMON', 100);
    expect((g as { detail: string }).detail).toMatch(/round is 120 min old, past its 60-minute heartbeat/);
  });

  it('is refused, with the reason, when the price cannot be checked at all', async () => {
    h.feedThrows = true;
    const g = await manualPriceGate('WETH', 100);
    expect(g).toEqual({ ok: false, detail: 'The price could not be checked against Chainlink (execution reverted), so nothing was placed.' });
  });

  it('has nothing to say about a token with no feed to check against', async () => {
    expect(await manualPriceGate('USDT0', 100)).toBeNull();
  });
});
