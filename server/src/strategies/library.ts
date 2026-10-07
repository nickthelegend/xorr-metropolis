/**
 * The research book: 313 strategies, and what a walk-forward gauntlet did to them.
 *
 * These come from the first xorr — a Python paper-trading engine that ran every candidate through
 * in-sample and out-of-sample splits, a five-point parameter sweep, a double-commission stress test
 * and a cross-asset check. Ten survived. `scripts/import-strategy-library.mjs` brings the book
 * across as `library.json`, which is committed, so a clone of this repo has all of it and the
 * executor never reaches into another project at runtime.
 *
 * ## Why the shape is what it is
 *
 * A strategy screen that showed one number — "+19,972%" over a fitted curve — would be the exact
 * thing this product refuses to do everywhere else. Every strategy here carries BOTH splits, and
 * the out-of-sample column is the one that means anything: the source engine's own README records
 * two strategies that looked profitable on a single split and inverted to -0.37% and -6.07% once
 * tested properly. `survives` is that judgement, and `failedOn` says what it failed.
 *
 * ## The list is slim on purpose
 *
 * The full book is 684 KB. A phone opening a tab does not need every sensitivity sweep, so the list
 * carries what a row draws and the detail route carries the rest. Read once at import and held in
 * memory: it is a build artefact, not a query.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Split = {
  returnPct: number | null;
  maxDdPct: number | null;
  sharpe: number | null;
  sortino?: number | null;
  expectancyR: number | null;
  trades: number | null;
  winRate?: number | null;
  wins?: number | null;
  losses?: number | null;
  profitFactor?: number | null;
  feesUsd?: number | null;
  avgWinUsd?: number | null;
  avgLossUsd?: number | null;
  bestTradePct?: number | null;
  worstTradePct?: number | null;
  avgHoldBars?: number | null;
};

export type StrategyEntry = {
  id: string;
  name: string;
  family: string | null;
  about: string | null;
  aboutSource: 'strategy' | 'family' | null;
  survives: boolean;
  failedOn: string[];
  single: { inSample: Split; outOfSample: Split };
  portfolio: { inSample: Split; outOfSample: Split };
  sensitivity: { label: string | null; expectancyR: (number | null)[] };
  doubleCommission: { expectancyR: number | null; returnPct: number | null };
  crossAsset: { asset: string; expectancyR: number | null }[];
  detail: {
    trades: number | null; wins: number | null; losses: number | null; winRate: number | null;
    totalPnlUsd: number | null; expectancyR: number | null; avgWinUsd: number | null;
    avgLossUsd: number | null; profitFactor: number | null; maxDrawdownUsd: number | null;
    totalFeesUsd: number | null; avgHoldMinutes: number | null;
  } | null;
};

export type Provenance = {
  source: string; method: string; universe: number | null; interval: string | null;
  bars: number | null; sizeUsd: number | null; caveat: string;
};

type Book = { provenance: Provenance; counts: { total: number; survivors: number; withDetail: number }; strategies: StrategyEntry[] };

const HERE = dirname(fileURLToPath(import.meta.url));
const book: Book = JSON.parse(readFileSync(join(HERE, 'library.json'), 'utf8')) as Book;

/** What a row draws, and nothing else. */
export type StrategySummary = {
  id: string;
  name: string;
  family: string | null;
  survives: boolean;
  /** Out-of-sample, always. The in-sample number is not a result and is not summarised. */
  returnPct: number | null;
  sharpe: number | null;
  winRate: number | null;
  profitFactor: number | null;
  maxDdPct: number | null;
  trades: number | null;
  hasDetail: boolean;
  /** The first stage of the gauntlet it did not get through; null for a survivor. */
  failedStage: GauntletStage | null;
  /** Why, in words, from the first failure at that stage: "lost on BTC out of sample", not just the stage's name. */
  failedReason: string | null;
};

/**
 * The gauntlet, as stages (docs/ROADMAP-WIN.md F5): each strategy went through them in this order, and `failedOn`
 * records every test it failed. Out of sample first — a profit on data it never saw, with enough trades to mean
 * something — then the five-point parameter sweep, then double commission, then the other assets. A strategy passing all
 * four is exactly one the engine marked `survives`, which the test checks.
 */
export const GAUNTLET = [
  { key: 'oos', label: 'Profitable on unseen data, with enough trades', fails: ['OOS', 'unseen return <= 0', 'too few trades anywhere'] },
  { key: 'sweep', label: 'Holds through the parameter sweep', fails: ['Sens'] },
  { key: 'commission', label: 'Survives double commission', fails: ['comm2x'] },
  { key: 'assets', label: 'Holds across assets', fails: ['Multi'] },
] as const;
export type GauntletStage = (typeof GAUNTLET)[number]['key'];

/** The first stage a strategy fell at, by its own `failedOn`; null when it fell at none. */
export function failedStage(failedOn: readonly string[]): GauntletStage | null {
  for (const st of GAUNTLET) if (failedOn.some((f) => (st.fails as readonly string[]).includes(f))) return st.key;
  return null;
}

/**
 * A failure in words. `OOS` is the BTC-only out-of-sample run losing — a strategy can make money on the portfolio's unseen
 * data and still fail it, so "failed out of sample" beside a positive return would read as a contradiction.
 */
const REASON: Record<string, string> = {
  OOS: 'lost on BTC out of sample',
  'unseen return <= 0': 'lost on unseen data',
  'too few trades anywhere': 'too few trades to judge',
  Sens: 'broke in the parameter sweep',
  comm2x: 'broke at double commission',
  Multi: 'failed on other assets',
};

export function failedReason(failedOn: readonly string[]): string | null {
  const stage = failedStage(failedOn);
  if (!stage) return null;
  const st = GAUNTLET.find((g) => g.key === stage)!;
  const first = failedOn.find((f) => (st.fails as readonly string[]).includes(f))!;
  return REASON[first] ?? first;
}

/** How many of the book got through each stage, in order, from all of it. */
export function gauntlet(): { tested: number; stages: { key: GauntletStage; label: string; passed: number }[] } {
  let alive = book.strategies;
  const stages = GAUNTLET.map((st) => {
    alive = alive.filter((s) => !s.failedOn.some((f) => (st.fails as readonly string[]).includes(f)));
    return { key: st.key, label: st.label, passed: alive.length };
  });
  return { tested: book.strategies.length, stages };
}

function summarise(s: StrategyEntry): StrategySummary {
  const o = s.portfolio.outOfSample;
  return {
    id: s.id,
    name: s.name,
    family: s.family,
    survives: s.survives,
    returnPct: o.returnPct,
    sharpe: o.sharpe,
    winRate: o.winRate ?? null,
    profitFactor: o.profitFactor ?? null,
    maxDdPct: o.maxDdPct,
    trades: o.trades,
    hasDetail: s.detail !== null,
    failedStage: failedStage(s.failedOn),
    failedReason: failedReason(s.failedOn),
  };
}

export function libraryProvenance(): Provenance {
  return book.provenance;
}

export function libraryCounts(): { total: number; survivors: number; withDetail: number } {
  return book.counts;
}

/**
 * The book, optionally narrowed.
 *
 * `survivorsOnly` is the filter that matters — ten of three hundred and thirteen — and it is the
 * one the screen defaults to, because a list that opens on all 313 buries the answer in the noise
 * the gauntlet exists to remove.
 */
export function listStrategies(opts: { survivorsOnly?: boolean; family?: string; q?: string } = {}): StrategySummary[] {
  let rows = book.strategies;
  if (opts.survivorsOnly) rows = rows.filter((s) => s.survives);
  if (opts.family) rows = rows.filter((s) => s.family === opts.family);
  if (opts.q) {
    const q = opts.q.toLowerCase();
    rows = rows.filter((s) => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || (s.family ?? '').toLowerCase().includes(q));
  }
  return rows.map(summarise);
}

export function families(): { name: string; count: number; survivors: number }[] {
  const by = new Map<string, { count: number; survivors: number }>();
  for (const s of book.strategies) {
    const key = s.family ?? 'Other';
    const cur = by.get(key) ?? { count: 0, survivors: 0 };
    cur.count += 1;
    if (s.survives) cur.survivors += 1;
    by.set(key, cur);
  }
  return [...by.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.survivors - a.survivors || b.count - a.count);
}

export function getStrategy(id: string): StrategyEntry | null {
  return book.strategies.find((s) => s.id === id) ?? null;
}
