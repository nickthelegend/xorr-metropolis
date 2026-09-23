/**
 * GMX's public REST API for Arbitrum One, decoded to numbers a person can read (PLAN.md P2.3, 2026-09-23).
 *
 * `/markets/info` and `/prices/tickers` are what the GMX interface itself reads. Both speak GMX's fixed point:
 *
 *   - USD amounts (open interest, liquidity) carry 30 decimals.
 *   - A price is USD per SMALLEST UNIT of the token × 1e30, so ETH at $2,784.96 is `2784959467690360`
 *     (2784.96 × 1e30 / 1e18) and BTC at $87,200 is `872001586635084725000000000` (87200 × 1e30 / 1e8).
 *   - Funding, borrowing and net rates are ANNUAL fractions × 1e30, signed from the side's point of view: positive
 *     means that side pays, negative means it is paid. Checked on 2026-09-23 against the chain: ETH/USD
 *     `fundingRateLong` 0.04425 × 1e30 matched Reader `fundingFactorPerSecond × 31,536,000` = 0.04432 with
 *     `longsPayShorts = true`. The GMX interface shows these per hour, so this does too.
 *
 * Every request has a deadline and falls back to GMX's second host; a failure says which hosts were tried and why.
 * There is no fixture anywhere in this path — the tests feed recorded responses through `fetchImpl`.
 */
import { formatUnits } from 'viem';
import { MARKETS, TOKENS, type GmxMarket, type TokenSymbol, USD_DECIMALS } from './constants.js';

export const GMX_API_HOSTS = ['https://arbitrum-api.gmxinfra.io', 'https://arbitrum-api-fallback.gmxinfra.io'] as const;

const TIMEOUT_MS = Number(process.env.GMX_API_TIMEOUT_MS ?? 6_000);
const CACHE_MS = 10_000;
const HOURS_PER_YEAR = 365 * 24;

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class GmxApiUnavailable extends Error {
  readonly status = 503;
  constructor(path: string, reasons: string[]) {
    super(`GMX API ${path} did not answer: ${reasons.join('; ')}`);
    this.name = 'GmxApiUnavailable';
  }
}

const cache = new Map<string, { at: number; value: unknown }>();

/** Clear the short read cache (tests). */
export function clearGmxApiCache(): void {
  cache.clear();
}

type GetOpts = { fetchImpl?: FetchLike; timeoutMs?: number; noCache?: boolean };

/**
 * GET `path` from the primary host, then the fallback. Each attempt gets its own deadline, so a hung primary costs
 * one timeout, not the caller's whole budget.
 */
export async function gmxGet<T>(path: string, opts: GetOpts = {}): Promise<T> {
  const hit = cache.get(path);
  if (!opts.noCache && hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const reasons: string[] = [];
  for (const host of GMX_API_HOSTS) {
    const name = new URL(host).host;
    try {
      const res = await fetchImpl(`${host}${path}`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        reasons.push(`${name} answered HTTP ${res.status}`);
        continue;
      }
      const value = (await res.json()) as T;
      cache.set(path, { at: Date.now(), value });
      return value;
    } catch (e) {
      const why = e instanceof Error ? (e.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : e.message) : String(e);
      reasons.push(`${name} ${why}`);
    }
  }
  throw new GmxApiUnavailable(path, reasons);
}

// ---------------------------------------------------------------------------------------------------------------
// Raw shapes (as recorded from the live API on 2026-09-23)
// ---------------------------------------------------------------------------------------------------------------

export type RawMarketInfo = {
  name: string;
  marketToken: string;
  indexToken: string;
  longToken: string;
  shortToken: string;
  isListed: boolean;
  openInterestLong: string;
  openInterestShort: string;
  availableLiquidityLong: string;
  availableLiquidityShort: string;
  poolAmountLong: string;
  poolAmountShort: string;
  fundingRateLong: string;
  fundingRateShort: string;
  borrowingRateLong: string;
  borrowingRateShort: string;
  netRateLong: string;
  netRateShort: string;
};

export type RawTicker = {
  tokenAddress: string;
  tokenSymbol: string;
  minPrice: string;
  maxPrice: string;
  updatedAt: number;
  timestamp: number;
};

export type RawSignedPrice = {
  tokenAddress: string;
  tokenSymbol: string;
  minPriceFull: string | null;
  maxPriceFull: string | null;
  minBlockTimestamp: number | null;
  maxBlockTimestamp: number | null;
  oracleType?: string;
  isValid?: boolean;
};

// ---------------------------------------------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------------------------------------------

/** A 30-decimal USD amount as a JS number of dollars. */
export function usdFrom30(value: string | bigint): number {
  return Number(formatUnits(BigInt(value), USD_DECIMALS));
}

/** A GMX price (USD per smallest unit × 1e30) as dollars per whole token. */
export function priceToUsd(price: string | bigint, tokenDecimals: number): number {
  return Number(formatUnits(BigInt(price), USD_DECIMALS - tokenDecimals));
}

/** Dollars per whole token (a decimal string) → GMX price (USD per smallest unit × 1e30), exactly. */
export function usdToPrice(usd: string, tokenDecimals: number): bigint {
  const [whole = '0', frac = ''] = usd.split('.');
  const scale = USD_DECIMALS - tokenDecimals;
  const digits = (frac + '0'.repeat(scale)).slice(0, scale);
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(digits || '0');
}

/** An annual 30-decimal rate as percent per hour. Positive: that side pays. Negative: it is paid. */
export function annualRateToPctPerHour(rate: string | bigint): number {
  return (usdFrom30(rate) / HOURS_PER_YEAR) * 100;
}

export type Ticker = { symbol: string; min: number; max: number; mid: number; at: number };

/** `/prices/tickers` decoded for the tokens this module knows, keyed by lower-cased address. */
export function decodeTickers(raw: RawTicker[]): Map<string, Ticker> {
  const known = Object.values(TOKENS) as { address: string; decimals: number }[];
  const out = new Map<string, Ticker>();
  for (const t of raw) {
    const k = known.find((x) => x.address.toLowerCase() === t.tokenAddress.toLowerCase());
    if (!k) continue;
    const min = priceToUsd(t.minPrice, k.decimals);
    const max = priceToUsd(t.maxPrice, k.decimals);
    out.set(t.tokenAddress.toLowerCase(), { symbol: t.tokenSymbol, min, max, mid: (min + max) / 2, at: t.timestamp });
  }
  return out;
}

export type MarketView = {
  id: GmxMarket['id'];
  name: string;
  marketToken: string;
  index: TokenSymbol;
  collateral: [TokenSymbol, TokenSymbol];
  /** Mid of GMX's min/max index price, USD per whole token. */
  markPrice: number | null;
  /** When GMX's price service stamped that price (unix seconds). */
  priceAt: number | null;
  openInterestUsd: { long: number; short: number };
  availableLiquidityUsd: { long: number; short: number };
  /** Percent per hour. Positive: that side pays; negative: it is paid. */
  fundingPctPerHour: { long: number; short: number };
  borrowingPctPerHour: { long: number; short: number };
  /** GMX's `netRate*` per hour: what holding that side costs (positive) or earns (negative). */
  netPctPerHour: { long: number; short: number };
  source: string;
};

export function decodeMarkets(
  info: { markets: RawMarketInfo[] },
  tickers: Map<string, Ticker>,
  markets: readonly GmxMarket[] = MARKETS,
): MarketView[] {
  const out: MarketView[] = [];
  for (const m of markets) {
    const raw = info.markets.find((r) => r.marketToken.toLowerCase() === m.marketToken.toLowerCase());
    if (!raw) continue;
    const t = tickers.get(TOKENS[m.index].address.toLowerCase());
    out.push({
      id: m.id,
      name: raw.name,
      marketToken: m.marketToken,
      index: m.index,
      collateral: [m.long, m.short],
      markPrice: t ? t.mid : null,
      priceAt: t ? t.at : null,
      openInterestUsd: { long: usdFrom30(raw.openInterestLong), short: usdFrom30(raw.openInterestShort) },
      availableLiquidityUsd: { long: usdFrom30(raw.availableLiquidityLong), short: usdFrom30(raw.availableLiquidityShort) },
      fundingPctPerHour: { long: annualRateToPctPerHour(raw.fundingRateLong), short: annualRateToPctPerHour(raw.fundingRateShort) },
      borrowingPctPerHour: { long: annualRateToPctPerHour(raw.borrowingRateLong), short: annualRateToPctPerHour(raw.borrowingRateShort) },
      netPctPerHour: { long: annualRateToPctPerHour(raw.netRateLong), short: annualRateToPctPerHour(raw.netRateShort) },
      source: 'GMX API arbitrum-api.gmxinfra.io /markets/info + /prices/tickers',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------

/** Raw tickers, for callers that need GMX's own fixed-point min/max (acceptable prices, the fork keeper). */
export async function fetchRawTickers(opts: GetOpts = {}): Promise<RawTicker[]> {
  return gmxGet<RawTicker[]>('/prices/tickers', opts);
}

export async function fetchTickers(opts: GetOpts = {}): Promise<Map<string, Ticker>> {
  return decodeTickers(await fetchRawTickers(opts));
}

export async function fetchSignedPrices(opts: GetOpts = {}): Promise<RawSignedPrice[]> {
  const body = await gmxGet<{ signedPrices: RawSignedPrice[] }>('/signed_prices/latest', { ...opts, noCache: true });
  return body.signedPrices;
}

/** The xorr markets, decoded: mark price, OI, liquidity, funding/borrowing/net per hour. */
export async function fetchMarkets(opts: GetOpts = {}): Promise<MarketView[]> {
  const [info, tickers] = await Promise.all([
    gmxGet<{ markets: RawMarketInfo[] }>('/markets/info', opts),
    fetchTickers(opts),
  ]);
  return decodeMarkets(info, tickers);
}

/**
 * GMX's raw min/max price for a token (USD per smallest unit × 1e30), from `/prices/tickers`.
 * Throws when GMX does not price it — an order is never priced from a guess.
 */
export async function rawPriceOf(token: string, opts: GetOpts = {}): Promise<{ min: bigint; max: bigint; at: number }> {
  const raw = await fetchRawTickers(opts);
  const t = raw.find((r) => r.tokenAddress.toLowerCase() === token.toLowerCase());
  if (!t) throw new Error(`GMX /prices/tickers has no price for ${token}.`);
  return { min: BigInt(t.minPrice), max: BigInt(t.maxPrice), at: t.timestamp };
}
