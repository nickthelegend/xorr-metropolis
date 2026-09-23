import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import assetsFixture from './fixtures/assets.json';
import nvdaFixture from './fixtures/prices-nvda.json';
import { assetsResponseSchema, pricesResponseSchema, type RobinhoodQuote } from './api.js';
import type { ChainlinkPrice, SwapQuote, UsdgPool } from './chain.js';
import { stockTradeCheck, type GuardDeps } from './guards.js';

const assets = assetsResponseSchema.parse(assetsFixture).assets;
const nvdaQuote = pricesResponseSchema.parse(nvdaFixture).quotes[0]!;

// Real reads from 2026-09-23 ~04:30Z (Wed 00:30 ET, overnight session).
const NOW = new Date('2026-09-23T04:30:00Z');
const NVDA_POOL: UsdgPool = { pool: '0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3', fee: 500, usdg: 4_594_613.25, usdgBalance: 4594613251944n };
const NVDA_CL: ChainlinkPrice = {
  symbol: 'NVDA',
  price: 229.02739517,
  answer: 22902739517n,
  decimals: 8,
  updatedAt: new Date(1_790_089_676_000),
  ageSec: 600,
  stale: false,
  maxAgeSec: 86_400,
  feed: '0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15',
  roundId: 18446744073709552699n,
};
// QuoterV2: 100 USDG → 0.436820339972901721 NVDA.
const buyQuote = (token: Address, usdg: number, pool: UsdgPool, perToken = 100 / 0.436820339972901721): SwapQuote => ({
  tokenIn: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  tokenOut: token,
  amountIn: BigInt(usdg * 1e6),
  amountOut: BigInt(Math.round((usdg / perToken) * 1e9)) * 10n ** 9n,
  fee: pool.fee,
  pool: pool.pool,
  gasEstimate: 109_353n,
  impliedPrice: perToken,
});

function deps(over: Partial<GuardDeps> = {}): GuardDeps {
  return {
    asset: async (s) => assets.find((a) => a.tokenSymbol === s),
    price: async (): Promise<RobinhoodQuote> => nvdaQuote,
    chainlink: async (s) => ({ ...NVDA_CL, symbol: s }),
    pool: async () => NVDA_POOL,
    quoteBuy: async (t, u, p) => buyQuote(t, u, p),
    quoteSell: async (t, tokens, p) => ({
      ...buyQuote(t, 100, p),
      tokenIn: t,
      amountIn: BigInt(Math.round(tokens * 1e9)) * 10n ** 9n,
      amountOut: BigInt(Math.round(tokens * 228.9 * 1e6)),
      impliedPrice: 228.9,
    }),
    ...over,
  };
}

const check = (over: Partial<GuardDeps> = {}, input: Partial<Parameters<typeof stockTradeCheck>[0]> = {}) =>
  stockTradeCheck({ symbol: 'NVDA', side: 'buy', usdg: 100, now: NOW, ...input }, deps(over));

describe('stockTradeCheck', () => {
  it('passes a 100 USDG NVDA buy on the real 2026-09-23 numbers', async () => {
    const r = await check();
    expect(r.ok).toBe(true);
    expect(r.detail.session).toBe('overnight');
    expect(r.detail.deviationBps).toBeLessThan(5);
    expect(r.detail.pool?.fee).toBe(500);
    expect(r.detail.quote?.tokens).toBeCloseTo(0.43682034, 6);
  });

  it('passes a sell, quoting token → USDG', async () => {
    const r = await check({}, { side: 'sell' });
    expect(r.ok).toBe(true);
    expect(r.detail.quote?.tokens).toBeCloseTo(100 / 229.02739517, 9);
  });

  it('refuses when the market is closed (Saturday)', async () => {
    const r = await check({}, { now: new Date('2026-09-26T16:00:00Z') });
    expect(r).toMatchObject({ ok: false, reason: 'closed' });
    expect(r.detail.message).toContain('weekend');
  });

  it('refuses when the session flags say untradable', async () => {
    const asset = structuredClone(assets.find((a) => a.tokenSymbol === 'NVDA')!);
    asset.tradingCapabilities.overnight = { whole: 'TRADING_STATUS_UNTRADABLE', fractional: 'TRADING_STATUS_UNTRADABLE' };
    const r = await check({ asset: async () => asset });
    expect(r).toMatchObject({ ok: false, reason: 'closed' });
  });

  it('refuses a halted symbol', async () => {
    const r = await check({ price: async () => ({ ...nvdaQuote, isTradingHalt: true }) });
    expect(r).toMatchObject({ ok: false, reason: 'halted' });
  });

  it('refuses without a funded pool, and an unknown symbol', async () => {
    expect(await check({ pool: async () => null })).toMatchObject({ ok: false, reason: 'no_pool' });
    expect(await check({}, { symbol: 'ZZZZ' })).toMatchObject({ ok: false, reason: 'no_pool' });
  });

  it('refuses a stale feed', async () => {
    const r = await check({ chainlink: async () => ({ ...NVDA_CL, ageSec: 90_000, stale: true }) });
    expect(r).toMatchObject({ ok: false, reason: 'stale_feed' });
    expect(r.detail.message).toContain('90000s');
  });

  it('refuses a fractional notional where Robinhood allows only whole shares (WYFI)', async () => {
    const r = await check({}, { symbol: 'WYFI' });
    expect(r).toMatchObject({ ok: false, reason: 'fractional_not_allowed' });
  });

  it('refuses when the pool strays past the threshold, and honours ROBINHOOD_MAX_DEVIATION_BPS', async () => {
    const off = { quoteBuy: async (t: Address, u: number, p: UsdgPool) => buyQuote(t, u, p, 229.02739517 * 1.02) };
    const r = await check(off);
    expect(r).toMatchObject({ ok: false, reason: 'deviation' });
    expect(r.detail.deviationBps).toBeCloseTo(200, 0);
    process.env.ROBINHOOD_MAX_DEVIATION_BPS = '250';
    try {
      expect((await check(off)).ok).toBe(true);
    } finally {
      delete process.env.ROBINHOOD_MAX_DEVIATION_BPS;
    }
  });
});
