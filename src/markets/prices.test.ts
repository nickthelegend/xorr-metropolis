/**
 * Each class is priced by its own read, and a failed read is a failure rather than a list of dashes.
 */
import { describe, expect, it, vi } from 'vitest';

// These pin the catalog of a build that lists Stock Tokens (Arbitrum/Robinhood); the Monad catalog is
// `markets-monad.test.ts`. Set before the modules below are imported, which read the chain once.
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_XORR_CHAIN = 'arbitrum-fork';
});
import { assetClasses } from '@/data/fixtures/markets';
import type { Quote, StockQuote } from '@/data/marketData';
import { FEED_SYMBOLS, priceClasses, priceInstrument, sourceOf } from './prices';

const byId = (id: string) => assetClasses.find((c) => c.id === id)!;
const inst = (sym: string) => assetClasses.flatMap((c) => c.instruments).find((i) => i.sym === sym)!;

const quote = (price: number, change24h: number): Quote => ({ price, change24h, source: 'coingecko' });
const share = (symbol: string, price: number | null): StockQuote => ({
  symbol,
  name: symbol,
  address: '0x0',
  price,
  venues: [],
  feed: price === null ? 'unavailable' : 'live',
});

describe('one instrument, priced', () => {
  it('takes a feed quote with its day’s change', () => {
    const btc = priceInstrument(inst('BTC'), { BTC: quote(80_000, -1.234) }, {});
    expect(btc).toMatchObject({ px: '$80,000', chg: '−1.23%', up: false, feed: 'live' });
  });

  it('prices a share from the catalog, with no invented change, and a share with no price as no price', () => {
    const nvda = { ...inst('BTC'), sym: 'NVDA', classId: 'stocks' as const };
    expect(priceInstrument(nvda, {}, { NVDA: share('NVDA', 232.14) })).toMatchObject({
      px: '$232.14',
      chg: '',
      feed: 'live',
    });
    expect(priceInstrument(nvda, {}, { NVDA: share('NVDA', null) })).toMatchObject({
      px: '—',
      feed: 'unavailable',
    });
  });

  it('shows a dash for a live instrument the answer left out — never the catalog’s number', () => {
    expect(priceInstrument(inst('ETH'), {}, {})).toMatchObject({ px: '—', chg: '', feed: 'unavailable' });
  });

});

describe('classes follow their own read', () => {
  it('asks the feed for everything but the shares', () => {
    expect(FEED_SYMBOLS).toContain('BTC');
    expect(FEED_SYMBOLS).toContain('ETH');
    expect(sourceOf(byId('stocks'))).toBe('stocks');
    expect(sourceOf(byId('crypto'))).toBe('feed');
  });

  it('draws crypto while the share snapshot is still out', () => {
    const classes = priceClasses(assetClasses, { data: { BTC: quote(80_000, 1) } }, {});
    expect(classes.find((c) => c.id === 'crypto')!.state).toBe('ready');
    expect(classes.find((c) => c.id === 'stocks')!.state).toBe('loading');
  });

  it('fails only the class whose read failed, with the error', () => {
    const boom = new Error('503 for /market/xstocks');
    const classes = priceClasses(assetClasses, { data: {} }, { error: boom });
    const stocks = classes.find((c) => c.id === 'stocks')!;
    expect(stocks.state).toBe('failed');
    expect(stocks.error).toBe(boom);
    expect(classes.filter((c) => c.state === 'failed')).toHaveLength(1);
  });

  it('keeps the catalog rows, unpriced, for a class still loading', () => {
    const loading = priceClasses([byId('crypto')], {}, {})[0]!;
    expect(loading.state).toBe('loading');
    expect(loading.instruments).toBe(byId('crypto').instruments);
  });
});
