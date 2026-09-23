/**
 * The Stocks class: the Stock Tokens this executor lists (`/market/xstocks`), not a catalogue kept in the app.
 *
 * The class's rows are the tokens the executor returned, each with its own price or "no price", and there are none until
 * it has answered — a name that looked listed and could never be priced or bought is worse than a shorter list.
 */
import { assetGradient } from '@/design/gradients';
import type { StockQuote } from '@/data/marketData';
import type { XStockRow } from '@/data/system';
import type { AssetClass, Instrument } from '@/data/types';
import { isPriced, stockName } from './catalog';

/** The catalog's rows keyed by symbol, in the shape the market list prices a share from. */
export function stockQuotesOf(rows: readonly XStockRow[]): Record<string, StockQuote> {
  return Object.fromEntries(
    rows.map((r) => [
      r.symbol,
      {
        symbol: r.symbol,
        name: stockName(r.name),
        address: r.address,
        price: isPriced(r) ? r.price : null,
        venues: [],
        feed: isPriced(r) ? ('live' as const) : ('unavailable' as const),
        ...(typeof r.change24hPct === 'number' ? { change24h: r.change24hPct } : {}),
      },
    ]),
  );
}

export function withStockTokens(
  classes: readonly AssetClass[],
  stocks: Readonly<Record<string, StockQuote>> | undefined,
): AssetClass[] {
  return classes.map((cls) => {
    if (cls.id !== 'stocks') return cls;
    const rows = Object.values(stocks ?? {});
    return {
      ...cls,
      more: 'All stocks',
      instruments: rows.map((r) => {
        const { c1, c2 } = assetGradient(r.symbol);
        return {
          sym: r.symbol,
          name: stockName(r.name),
          tag: 'Stock Token',
          px: '—',
          chg: '',
          up: true,
          c1,
          c2,
          classId: 'stocks' as const,
          feed: 'live' as const,
          mint: r.address,
        };
      }),
    };
  });
}

/**
 * Home's Gainers: the Stock Tokens that are up over 24h, largest first.
 *
 * A change exists only where the executor reported one, so `measured` says whether any did: "nothing is up" and "not a
 * day of prices yet" are different sentences.
 */
export function xStockGainers(
  rows: readonly { symbol: string; name: string; price: number | null; feed: 'live' | 'unavailable'; change24h?: number }[],
  count: number,
  fmt: { price: (n: number) => string; percent: (n: number) => string },
): { gainers: Instrument[]; measured: boolean } {
  const measured = rows.some((r) => r.change24h !== undefined);
  const gainers = rows
    .filter((r) => r.feed === 'live' && r.price != null && r.change24h !== undefined && r.change24h > 0)
    .sort((a, b) => b.change24h! - a.change24h!)
    .slice(0, count)
    .map((r) => ({
      ...assetGradient(r.symbol),
      sym: r.symbol,
      name: stockName(r.name),
      tag: 'Stock Token',
      px: fmt.price(r.price!),
      chg: fmt.percent(r.change24h!),
      up: true,
      classId: 'stocks' as const,
      feed: 'live' as const,
    }));
  return { gainers, measured };
}
