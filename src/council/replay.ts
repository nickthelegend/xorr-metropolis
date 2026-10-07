/**
 * A council round, replayed (docs/ROADMAP-WIN.md F3, 2026-10-07).
 *
 * The council screen showed each vote's one-line reason under a verdict that was already decided. What made the vote
 * worth trusting — what each desk read, at the moment it read it — sat in the round's stored inputs and never reached a
 * screen. The replay plays the round back the way it happened: the proposal, then each desk in its seat with the readings
 * it cites and its vote, then the verdict, then the transaction.
 *
 * Every reading here is the round's own, recorded when it convened (`council_rounds.inputs`); nothing is re-read now. A
 * read that failed then says so, with its error. These are pure functions so the beats and the words are tested on Node.
 */
import type { CouncilBallot, CouncilRound, CouncilSeatId } from '@/data/council';
import { money, percent, price, quantity } from '@/format';

/** The order the seats sit in, on the bench and in the replay. The executor stores votes in a different order. */
export const SEAT_ORDER: readonly CouncilSeatId[] = ['session-desk', 'risk-keeper', 'trend-reader', 'macro-desk', 'strategist'];

/** A round's ballots in seat order. */
export function seated(votes: readonly CouncilBallot[]): CouncilBallot[] {
  return [...votes].sort((a, b) => SEAT_ORDER.indexOf(a.persona) - SEAT_ORDER.indexOf(b.persona));
}

export type Beat = { kind: 'proposal' } | { kind: 'seat'; ballot: CouncilBallot } | { kind: 'verdict' } | { kind: 'outcome' };

/** The replay, beat by beat: the proposal, each seat in order, the verdict, then what the chain did. */
export function beats(round: Pick<CouncilRound, 'votes'>): Beat[] {
  return [{ kind: 'proposal' }, ...seated(round.votes).map((ballot) => ({ kind: 'seat' as const, ballot })), { kind: 'verdict' }, { kind: 'outcome' }];
}

/** How long each beat holds before the next: a seat has readings to take in; the rest are a glance. */
export function beatMs(b: Beat): number {
  return b.kind === 'seat' ? 1_600 : b.kind === 'outcome' ? 0 : 1_100;
}

export type Tally = { yes: number; no: number; veto: number; abstain: number };

export function tally(votes: readonly Pick<CouncilBallot, 'vote'>[]): Tally {
  const t: Tally = { yes: 0, no: 0, veto: 0, abstain: 0 };
  for (const v of votes) t[v.vote] += 1;
  return t;
}

/** One line a desk read: what it was, and its value then. `failed` when the read itself did not succeed. */
export type Reading = { label: string; value: string; failed?: boolean };
/** A desk's readings from one input, with where they came from. */
export type ReadingGroup = { cite: string; source: string | null; readings: Reading[] };

type Read<T> = ({ ok: true; source?: string } & T) | { ok: false; error: string };
type PriceIn = Read<{
  chainlink?: { price: number; ageSec: number };
  halt?: string | null;
  fill?: { price: number; venue: string };
  kuru?: { mid: number; spreadBps: number | null } | null;
  gapBps?: number;
  maxGapBps?: number;
}>;
type TrendIn = Read<{ rounds?: unknown[]; changePct?: number; spanHours?: number }>;
type PerpsIn = Read<{ markets?: { market: string; mark: number | null; fundingPctPerHour: number; openInterest: number | null }[] }>;
type PermissionIn = Read<{ dailyCapUsd?: number; remainingTodayUsd?: number; expiresAt?: number; revoked?: boolean }>;
type HoldingIn = Read<{ shares?: number; valueUsd?: number }>;

/** The inputs a round's votes rest on, as the executor stored them, keyed by what a ballot cites. */
export type RoundInputs = Record<string, unknown>;

/** "16 s old", "4 min old", "2 h old". */
export function ageWords(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return 'age unknown';
  if (sec < 90) return `${Math.round(sec)} s old`;
  if (sec < 90 * 60) return `${Math.round(sec / 60)} min old`;
  return `${Math.round(sec / 3600)} h old`;
}

const bps = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} bps`;
const hours = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${h.toLocaleString('en-US', { maximumFractionDigits: h < 10 ? 1 : 0 })} h`);

/** What the price desk read: Chainlink, the fill's quote, Kuru's book, and the gap between them. */
function priceReadings(p: Extract<PriceIn, { ok: true }>, symbol: string): Reading[] {
  const out: Reading[] = [];
  if (p.chainlink) out.push({ label: `Chainlink ${symbol}/USD`, value: `${price(p.chainlink.price)} · ${ageWords(p.chainlink.ageSec)}` });
  if (p.fill) out.push({ label: 'The fill’s quote', value: `${price(p.fill.price)} · ${p.fill.venue}` });
  if (p.kuru) out.push({ label: 'Kuru book', value: `mid ${price(p.kuru.mid)}${p.kuru.spreadBps !== null ? ` · spread ${bps(p.kuru.spreadBps)}` : ''}` });
  if (p.gapBps !== undefined) out.push({ label: 'Gap to Chainlink', value: `${bps(p.gapBps)}${p.maxGapBps !== undefined ? ` (limit ${bps(p.maxGapBps)})` : ''}` });
  if (p.halt) out.push({ label: 'Chainlink CRE', value: p.halt });
  return out;
}

function permissionReadings(p: Extract<PermissionIn, { ok: true }>): Reading[] {
  const out: Reading[] = [];
  if (p.remainingTodayUsd !== undefined && p.dailyCapUsd !== undefined) {
    out.push({ label: 'Left today', value: `${money(p.remainingTodayUsd, { fractionDigits: 0 })} of ${money(p.dailyCapUsd, { fractionDigits: 0 })}` });
  }
  if (p.revoked) out.push({ label: 'Permission', value: 'revoked' });
  else if (p.expiresAt) {
    out.push({ label: 'Ends', value: new Date(p.expiresAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) });
  }
  return out;
}

function holdingReadings(h: Extract<HoldingIn, { ok: true }>, symbol: string): Reading[] {
  if (h.shares === undefined) return [];
  if (h.shares === 0) return [{ label: 'Held', value: `no ${symbol} yet` }];
  return [{ label: 'Held', value: `${quantity(h.shares, h.shares >= 100 ? 2 : 4)} ${symbol}${h.valueUsd !== undefined ? ` · ${money(h.valueUsd)}` : ''}` }];
}

function trendReadings(t: Extract<TrendIn, { ok: true }>): Reading[] {
  if (t.changePct === undefined) return [];
  const n = Array.isArray(t.rounds) ? t.rounds.length : null;
  return [
    {
      label: `Chainlink over ${t.spanHours !== undefined ? hours(t.spanHours) : 'its last rounds'}`,
      value: `${percent(t.changePct, { digits: 2 })}${n ? ` across ${n} rounds` : ''}`,
    },
  ];
}

function perpsReadings(p: Extract<PerpsIn, { ok: true }>): Reading[] {
  return (p.markets ?? []).map((m) => ({
    label: `Perpl ${m.market}`,
    value: [
      m.fundingPctPerHour > 0 ? `longs pay ${m.fundingPctPerHour.toFixed(4)}%/h` : m.fundingPctPerHour < 0 ? `shorts pay ${(-m.fundingPctPerHour).toFixed(4)}%/h` : 'no funding',
      m.openInterest !== null ? `OI ${m.openInterest.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  }));
}

const CITE_LABEL: Record<string, string> = { price: 'Price', permission: 'Permission', holding: 'Holding', trend: 'Trend', perps: 'Perpl' };

/**
 * What a seat read, from the inputs it cites. A cite the inputs do not hold (the Strategist cites the other ballots and
 * its model) contributes nothing here; a read that failed when the round convened is one failed reading, with its error.
 */
export function readingsFor(inputs: RoundInputs | null | undefined, cites: readonly string[], symbol: string): ReadingGroup[] {
  if (!inputs) return [];
  const groups: ReadingGroup[] = [];
  for (const cite of cites) {
    const raw = inputs[cite] as Read<Record<string, unknown>> | undefined;
    if (!raw || typeof raw !== 'object' || !('ok' in raw)) continue;
    if (!raw.ok) {
      groups.push({ cite, source: null, readings: [{ label: CITE_LABEL[cite] ?? cite, value: `could not be read: ${raw.error}`, failed: true }] });
      continue;
    }
    const readings =
      cite === 'price'
        ? priceReadings(raw as Extract<PriceIn, { ok: true }>, symbol)
        : cite === 'permission'
          ? permissionReadings(raw as Extract<PermissionIn, { ok: true }>)
          : cite === 'holding'
            ? holdingReadings(raw as Extract<HoldingIn, { ok: true }>, symbol)
            : cite === 'trend'
              ? trendReadings(raw as Extract<TrendIn, { ok: true }>)
              : cite === 'perps'
                ? perpsReadings(raw as Extract<PerpsIn, { ok: true }>)
                : [];
    if (readings.length) groups.push({ cite, source: typeof raw.source === 'string' ? raw.source : null, readings });
  }
  return groups;
}

/** The Strategist's model, from its `kimi:<model>` cite. */
export function strategistModel(cites: readonly string[]): string | null {
  const c = cites.find((x) => x.startsWith('kimi:'));
  return c ? c.slice('kimi:'.length) : null;
}
