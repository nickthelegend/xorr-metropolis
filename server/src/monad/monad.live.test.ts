/**
 * The Monad read modules against Monad mainnet itself (LIVE=1 npm run test:live). Nothing here is mocked: if Chainlink,
 * Kuru, Uniswap or Perpl stop answering the way `monad/*.ts` expects, this is where it shows.
 */
import { describe, expect, it } from 'vitest';
import { readFeed } from './chainlink.js';
import { readBook } from './kuru.js';
import { perplContext } from './perpl.js';
import { crosscheckMon } from './crosscheck.js';

const live = process.env.LIVE ? describe : describe.skip;

live('Monad mainnet, live', () => {
  it('Chainlink MON/USD answers a fresh, positive price', async () => {
    const r = await readFeed('MON');
    console.log(`Chainlink MON/USD $${r.price} (${r.ageSec}s old)`);
    expect(r.price).toBeGreaterThan(0);
    expect(r.stale).toBe(false);
  });

  it('Kuru MON/USDC has both sides resting, bid below ask', async () => {
    const b = await readBook('MON/USDC');
    console.log(`Kuru MON/USDC bid ${b.bid} ask ${b.ask} (${b.spreadBps?.toFixed(2)} bps)`);
    expect(b.bid).not.toBeNull();
    expect(b.ask).not.toBeNull();
    expect(b.ask!).toBeGreaterThanOrEqual(b.bid!);
  });

  it('Perpl lists open markets with a mark, BTC and MON among them', async () => {
    const c = await perplContext();
    const names = c.markets.map((m) => m.name);
    console.log(`Perpl: ${c.markets.map((m) => `${m.name} ${m.mark}`).join(', ')}`);
    expect(names).toEqual(expect.arrayContaining(['BTC', 'MON']));
    expect(c.markets.find((m) => m.name === 'BTC')?.mark).toBeGreaterThan(0);
  });

  it('the three MON prices agree to within 1%', async () => {
    const x = await crosscheckMon();
    console.log(JSON.stringify({ uniswap: x.uniswap.ok && x.uniswap.price, kuru: x.kuru.ok && x.kuru.price, chainlink: x.chainlink.ok && x.chainlink.price, maxGapBps: x.maxGapBps }));
    expect(x.maxGapBps).not.toBeNull();
    expect(x.maxGapBps!).toBeLessThan(100);
  });
}, 60_000);
