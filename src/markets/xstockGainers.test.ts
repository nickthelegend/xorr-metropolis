import { describe, expect, it } from 'vitest';
import { xStockGainers } from './xstockClass';

const fmt = { price: (n: number) => `$${n.toFixed(2)}`, percent: (n: number) => `+${n.toFixed(2)}%` };
const row = (symbol: string, change24h?: number, price: number | null = 100) => ({
  symbol,
  name: `${symbol} Inc. • Robinhood Token`,
  price,
  feed: 'live' as const,
  ...(change24h === undefined ? {} : { change24h }),
});

describe('Stock Token gainers', () => {
  it('ranks the Stock Tokens that are up, largest first, and leaves out the ones down', () => {
    const { gainers, measured } = xStockGainers([row('AAPL', -0.9), row('COIN', 13.7), row('NVDA', 0.4)], 5, fmt);
    expect(measured).toBe(true);
    expect(gainers.map((g) => g.sym)).toEqual(['COIN', 'NVDA']);
    expect(gainers[0]).toMatchObject({ name: 'COIN Inc.', chg: '+13.70%', px: '$100.00', up: true });
  });

  it('says when no Stock Token has a day of recorded prices yet', () => {
    expect(xStockGainers([row('NVDA'), row('TSLA')], 5, fmt)).toEqual({ gainers: [], measured: false });
  });
});
