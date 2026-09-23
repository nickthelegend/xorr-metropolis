/**
 * The catalog's prices as two reads that do not wait for each other — the crypto feed and the Stock Token catalog
 * (`/market/xstocks`) — so each class draws as soon as its own source answers. See `prices.ts`.
 *
 * `stocks: false` is for a screen that has no use for share prices, so the slower read is not asked for nothing.
 */
import { useMemo } from 'react';
import { assetClasses } from '@/data/fixtures/markets';
import { fetchQuotes, type StockQuote } from '@/data/marketData';
import { system } from '@/data/system';
import { FEED_SYMBOLS, priceClasses, sourceOf, type PricedClass } from './prices';
import { useLiveRead } from './useLiveRead';
import { stockQuotesOf, withStockTokens } from './xstockClass';

export type MarketClass = PricedClass & { reload: () => void };

export function useMarketPrices(options: { stocks?: boolean } = {}): MarketClass[] {
  const withStocks = options.stocks !== false;
  const feed = useLiveRead(() => fetchQuotes([...FEED_SYMBOLS]), []);
  const stocks = useLiveRead(
    async () => (withStocks ? stockQuotesOf((await system.xstocks()).rows) : ({} as Record<string, StockQuote>)),
    [withStocks],
  );

  const { data: feedData, error: feedError, reload: reloadFeed } = feed;
  const { data: stockData, error: stockError, reload: reloadStocks } = stocks;

  return useMemo(() => {
    const classes = withStockTokens(assetClasses, stockData).filter((c) => withStocks || sourceOf(c) === 'feed');
    return priceClasses(
      classes,
      { data: feedData, error: feedError },
      { data: stockData, error: stockError },
    ).map((c) => ({ ...c, reload: sourceOf(c) === 'stocks' ? reloadStocks : reloadFeed }));
  }, [withStocks, feedData, feedError, stockData, stockError, reloadFeed, reloadStocks]);
}
