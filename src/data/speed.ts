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
  pulse: Pulse;
};

export const speed = {
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
  return `$${v.toPrecision(2).replace(/\.?0+$/, '')}`;
}

/** How many times cheaper Monad was, rounded to a figure a person reads. Null when either side is missing or Monad is not cheaper. */
export function cheaperBy(monadUsd: number | null, ethereumUsd: number | null): number | null {
  if (!monadUsd || !ethereumUsd || !(monadUsd > 0) || !(ethereumUsd > monadUsd)) return null;
  const x = ethereumUsd / monadUsd;
  return x >= 100 ? Math.round(x / 10) * 10 : x >= 10 ? Math.round(x) : Math.round(x * 10) / 10;
}
