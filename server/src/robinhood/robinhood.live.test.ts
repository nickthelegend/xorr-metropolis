/**
 * Live: hits api.robinhood.com, the Chainlink feed directory and Robinhood Chain's public RPC.
 * Run with `LIVE=1 npx vitest run src/robinhood/robinhood.live.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { fetchAssets, fetchCorporateActions, fetchPrice, toWad } from './api.js';
import { stockCatalog } from './catalog.js';
import { chainlinkPrice, feedDirectory, poolForUsdg, quoteUsdgToToken, robinhoodClient, uiMultiplier } from './chain.js';
import { stockTradeCheck } from './guards.js';
import { tradability } from './session.js';

const live = process.env.LIVE ? describe : describe.skip;

const TOKENS = {
  NVDA: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC',
  TSLA: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d',
  AAPL: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9',
  SPY: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C',
} as const;

live('Robinhood Chain live', { timeout: 120_000 }, () => {
  it('the RPC is chain 4663', async () => {
    expect(await robinhoodClient().getChainId()).toBe(4663);
  });

  it('/rhj/assets lists the four headline tokens on 4663 with the real capability shape', async () => {
    const assets = await fetchAssets();
    expect(assets.length).toBeGreaterThan(50);
    for (const [sym, addr] of Object.entries(TOKENS)) {
      const a = assets.find((x) => x.tokenSymbol === sym)!;
      expect(a.deployments.find((d) => d.chainId === 4663)?.contractAddress.toLowerCase()).toBe(addr.toLowerCase());
      expect(a.tradingCapabilities.market.whole).toMatch(/^TRADING_STATUS_/);
      expect(tradability(a).reason).toContain(sym);
    }
  });

  it('/rhj/prices and /rhj/corporate-actions answer and validate', async () => {
    const q = await fetchPrice('NVDA');
    expect(Number(q.bid)).toBeGreaterThan(0);
    expect(Number(q.ask)).toBeGreaterThanOrEqual(Number(q.bid));
    expect(Array.isArray(await fetchCorporateActions())).toBe(true);
  });

  it('uiMultiplier() agrees with the API currentMultiplier', async () => {
    const assets = await fetchAssets();
    for (const [sym, addr] of Object.entries(TOKENS)) {
      const api = toWad(assets.find((x) => x.tokenSymbol === sym)!.currentMultiplier);
      const chain = await uiMultiplier(addr);
      const diff = chain > api ? chain - api : api - chain;
      expect(diff, sym).toBeLessThan(10n ** 9n);
    }
  });

  it('Chainlink feeds resolve from the directory and answer a positive price', async () => {
    expect((await feedDirectory()).size).toBeGreaterThan(20);
    for (const sym of Object.keys(TOKENS)) {
      const p = await chainlinkPrice(sym);
      expect(p.price, sym).toBeGreaterThan(1);
      expect(p.updatedAt.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
    }
  });

  it('each headline token has a funded USDG pool and a quote near Chainlink', async () => {
    for (const [sym, addr] of Object.entries(TOKENS)) {
      const pool = await poolForUsdg(addr);
      expect(pool, sym).not.toBeNull();
      const q = await quoteUsdgToToken(addr, 50, pool!);
      expect(q.amountOut).toBeGreaterThan(0n);
      const cl = await chainlinkPrice(sym);
      expect(Math.abs(q.impliedPrice - cl.price) / cl.price, sym).toBeLessThan(0.05);
    }
  });

  it('the catalog contains the four headline tokens with pools and feeds', async () => {
    const cat = await stockCatalog();
    for (const [sym, addr] of Object.entries(TOKENS)) {
      const e = cat.find((x) => x.symbol === sym)!;
      expect(e.address).toBe(addr);
      expect(e.chainlinkFeed).toBeDefined();
      expect(e.pool.usdg).toBeGreaterThan(1_000);
      expect(e.multiplierMismatch).toBe(false);
    }
  });

  it('the guard gives a verdict with a named reason', async () => {
    const r = await stockTradeCheck({ symbol: 'NVDA', side: 'buy', usdg: 50 });
    if (!r.ok) expect(['closed', 'halted', 'stale_feed', 'deviation']).toContain(r.reason);
    expect(r.detail.message.length).toBeGreaterThan(10);
  });
});
