/**
 * What a Perpl market has cost its longs, where its price went, and what deserves a look — from Perpl's public API, no
 * key. The same reading xorr's Perpl risk screen shows (`server/src/monad/perpl-risk.ts`, `src/data/perplRisk.ts`).
 *
 *   GET /v1/market-data/:id/funding/:fromMs-:toMs      → d: [{ at: { t }, rate }]   rate in millionths per interval
 *   GET /v1/market-data/:id/candles/3600/:fromMs-:toMs → d: [{ t, o, h, l, c, n }]  prices in the market's decimals
 */
import { fundingPctPerHour, getJson, type Market, type PerplNet } from './perpl.js';

export type MarketRisk = {
  market: string;
  mark: number | null;
  oiUsd: number | null;
  spreadBps: number | null;
  fundingNowPctPerHour: number | null;
  /** What a long paid over the window, % of notional (negative: a long was paid). */
  longsPaidPct: number | null;
  /** The window's average funding, a year. */
  aprPct: number | null;
  priceChangePct: number | null;
  trades: number | null;
  staleSec: number | null;
};

export type RiskAlert = { level: 'high' | 'watch'; text: string };

/** Funding a year at the current rate, past which a market is called crowded. */
export const CROWDED_APR_PCT = 25;
export const BIG_MOVE_PCT = 5;
export const WIDE_BPS = 25;
/** Perpl refuses reference prices older than 60 s. */
export const STALE_SEC = 60;

type RawFunding = { d?: { at?: { t?: number }; rate?: number }[] };
type RawCandles = { d?: { t: number; o: number; h: number; l: number; c: number; n?: number }[] };

export function fundingOverWindow(raw: RawFunding, intervalSec: number | null): { longsPaidPct: number | null; aprPct: number | null } {
  const rates = (raw.d ?? []).map((r) => r.rate).filter((r): r is number => typeof r === 'number');
  if (rates.length === 0 || !intervalSec) return { longsPaidPct: null, aprPct: null };
  const longsPaidPct = rates.reduce((s, r) => s + (r / 1e6) * 100, 0);
  const avgPerHour = rates.reduce((s, r) => s + (r / 1e6) * 100 * (3600 / intervalSec), 0) / rates.length;
  return { longsPaidPct, aprPct: avgPerHour * 24 * 365 };
}

export function priceMove(raw: RawCandles, priceDecimals: number): { changePct: number; trades: number } | null {
  const d = raw.d ?? [];
  if (d.length === 0) return null;
  const open = d[0]!.o / 10 ** priceDecimals;
  const close = d[d.length - 1]!.c / 10 ** priceDecimals;
  return { changePct: open > 0 ? ((close - open) / open) * 100 : 0, trades: d.reduce((n, c) => n + (c.n ?? 0), 0) };
}

/** Every open market's risk over the last `hours` (1–168), most crowded first. */
export async function marketRisks(
  net: PerplNet,
  markets: readonly Market[],
  hours: number,
  now = Date.now(),
  fetchJson: (url: string) => Promise<unknown> = getJson,
): Promise<MarketRisk[]> {
  const to = now;
  const from = now - Math.min(Math.max(hours, 1), 168) * 3_600_000;
  const out = await Promise.all(
    markets
      .filter((m) => m.open)
      .map(async (m): Promise<MarketRisk> => {
        const [fund, candles] = await Promise.all([
          fetchJson(`${net.api}/v1/market-data/${m.id}/funding/${from}-${to}`).catch(() => ({})) as Promise<RawFunding>,
          fetchJson(`${net.api}/v1/market-data/${m.id}/candles/3600/${from}-${to}`).catch(() => ({})) as Promise<RawCandles>,
        ]);
        const f = fundingOverWindow(fund, m.fundingIntervalSec);
        const p = priceMove(candles, m.priceDecimals);
        return {
          market: m.name,
          mark: m.mark,
          oiUsd: m.openInterest !== null && m.mark !== null ? m.openInterest * m.mark : null,
          spreadBps: m.bid && m.ask && m.ask > m.bid ? ((m.ask - m.bid) / ((m.ask + m.bid) / 2)) * 10_000 : null,
          fundingNowPctPerHour: fundingPctPerHour(m),
          longsPaidPct: f.longsPaidPct,
          aprPct: f.aprPct,
          priceChangePct: p?.changePct ?? null,
          trades: p?.trades ?? null,
          staleSec: m.at ? Math.max(0, Math.round((now - Date.parse(m.at)) / 1000)) : null,
        };
      }),
  );
  return out.sort((a, b) => Math.abs(b.fundingNowPctPerHour ?? 0) - Math.abs(a.fundingNowPctPerHour ?? 0));
}

const pct = (n: number, digits = 1) => `${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: digits })}%`;

/** What deserves a look first. Markets paying the same rate the same way are one line. */
export function riskAlerts(risks: readonly MarketRisk[], hours: number): RiskAlert[] {
  const out: RiskAlert[] = [];
  const crowded = new Map<string, string[]>();
  for (const r of risks) {
    if (r.fundingNowPctPerHour === null) continue;
    const apr = r.fundingNowPctPerHour * 24 * 365;
    if (Math.abs(apr) < CROWDED_APR_PCT) continue;
    const key = `${apr > 0 ? 'longs' : 'shorts'} pay ${pct(apr, 0)} a year`;
    crowded.set(key, [...(crowded.get(key) ?? []), r.market]);
  }
  for (const [what, names] of crowded) out.push({ level: 'watch', text: `${names.join(', ')}: ${what} at the current rate.` });
  for (const r of risks) {
    if (r.staleSec !== null && r.staleSec > STALE_SEC) out.push({ level: 'high', text: `${r.market}'s mark is ${r.staleSec} s old: Perpl treats a price that old as stale.` });
    if (r.priceChangePct !== null && Math.abs(r.priceChangePct) >= BIG_MOVE_PCT) {
      out.push({ level: 'watch', text: `${r.market} ${r.priceChangePct > 0 ? 'rose' : 'fell'} ${pct(r.priceChangePct)} in ${hours}h.` });
    }
    if (r.spreadBps !== null && r.spreadBps > WIDE_BPS) out.push({ level: 'watch', text: `${r.market}'s book is ${Math.round(r.spreadBps)} bps wide.` });
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'high' ? -1 : 1));
}
