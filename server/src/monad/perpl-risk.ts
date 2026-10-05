/**
 * Perpl risk, market by market (Perpl's "Analytics / Risk Tool" bounty; PLAN.md P3.4): what each market has cost its
 * longs over a window, where its price went, how crowded it is — all from Perpl's public API, no key.
 *
 * The network is the one this build trades on: Perpl testnet for the testnet build (where the desks are), Perpl mainnet
 * for the mainnet build and its fork (the fork has no Perpl of its own).
 *
 * Read on 2026-10-05, the shapes this parses:
 *   GET /v1/pub/context                              → markets: config (price/size decimals), state (mrk, bid, ask, oi),
 *                                                      funding (rate), funding_interval_sec
 *   GET /v1/market-data/:id/funding/:fromMs-:toMs    → d: [{ at: { t }, rate }]  — rate in millionths per interval
 *   GET /v1/market-data/:id/candles/3600/:fromMs-:toMs → d: [{ t, o, h, l, c, n }] — prices in the market's price decimals
 *
 * Funding sign: positive rate, longs pay shorts. `longsPaidPct` is the sum of the window's rates — the share of a long's
 * notional it paid over the window (negative: it was paid). `aprPct` annualises the window's average.
 */
import { getJson } from '../http/get.js';
import { type PerplNetwork } from './perpl-chain.js';
import { PERPL_GET, parseMarket, perplNetwork } from './perpl.js';

type RawContext = { markets?: Parameters<typeof parseMarket>[0][]; geo_block?: string[] };
type RawFunding = { d?: { at?: { t?: number }; rate?: number }[] };
type RawCandles = { d?: { t: number; o: number; h: number; l: number; c: number; n?: number }[] };

export type FundingPoint = { at: string; pctPerHour: number };

export type MarketRisk = {
  id: number;
  name: string;
  mark: number | null;
  /** When Perpl last updated the mark. */
  at: string | null;
  /** Open interest in USD at the mark. */
  oiUsd: number | null;
  spreadBps: number | null;
  fundingNowPctPerHour: number | null;
  funding: {
    points: FundingPoint[];
    /** What a long paid over the window, % of notional (negative: a long was paid). */
    longsPaidPct: number | null;
    /** The window's average funding, annualised. */
    aprPct: number | null;
  };
  price: { open: number; close: number; high: number; low: number; changePct: number; trades: number } | null;
};

export type PerplRisk = { network: string; hours: number; at: string; markets: MarketRisk[]; geoBlock: string[] };

export function fundingSeries(raw: RawFunding, intervalSec: number | null): MarketRisk['funding'] {
  const rows = (raw.d ?? []).filter((r) => typeof r.rate === 'number' && typeof r.at?.t === 'number');
  if (rows.length === 0 || !intervalSec) return { points: [], longsPaidPct: null, aprPct: null };
  const perHour = (rate: number) => (rate / 1e6) * 100 * (3600 / intervalSec);
  const points = rows.map((r) => ({ at: new Date(r.at!.t!).toISOString(), pctPerHour: perHour(r.rate!) }));
  const longsPaidPct = rows.reduce((s, r) => s + (r.rate! / 1e6) * 100, 0);
  const avgPerHour = points.reduce((s, p) => s + p.pctPerHour, 0) / points.length;
  return { points, longsPaidPct, aprPct: avgPerHour * 24 * 365 };
}

export function priceSummary(raw: RawCandles, priceDecimals: number): MarketRisk['price'] {
  const d = raw.d ?? [];
  if (d.length === 0) return null;
  const s = (v: number) => v / 10 ** priceDecimals;
  const open = s(d[0]!.o);
  const close = s(d[d.length - 1]!.c);
  return {
    open,
    close,
    high: s(Math.max(...d.map((c) => c.h))),
    low: s(Math.min(...d.map((c) => c.l))),
    changePct: open > 0 ? ((close - open) / open) * 100 : 0,
    trades: d.reduce((n, c) => n + (c.n ?? 0), 0),
  };
}

/**
 * The history window ends on a 5-minute mark, so a revisit inside it asks the same URLs and is answered from the cache:
 * funding settles every 43 minutes and the candles are hourly, so nothing is lost. What is live — mark, funding now, open
 * interest — comes from the context, read on its own 30 s cache.
 */
const HISTORY_STEP_MS = 5 * 60_000;

export async function perplRisk(hours = 24, now = Date.now(), net: PerplNetwork = perplNetwork()): Promise<PerplRisk> {
  const window = Math.min(Math.max(hours, 1), 168);
  const to = Math.floor(now / HISTORY_STEP_MS) * HISTORY_STEP_MS;
  const from = to - window * 3_600_000;
  const ctx = await getJson<RawContext>(`${net.api}/v1/pub/context`, 30_000, 15_000, {}, PERPL_GET);
  const raws = (ctx.markets ?? []).filter((m) => m.config?.is_open === true);
  const markets = await Promise.all(
    raws.map(async (raw): Promise<MarketRisk> => {
      const m = parseMarket(raw);
      const pd = raw.config?.price_decimals ?? 0;
      const [fund, candles] = await Promise.all([
        getJson<RawFunding>(`${net.api}/v1/market-data/${m.id}/funding/${from}-${to}`, HISTORY_STEP_MS, 15_000, {}, PERPL_GET).catch(() => ({ d: [] })),
        getJson<RawCandles>(`${net.api}/v1/market-data/${m.id}/candles/3600/${from}-${to}`, HISTORY_STEP_MS, 15_000, {}, PERPL_GET).catch(() => ({ d: [] })),
      ]);
      const spreadBps = m.bid && m.ask && m.ask > m.bid ? ((m.ask - m.bid) / ((m.ask + m.bid) / 2)) * 10_000 : null;
      return {
        id: m.id,
        name: m.name,
        mark: m.mark,
        at: m.at,
        oiUsd: m.openInterest !== null && m.mark !== null ? m.openInterest * m.mark : null,
        spreadBps,
        fundingNowPctPerHour: m.fundingPctPerHour,
        funding: fundingSeries(fund, m.fundingIntervalSec),
        price: priceSummary(candles, pd),
      };
    }),
  );
  // Most crowded first: what a long is paying right now.
  markets.sort((a, b) => Math.abs(b.fundingNowPctPerHour ?? 0) - Math.abs(a.fundingNowPctPerHour ?? 0));
  return { network: net.name, hours: window, at: new Date(now).toISOString(), markets, geoBlock: ctx.geo_block ?? [] };
}
