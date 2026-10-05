/**
 * The Perpl risk screen's arithmetic (`app/perpl.tsx`), kept apart so it is tested without a screen.
 *
 * Perpl's public data says what each market is doing; the desk says what the wallet holds. Risk is where the two meet:
 * a market whose longs pay 30% a year is a fact, and a long in that market paying $0.40 an hour is that fact's cost to
 * you. Thresholds are stated here once, each with why.
 */
import type { DeskPosition, PerplMarketRisk } from './perps';

/** Funding a year at the current rate, past which a market is called crowded: a quarter of the notional a year. */
export const CROWDED_APR_PCT = 25;
/** A move over the window worth saying out loud: Perpl's MON opens at 3x, so 5% is a sixth of a full-margin long. */
export const BIG_MOVE_PCT = 5;
/** A book wider than this costs a market order more than a day of typical funding. */
export const WIDE_BPS = 25;
/** Perpl refuses reference prices older than 60 s (`refPriceMaxAgeSec`). */
export const STALE_SEC = 60;
/** A position this close to liquidation, as a fraction of the mark, is called near. */
export const NEAR_LIQ = 0.15;

export type RiskAlert = { key: string; level: 'high' | 'watch'; market: string; text: string };

const pct = (n: number, digits = 1) => `${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: digits })}%`;

const listOf = (names: string[]) => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** A funding rate per hour as a yearly figure. */
export const aprOf = (pctPerHour: number) => pctPerHour * 24 * 365;

/** The series, evened into at most `max` buckets by averaging, so a week of funding fits a phone's width. */
export function bucket(values: readonly number[], max: number): number[] {
  if (values.length <= max) return [...values];
  const out: number[] = [];
  const per = values.length / max;
  for (let i = 0; i < max; i++) {
    const slice = values.slice(Math.floor(i * per), Math.floor((i + 1) * per));
    out.push(slice.reduce((s, v) => s + v, 0) / slice.length);
  }
  return out;
}

/** What a position pays (positive) or earns (negative) in funding per hour now, in dollars. */
export function fundingPerHourUsd(p: DeskPosition, m: PerplMarketRisk | undefined): number | null {
  const rate = m?.fundingNowPctPerHour;
  const mark = p.mark ?? m?.mark ?? null;
  if (rate === null || rate === undefined || mark === null) return null;
  const notional = p.lots * mark;
  // Positive rate: longs pay. A short pays when the rate is negative.
  return ((p.long ? rate : -rate) / 100) * notional;
}

/** What deserves a look first, most urgent first: your positions, then the markets. */
export function riskAlerts(markets: readonly PerplMarketRisk[], hours: number, now: number, positions: readonly DeskPosition[] = []): RiskAlert[] {
  const out: RiskAlert[] = [];
  const window = hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours}h`;
  for (const p of positions) {
    if (p.liqDistance !== null && p.liqDistance < NEAR_LIQ) {
      out.push({
        key: `liq-${p.perpId}`,
        level: 'high',
        market: p.market,
        text: `Your ${p.market} ${p.long ? 'long' : 'short'} is ${pct(p.liqDistance * 100)} from liquidation.`,
      });
    }
  }
  // Markets paying the same yearly rate the same way are one line, not three: on a capped rate several sit at the cap.
  const crowded = new Map<string, { names: string[]; ids: number[]; longs: boolean; apr: string }>();
  for (const m of markets) {
    const rate = m.fundingNowPctPerHour;
    if (rate === null || Math.abs(aprOf(rate)) < CROWDED_APR_PCT) continue;
    const apr = pct(aprOf(rate), 0);
    const group = crowded.get(`${rate > 0}-${apr}`) ?? { names: [], ids: [], longs: rate > 0, apr };
    group.names.push(m.name);
    group.ids.push(m.id);
    crowded.set(`${rate > 0}-${apr}`, group);
  }
  for (const g of crowded.values()) {
    out.push({
      key: `crowd-${g.ids.join('-')}`,
      level: 'watch',
      market: g.names.join(', '),
      text: `${listOf(g.names)}: ${g.longs ? 'longs' : 'shorts'} pay ${g.apr} a year at the current rate.`,
    });
  }
  for (const m of markets) {
    if (m.price && Math.abs(m.price.changePct) >= BIG_MOVE_PCT) {
      out.push({
        key: `move-${m.id}`,
        level: 'watch',
        market: m.name,
        text: `${m.name} ${m.price.changePct > 0 ? 'rose' : 'fell'} ${pct(m.price.changePct)} in ${window}.`,
      });
    }
    if (m.spreadBps !== null && m.spreadBps > WIDE_BPS) {
      out.push({
        key: `wide-${m.id}`,
        level: 'watch',
        market: m.name,
        text: `${m.name}’s book is ${Math.round(m.spreadBps)} bps wide: a market order pays for it.`,
      });
    }
    if (m.at && (now - Date.parse(m.at)) / 1000 > STALE_SEC) {
      out.push({ key: `stale-${m.id}`, level: 'high', market: m.name, text: `${m.name}’s mark is over a minute old: Perpl treats a price that old as stale.` });
    }
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'high' ? -1 : 1));
}
