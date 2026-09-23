/**
 * Robinhood's public Stock Token API (`https://api.robinhood.com/rhj/…`): no auth, 60 req/s.
 *
 * Every response is validated with zod against the shape the live API returned on 2026-09-23 (the
 * fixtures in `fixtures/` are those responses, trimmed). Two things differ from the docs and are
 * modelled as the API actually answers:
 *   - `tradingCapabilities` is `{ market|extended|overnight: { whole, fractional } }`, each a
 *     `TRADING_STATUS_*` string.
 *   - `pendingMultiplier` is `""` when there is none, not absent.
 *
 * Quote `bid`/`ask` are the UNDERLYING share's price in USD. A Stock Token is worth
 * `price × currentMultiplier` (ERC-8056), which is what Chainlink publishes; `tokenPrice()` does
 * that conversion so no caller mixes the two.
 */
import { z } from 'zod';
import { fetchJson, TtlCache, type FetchJsonOptions } from './http.js';

export const ROBINHOOD_API = process.env.ROBINHOOD_API_URL ?? 'https://api.robinhood.com';
export const ROBINHOOD_CHAIN_ID = 4663;

/** Cache times: prices 15s, assets 60s, corporate actions 1h. */
export const TTL = { prices: 15_000, assets: 60_000, corporateActions: 3_600_000 } as const;

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, 'decimal string');
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'address');

export const TRADABLE = 'TRADING_STATUS_TRADABLE';

const deploymentSchema = z.object({
  contractAddress: address,
  chainId: z.number().int(),
  networkName: z.string().optional(),
  itnEnabled: z.boolean().optional(),
  atomicEnabled: z.boolean().optional(),
});
export type Deployment = z.infer<typeof deploymentSchema>;

/** `TRADING_STATUS_TRADABLE` | `TRADING_STATUS_UNTRADABLE` | anything the API adds later. */
const tradingStatus = z.string();
const sessionCapSchema = z.object({ whole: tradingStatus, fractional: tradingStatus });
export const tradingCapabilitiesSchema = z.object({
  market: sessionCapSchema,
  extended: sessionCapSchema,
  overnight: sessionCapSchema,
});
export type TradingCapabilities = z.infer<typeof tradingCapabilitiesSchema>;

export const assetSchema = z.object({
  id: z.string(),
  tokenSymbol: z.string().min(1),
  tokenName: z.string(),
  deployments: z.array(deploymentSchema),
  currentMultiplier: decimalString,
  /** `""` when no multiplier change is scheduled. */
  pendingMultiplier: z.union([decimalString, z.literal('')]).optional(),
  pendingMultiplierEffectiveTime: z.string().optional(),
  status: z.string(),
  logoUrl: z.string().optional(),
  tradingCapabilities: tradingCapabilitiesSchema,
  tokenDecimals: z.number().int().optional(),
  isin: z.string().optional(),
});
export type RobinhoodAsset = z.infer<typeof assetSchema>;
export const assetsResponseSchema = z.object({ assets: z.array(assetSchema) });

export const quoteSchema = z.object({
  tokenSymbol: z.string(),
  deployments: z.array(deploymentSchema).optional(),
  bid: decimalString,
  ask: decimalString,
  currency: z.string(),
  dailyTradingVolume: decimalString.optional(),
  isTradingHalt: z.boolean(),
  generatedAt: z.string(),
  dailyHigh: decimalString.optional(),
  dailyLow: decimalString.optional(),
  mintBurnTokenVolume: decimalString.optional(),
  mintBurnUsdVolume: decimalString.optional(),
});
export type RobinhoodQuote = z.infer<typeof quoteSchema>;
export const pricesResponseSchema = z.object({ quotes: z.array(quoteSchema) });

export const corporateActionSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  processDate: z.object({ year: z.number(), month: z.number(), day: z.number() }),
  tokenSymbol: z.string(),
  deployments: z.array(deploymentSchema).optional(),
  /** Keyed by action kind, e.g. `{ cashDividend: { underlyingSymbol, rate } }`. */
  details: z.record(z.string(), z.record(z.string(), z.unknown())),
});
export type CorporateAction = z.infer<typeof corporateActionSchema>;
export const corporateActionsResponseSchema = z.object({ corpActions: z.array(corporateActionSchema) });

const assetsCache = new TtlCache<RobinhoodAsset[]>(TTL.assets);
const pricesCache = new TtlCache<RobinhoodQuote>(TTL.prices);
const corpCache = new TtlCache<CorporateAction[]>(TTL.corporateActions);

export function clearRobinhoodApiCaches(): void {
  assetsCache.clear();
  pricesCache.clear();
  corpCache.clear();
}

/** Every asset the API lists (all statuses, all chains). */
export function fetchAssets(opts?: FetchJsonOptions): Promise<RobinhoodAsset[]> {
  return assetsCache.get('all', async () => {
    const raw = await fetchJson(`${ROBINHOOD_API}/rhj/assets`, opts);
    return assetsResponseSchema.parse(raw).assets;
  });
}

/** One symbol's asset record, or undefined when the API does not list it. */
export async function fetchAsset(symbol: string, opts?: FetchJsonOptions): Promise<RobinhoodAsset | undefined> {
  const s = symbol.toUpperCase();
  return (await fetchAssets(opts)).find((a) => a.tokenSymbol.toUpperCase() === s);
}

/** The latest quote for a symbol. An unknown symbol is HTTP 404 (`RobinhoodHttpError`). */
export function fetchPrice(symbol: string, opts?: FetchJsonOptions): Promise<RobinhoodQuote> {
  const s = symbol.toUpperCase();
  return pricesCache.get(s, async () => {
    const raw = await fetchJson(`${ROBINHOOD_API}/rhj/prices/${encodeURIComponent(s)}`, opts);
    const quote = pricesResponseSchema.parse(raw).quotes.find((q) => q.tokenSymbol.toUpperCase() === s);
    if (!quote) throw new Error(`/rhj/prices/${s} answered without a quote for ${s}`);
    return quote;
  });
}

export function fetchCorporateActions(opts?: FetchJsonOptions): Promise<CorporateAction[]> {
  return corpCache.get('all', async () => {
    const raw = await fetchJson(`${ROBINHOOD_API}/rhj/corporate-actions`, opts);
    return corporateActionsResponseSchema.parse(raw).corpActions;
  });
}

// ---------------------------------------------------------------------------------------------
// Pure helpers over the API's shapes.

export function deploymentOn(asset: RobinhoodAsset, chainId = ROBINHOOD_CHAIN_ID): Deployment | undefined {
  return asset.deployments.find((d) => d.chainId === chainId);
}

export const isActive = (asset: RobinhoodAsset) => asset.status === 'ASSET_STATUS_ACTIVE';

/** A decimal string as a 1e18-scaled bigint (the scale `uiMultiplier()` uses). Truncates past 18 dp. */
export function toWad(decimal: string): bigint {
  const neg = decimal.startsWith('-');
  const [int = '0', frac = ''] = (neg ? decimal.slice(1) : decimal).split('.');
  const v = BigInt(int) * 10n ** 18n + BigInt((frac + '0'.repeat(18)).slice(0, 18));
  return neg ? -v : v;
}

export function pendingMultiplierOf(asset: RobinhoodAsset): { multiplier: string; effectiveTime?: string } | undefined {
  const p = asset.pendingMultiplier;
  if (!p || p === asset.currentMultiplier) return undefined;
  return { multiplier: p, effectiveTime: asset.pendingMultiplierEffectiveTime };
}

/**
 * The quote converted to a per-TOKEN price: underlying × currentMultiplier. `mid` is (bid+ask)/2.
 */
export function tokenPrice(quote: RobinhoodQuote, currentMultiplier: string) {
  const m = Number(currentMultiplier);
  const bid = Number(quote.bid) * m;
  const ask = Number(quote.ask) * m;
  return { bid, ask, mid: (bid + ask) / 2, multiplier: m };
}

/** Actions that have not completed yet for a symbol — the "heads up" list for holdings. */
export function openCorporateActions(actions: CorporateAction[], symbol: string): CorporateAction[] {
  const s = symbol.toUpperCase();
  return actions.filter((a) => a.tokenSymbol.toUpperCase() === s && a.status !== 'CORPORATE_ACTION_STATUS_COMPLETED');
}

/** A one-line human description of a corporate action. */
export function describeCorporateAction(a: CorporateAction): string {
  const d = a.processDate;
  const date = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  const kind = a.type.replace(/^CORPORATE_ACTION_TYPE_/, '').toLowerCase().replace(/_/g, ' ');
  const status = a.status.replace(/^CORPORATE_ACTION_STATUS_/, '').toLowerCase().replace(/_/g, ' ');
  const cash = a.details.cashDividend as { rate?: string } | undefined;
  const extra = cash?.rate ? ` of $${cash.rate}/share` : '';
  return `${a.tokenSymbol} ${kind}${extra}, processing ${date} (${status})`;
}
