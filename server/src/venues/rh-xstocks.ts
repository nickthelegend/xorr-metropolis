/**
 * The app's stock endpoints answered from Robinhood Chain (PLAN.md P1.6/P1.8/P4.4, 2026-09-23): `/market/xstocks`,
 * `/market/xstocks/quote`, and the buy/sell doors.
 *
 * The response shapes are the ones the app already reads for the Solana xStocks (`src/data/system.ts` `XStockRow`,
 * `XStockQuote`, `XStockBuyOutcome`), with Robinhood's facts ADDED beside them — never renamed — so the screens keep
 * working and can grow into the new fields:
 *
 *   - `price` is USDG per TOKEN from the Uniswap v3 pool a buy fills in (on a fork, the fork's own pool). `underlyingPrice`
 *     is the token's Chainlink feed (multiplier-inclusive, USD per token) read on Robinhood Chain, with `underlyingAt` its
 *     `updatedAt`. Both per token, so they compare directly.
 *   - ERC-8056: `multiplier` (Robinhood's `currentMultiplier`) and `onchainMultiplier` (`uiMultiplier()` on the chain)
 *     say how many shares one token is; a quote reports `receiveShares` beside `receive` (tokens).
 *   - `tradingCapabilities`, `session` and the corporate-action notices come from Robinhood's `/rhj/assets`.
 *
 * Only tokens that trade HERE are rows: the live catalog narrowed to tokens and pools with code on this node
 * (`venues/rh-stocks.ts`). On the hosted fork that is NVDA, TSLA, AAPL and SPY; `notOnThisNode` says how many catalog
 * tokens were left out and why, rather than listing rows a buy would revert on.
 */
import { formatUnits } from 'viem';
import { CHAIN_KEY } from '../evm/chains.js';
import { chainlinkPrice } from '../robinhood/chain.js';
import { fetchPrice } from '../robinhood/api.js';
import { stockCatalog } from '../robinhood/catalog.js';
import { tradability } from '../robinhood/session.js';
import { stockGuard } from '../executor/stock-guard.js';
import { UnpricedError } from './jupiter.js';
import { robinhoodStocks, rhStockAsync, type RhStock } from './rh-stocks.js';
import { stockPriceUsd } from './stocks.js';
import { SETTLEMENT_SYMBOL } from './tokens.js';
import { FEE_TIERS, quoteRoute, scale } from './uniswap.js';

export const VENUE = 'Uniswap v3';

export type RhStockRow = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  /** Robinhood's API carries no sector, so none is given: the app then names the company instead. */
  sector: null;
  price: number | null;
  underlyingPrice: number | null;
  change24hPct: number | null;
  liquidityUsd: number | null;
  underlyingAt: string | null;
  feed: 'live' | 'unavailable';
  // ── added for Robinhood Chain ──
  chain: string;
  logoUrl?: string;
  multiplier: string;
  onchainMultiplier: string | null;
  multiplierMismatch: boolean;
  chainlinkFeed: string | null;
  chainlinkStale: boolean | null;
  pool: { address: string; fee: number; usdg: number };
  tradingCapabilities: RhStock['tradingCapabilities'];
  /** The session word the app's chip reads: market | extended | overnight | closed. */
  session: string;
  sessionDetail: { session: string; phase: string; whole: boolean; fractional: boolean; reason: string };
  /** Robinhood's own halt flag for the underlying (`/rhj/prices`), or null when it could not be read. */
  halted: boolean | null;
  /** The Chainlink print (multiplier-inclusive, per token) and when it was written — `underlyingPrice`/`underlyingAt` again, named for the app. */
  chainlinkPrice: number | null;
  chainlinkUpdatedAt: string | null;
  /** The pool's own price per token (what a buy fills against) and how far it sits from Chainlink, in basis points. */
  poolPrice: number | null;
  deviationBps: number | null;
  pendingMultiplier: RhStock['pendingMultiplier'] | null;
  corporateActions: string[];
  tradable: true;
};

export type RhCatalogResponse = {
  rows: RhStockRow[];
  sectors: string[];
  unpriced: number;
  // ── added ──
  chain: string;
  /** Catalog tokens left out because their token or pool has no code on this node (a fork holding part of the chain). */
  notOnThisNode: number;
  catalogSize: number;
};

async function row(s: RhStock, now: Date): Promise<RhStockRow> {
  const [price, cl, quote] = await Promise.all([
    stockPriceUsd(s.symbol).catch(() => null),
    chainlinkPrice(s.symbol, now).catch(() => null),
    fetchPrice(s.symbol).catch(() => null),
  ]);
  const t = tradability({ tokenSymbol: s.symbol, tradingCapabilities: s.tradingCapabilities }, now);
  return {
    symbol: s.symbol,
    name: s.name,
    address: s.address,
    decimals: 18,
    sector: null,
    price: price && price > 0 ? price : null,
    underlyingPrice: cl?.price ?? null,
    change24hPct: null,
    liquidityUsd: s.pool.usdg,
    underlyingAt: cl ? cl.updatedAt.toISOString() : null,
    feed: price && price > 0 ? 'live' : 'unavailable',
    chain: CHAIN_KEY,
    logoUrl: s.logoUrl,
    multiplier: s.multiplier,
    onchainMultiplier: s.onchainMultiplier === undefined ? null : formatUnits(s.onchainMultiplier, 18),
    multiplierMismatch: s.multiplierMismatch,
    chainlinkFeed: s.chainlinkFeed ?? null,
    chainlinkStale: cl ? cl.stale : null,
    pool: { address: s.pool.address, fee: s.pool.fee, usdg: s.pool.usdg },
    tradingCapabilities: s.tradingCapabilities,
    session: t.session,
    sessionDetail: { session: t.session, phase: t.phase, whole: t.whole, fractional: t.fractional, reason: t.reason },
    halted: quote ? quote.isTradingHalt : null,
    chainlinkPrice: cl?.price ?? null,
    chainlinkUpdatedAt: cl ? cl.updatedAt.toISOString() : null,
    poolPrice: price && price > 0 ? price : null,
    deviationBps: price && price > 0 && cl ? Math.round((Math.abs(price - cl.price) / cl.price) * 10_000 * 10) / 10 : null,
    pendingMultiplier: s.pendingMultiplier ?? null,
    corporateActions: s.corporateActions,
    tradable: true,
  };
}

export async function rhCatalog(now = new Date()): Promise<RhCatalogResponse> {
  const [stocks, catalog] = await Promise.all([robinhoodStocks(), stockCatalog()]);
  const rows = await Promise.all(stocks.map((s) => row(s, now)));
  return {
    rows,
    sectors: [],
    unpriced: rows.filter((r) => r.feed !== 'live').length,
    chain: CHAIN_KEY,
    notOnThisNode: catalog.length - stocks.length,
    catalogSize: catalog.length,
  };
}

/** The breakdown for one order — the `XStockQuote` shape, from a real QuoterV2 quote along the pool the fill uses. */
export async function rhStockQuote(params: {
  symbol: string;
  side: 'buy' | 'sell';
  usd: number;
  slippageBps: number;
}) {
  const s = await rhStockAsync(params.symbol);
  if (!s) throw new UnpricedError(`${params.symbol} is not a Stock Token that trades on ${CHAIN_KEY}.`);
  if (!(params.usd > 0)) throw new UnpricedError('The amount must be above zero.');
  const markPrice = await stockPriceUsd(s.symbol).catch(() => null);
  if (!markPrice || !(markPrice > 0)) throw new UnpricedError(`No price for ${s.symbol}, so its cost cannot be broken down.`);

  const buying = params.side === 'buy';
  const route = { tokens: buying ? [SETTLEMENT_SYMBOL, s.symbol] : [s.symbol, SETTLEMENT_SYMBOL], fees: [s.pool.fee] };
  const amountIn = buying ? scale(params.usd, 6) : scale(params.usd / markPrice, 18);
  let amountOut: bigint;
  try {
    ({ amountOut } = await quoteRoute(route, amountIn));
  } catch (e) {
    throw new UnpricedError(`No quote for ${s.symbol} at this size (${e instanceof Error ? e.message.split('\n')[0] : String(e)}).`);
  }
  const pay = Number(formatUnits(amountIn, buying ? 6 : 18));
  const receive = Number(formatUnits(amountOut, buying ? 18 : 6));
  const minimumReceive = receive * (1 - params.slippageBps / 10_000);
  const receivedUnitUsd = buying ? markPrice : 1;
  // Impact against the mark (a small probe through the same pool): what this size costs beyond the pool's own price.
  const effectivePrice = buying ? pay / receive : receive / pay;
  const impactPct = buying ? Math.max(0, (effectivePrice / markPrice - 1) * 100) : Math.max(0, (1 - effectivePrice / markPrice) * 100);
  const multiplier = s.onchainMultiplier === undefined ? Number(s.multiplier) : Number(formatUnits(s.onchainMultiplier, 18));

  // The same gate the buy will face, previewed: session, halt, feed and deviation, without writing a refusal anywhere.
  const guard = await stockGuard({ symbol: s.symbol, side: params.side, usd: params.usd });

  return {
    symbol: s.symbol,
    side: params.side,
    usd: params.usd,
    pay,
    payToken: buying ? SETTLEMENT_SYMBOL : s.symbol,
    receive,
    receiveToken: buying ? s.symbol : SETTLEMENT_SYMBOL,
    minimumReceive,
    priceImpactPct: impactPct,
    priceImpactUsd: (impactPct / 100) * params.usd,
    slippageBps: params.slippageBps,
    slippageWorstUsd: Math.max(0, (receive - minimumReceive) * receivedUnitUsd),
    hops: [
      {
        label: `${VENUE} ${route.tokens[0]}→${route.tokens[1]} ${s.pool.fee / 10_000}%`,
        percent: 100,
        venue: VENUE,
        from: route.tokens[0]!,
        to: route.tokens[1]!,
        feePct: s.pool.fee / 10_000,
      },
    ],
    platformFeeUsd: null,
    effectivePrice,
    markPrice,
    // ── added for Robinhood Chain ──
    chain: CHAIN_KEY,
    pool: { address: s.pool.address, fee: s.pool.fee, feeTiers: FEE_TIERS },
    multiplier,
    receiveShares: buying ? receive * multiplier : null,
    guard: guard.ok ? { ok: true, detail: guard.detail ?? null } : { ok: false, reason: guard.reason, message: guard.message },
  };
}
