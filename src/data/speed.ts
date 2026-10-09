/**
 * The Monad speed receipt's data (docs/ROADMAP-WIN.md F1): Monad mainnet's live pulse, and one fill's speed and cost.
 * Shapes mirror `server/src/monad/speed.ts`; every number is the executor's measurement or absent.
 */
import { api } from './api';

export type Pulse = {
  at: string;
  monad: { block: string | null; blockMs: number | null; gasGwei: string | null; monUsd: number | null };
  ethereum: { gasGwei: string | null; ethUsd: number | null } | null;
};

export type SpeedReceipt = {
  tx: string;
  confirmMs: number | null;
  block: string | null;
  gasUsed: string | null;
  gasLimit: string | null;
  gasPriceGwei: string | null;
  costUsd: number | null;
  /** Which Monad gas price the cost used: what was paid, or (on a fork) mainnet's current price. */
  pricedAt?: 'paid' | 'mainnet';
  monadGasGwei?: string | null;
  ethereumUsd: number | null;
  fork: boolean;
  /** The measured block interval of the chain the fill was on — the local fork's on a fork. */
  chainBlockMs: number | null;
  /** ms from broadcast until the fill's block was final; null when not measured (fills before 7 Oct). */
  finalMs?: number | null;
  /** The receipt came back with the send (`eth_sendRawTransactionSync`): `confirmMs` is that call's duration. */
  sync?: boolean;
  pulse: Pulse;
};

/** One Monad block proposal as the commit-state stream showed it (`server/src/monad/commits.ts`). */
export type CommitState = 'Proposed' | 'Voted' | 'Finalized' | 'Verified';
export type CommitBlock = {
  number: number;
  blockId: string;
  hash: string;
  gasUsed: number;
  state: CommitState;
  /** ms after Proposed at which each later state arrived; null when the proposal itself was not seen. */
  ms: { Voted: number | null; Finalized: number | null; Verified: number | null } | null;
};
export type Commits = {
  network: string;
  live: boolean;
  error: string | null;
  blocks: CommitBlock[];
  stats: { samples: number; votedMs: number | null; finalizedMs: number | null; verifiedMs: number | null };
};

/** One of the wallet's recent fills, timed (`GET /speed/recent`; ROADMAP-WIN W5). */
export type SpeedHistoryItem = {
  id: string;
  tx: string;
  venue: string | null;
  symbol: string | null;
  executedMs: number;
  sync: boolean;
  finalMs: number | null;
  gasUsed: number | null;
  gasLimit: number | null;
  at: string | null;
};

export const speed = {
  /** This wallet's last twenty fills, oldest first: time to executed, the sync send, gas declared and used. */
  history: () => api.get<{ fills: SpeedHistoryItem[] }>('/speed/recent').then((r) => r.fills),
  /** Monad mainnet's newest blocks moving through Proposed → Voted → Finalized → Verified, timed. Public. */
  commits: () => api.get<Commits>('/monad/commits'),
  /** Monad mainnet now: head block, measured block interval, gas; Ethereum's gas for comparison. Public. */
  pulse: () => api.get<Pulse>('/monad/pulse'),
  /** One of your fills: its ms from broadcast to receipt, block, gas, and cost here against Ethereum. */
  forTx: (tx: string) => api.get<SpeedReceipt>(`/speed/${tx}`),
};

/** "1,234,567" from a decimal string, or null. */
export function groupDigits(v: string | null | undefined): string | null {
  if (v === null || v === undefined || !/^\d+$/.test(v)) return null;
  return BigInt(v).toLocaleString('en-US');
}

/** A dollar amount small enough to need its significant digits: $0.00091, $1.56. */
export function tinyUsd(v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  if (v === 0) return '$0';
  if (v >= 0.01) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  // Normalize insignificant mantissa zeroes without stripping zeroes from
  // an exponent ("1.0e-10" must never turn into "1.0e-1").
  return `$${Number(v.toPrecision(2)).toString()}`;
}

/** How many times cheaper Monad was, rounded to a figure a person reads. Null when either side is missing or Monad is not cheaper. */
export function cheaperBy(monadUsd: number | null, ethereumUsd: number | null): number | null {
  if (!monadUsd || !ethereumUsd || !(monadUsd > 0) || !(ethereumUsd > monadUsd)) return null;
  const x = ethereumUsd / monadUsd;
  return x >= 100 ? Math.round(x / 10) * 10 : x >= 10 ? Math.round(x) : Math.round(x * 10) / 10;
}

/** "480 ms" under a second, "1.4 s" from one up; null stays null. */
export function msWords(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} s`;
}

/** The middle value, or null for none. */
export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** How far the declared gas sat over the gas used, as a percentage, across fills that recorded both. */
export function headroomPct(fills: readonly Pick<SpeedHistoryItem, 'gasUsed' | 'gasLimit'>[]): number | null {
  const r = fills.filter((f) => f.gasUsed && f.gasLimit).map((f) => (f.gasLimit! / f.gasUsed! - 1) * 100);
  const m = median(r);
  return m === null ? null : Math.round(m);
}

/** A measured fill may execute in zero ms; keep its bar finite and visible. */
export function speedBarHeight(executedMs: number, longestMs: number, maxHeight: number): number {
  if (!Number.isFinite(executedMs) || !Number.isFinite(longestMs) || longestMs <= 0) return 4;
  return Math.max(4, Math.min(maxHeight, Math.round((executedMs / longestMs) * maxHeight)));
}
