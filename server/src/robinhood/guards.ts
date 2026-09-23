/**
 * Risk gates before any Stock Token spend (PLAN P1.7). Each refusal names its reason and carries
 * the numbers it was decided on, so the audit trail can show why.
 *
 * Order: session (closed / not tradable) → halt → pool → feed freshness → fractional → deviation.
 * Cheap and decisive checks first; the quote (an RPC call) only once the trade could happen.
 */
import { getAddress, type Address } from 'viem';
import { deploymentOn, fetchAsset, fetchPrice, isActive, tokenPrice, type RobinhoodAsset, type RobinhoodQuote } from './api.js';
import {
  chainlinkPrice,
  deviationBps,
  poolForUsdg,
  quoteTokenToUsdg,
  quoteUsdgToToken,
  type ChainlinkPrice,
  type SwapQuote,
  type UsdgPool,
} from './chain.js';
import { tradability, type Phase, type Session } from './session.js';

export type GuardReason = 'closed' | 'halted' | 'fractional_not_allowed' | 'stale_feed' | 'deviation' | 'no_pool';

export type GuardDetail = {
  symbol: string;
  side: 'buy' | 'sell';
  usdg: number;
  message: string;
  session?: Session;
  phase?: Phase;
  sessionReason?: string;
  token?: Address;
  halted?: boolean;
  robinhood?: { bid: number; ask: number; mid: number; generatedAt: string };
  chainlink?: { price: number; ageSec: number; maxAgeSec: number; feed: Address; updatedAt: string };
  pool?: { address: Address; fee: number; usdg: number };
  quote?: { amountIn: string; amountOut: string; impliedPrice: number; tokens: number; shares: number };
  deviationBps?: number;
  maxDeviationBps?: number;
};

export type GuardResult = { ok: true; detail: GuardDetail } | { ok: false; reason: GuardReason; detail: GuardDetail };

export type GuardDeps = {
  asset(symbol: string): Promise<RobinhoodAsset | undefined>;
  price(symbol: string): Promise<RobinhoodQuote>;
  chainlink(symbol: string, now: Date): Promise<ChainlinkPrice>;
  pool(token: Address): Promise<UsdgPool | null>;
  quoteBuy(token: Address, usdg: number, pool: UsdgPool): Promise<SwapQuote>;
  quoteSell(token: Address, tokens: number, pool: UsdgPool): Promise<SwapQuote>;
};

export const liveGuardDeps: GuardDeps = {
  asset: fetchAsset,
  price: fetchPrice,
  chainlink: chainlinkPrice,
  pool: poolForUsdg,
  quoteBuy: quoteUsdgToToken,
  quoteSell: quoteTokenToUsdg,
};

export const maxDeviationBps = () => Number(process.env.ROBINHOOD_MAX_DEVIATION_BPS ?? 150);

export async function stockTradeCheck(
  input: { symbol: string; side: 'buy' | 'sell'; usdg: number; now?: Date },
  deps: GuardDeps = liveGuardDeps,
): Promise<GuardResult> {
  const now = input.now ?? new Date();
  const symbol = input.symbol.toUpperCase();
  const detail: GuardDetail = { symbol, side: input.side, usdg: input.usdg, message: '' };
  const refuse = (reason: GuardReason, message: string): GuardResult => ({
    ok: false,
    reason,
    detail: { ...detail, message },
  });

  if (!(input.usdg > 0)) return refuse('no_pool', `Amount must be positive (got ${input.usdg} USDG)`);

  const asset = await deps.asset(symbol);
  const dep = asset && deploymentOn(asset);
  if (!asset || !dep || !isActive(asset)) {
    return refuse('no_pool', `${symbol} is not an active Stock Token deployed on Robinhood Chain`);
  }
  const token = getAddress(dep.contractAddress);
  detail.token = token;

  // 1. Session.
  const t = tradability(asset, now);
  Object.assign(detail, { session: t.session, phase: t.phase, sessionReason: t.reason });
  if (t.session === 'closed' || (!t.whole && !t.fractional)) return refuse('closed', t.reason);

  // 2. Halt (Robinhood quote).
  const quote = await deps.price(symbol);
  const rh = tokenPrice(quote, asset.currentMultiplier);
  detail.halted = quote.isTradingHalt;
  detail.robinhood = { bid: rh.bid, ask: rh.ask, mid: rh.mid, generatedAt: quote.generatedAt };
  if (quote.isTradingHalt) return refuse('halted', `${symbol} trading is halted (Robinhood quote at ${quote.generatedAt})`);

  // 3. Pool.
  const pool = await deps.pool(token);
  if (!pool) return refuse('no_pool', `${symbol} has no funded USDG Uniswap v3 pool on Robinhood Chain`);
  detail.pool = { address: pool.pool, fee: pool.fee, usdg: pool.usdg };

  // 4. Feed freshness.
  const cl = await deps.chainlink(symbol, now);
  detail.chainlink = {
    price: cl.price,
    ageSec: cl.ageSec,
    maxAgeSec: cl.maxAgeSec,
    feed: cl.feed,
    updatedAt: cl.updatedAt.toISOString(),
  };
  if (cl.stale) {
    return refuse('stale_feed', `Chainlink ${symbol}/USD last updated ${cl.ageSec}s ago (max ${cl.maxAgeSec}s)`);
  }

  // 5. Quote in the trade's direction; fractional check on the resulting size.
  const multiplier = Number(asset.currentMultiplier);
  let q: SwapQuote;
  let tokens: number;
  if (input.side === 'buy') {
    q = await deps.quoteBuy(token, input.usdg, pool);
    tokens = Number(q.amountOut) / 1e18;
  } else {
    tokens = input.usdg / cl.price;
    q = await deps.quoteSell(token, tokens, pool);
  }
  const shares = tokens * multiplier;
  detail.quote = {
    amountIn: q.amountIn.toString(),
    amountOut: q.amountOut.toString(),
    impliedPrice: q.impliedPrice,
    tokens,
    shares,
  };
  if (!t.fractional && Math.abs(shares - Math.round(shares)) > 1e-6) {
    return refuse(
      'fractional_not_allowed',
      `${symbol} allows only whole shares in the ${t.session} session; ${input.usdg} USDG is ${shares.toFixed(6)} shares`,
    );
  }
  // `whole` untradable with `fractional` tradable is fine: xorr trades by USDG notional.

  // 6. Deviation: pool-implied vs Chainlink (both per TOKEN, multiplier-inclusive).
  const bps = deviationBps(q.impliedPrice, cl.price);
  const max = maxDeviationBps();
  detail.deviationBps = Math.round(bps * 10) / 10;
  detail.maxDeviationBps = max;
  if (!(bps <= max)) {
    return refuse(
      'deviation',
      `${symbol} pool price ${q.impliedPrice.toFixed(4)} is ${detail.deviationBps} bps from Chainlink ${cl.price.toFixed(4)} (max ${max})`,
    );
  }

  return {
    ok: true,
    detail: {
      ...detail,
      message: `${input.side} ${input.usdg} USDG of ${symbol}: ${t.session} session, pool ${q.impliedPrice.toFixed(4)} vs Chainlink ${cl.price.toFixed(4)} (${detail.deviationBps} bps ≤ ${max})`,
    },
  };
}
