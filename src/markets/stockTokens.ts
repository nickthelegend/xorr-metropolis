/**
 * What a Stock Token row says beyond its price: the trading session, a halt, the multiplier, the Chainlink print and the
 * pool's own price (PLAN.md P4.4).
 *
 * Every field is the executor's, from Robinhood's asset and price APIs, the token's `uiMultiplier()` and its Chainlink
 * feed. Each is optional, and each helper here returns nothing for a field that did not arrive: a session chip for a
 * session nobody reported, or "0 bps" for a gap nobody measured, would be a number this app made up.
 */
import type { StockSession, XStockRow } from '@/data/system';

const SESSION_LABEL: Record<StockSession, string> = {
  market: 'Market',
  extended: 'Extended',
  overnight: 'Overnight',
  closed: 'Closed',
};

/** The session chip's word, or undefined when the executor reported no session (or one this app does not know). */
export function sessionLabel(session: unknown): string | undefined {
  return typeof session === 'string' && Object.prototype.hasOwnProperty.call(SESSION_LABEL, session)
    ? SESSION_LABEL[session as StockSession]
    : undefined;
}

/** Whether the chip should read as open (market or extended/overnight) or shut. */
export function sessionOpen(session: unknown): boolean {
  return session === 'market' || session === 'extended' || session === 'overnight';
}

/** The halt banner's sentence, only when the executor said the stock is halted. */
export function haltSentence(row: Pick<XStockRow, 'halted' | 'symbol'>): string | undefined {
  return row.halted === true ? `${row.symbol} is halted. Nothing trades until it resumes.` : undefined;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** "1 token = 1.0011 shares", from the ERC-8056 multiplier; undefined when none arrived or it is not a number. */
export function multiplierLine(multiplier: unknown): string | undefined {
  const m = typeof multiplier === 'string' ? Number(multiplier) : multiplier;
  if (!finite(m) || m <= 0) return undefined;
  const shown = Number(m.toFixed(4));
  return `1 token = ${shown} ${shown === 1 ? 'share' : 'shares'}`;
}

/** A timestamp as ISO text, unix seconds or unix milliseconds, in ms. Undefined when it cannot be read. */
export function toMs(at: unknown): number | undefined {
  if (finite(at)) return at < 1e12 ? at * 1000 : at;
  if (typeof at === 'string' && at.trim() !== '') {
    const n = Number(at);
    if (Number.isFinite(n)) return toMs(n);
    const t = Date.parse(at);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

/** How long ago, in the fewest words: "just now", "4 min ago", "3 h ago", "2 d ago". */
export function ageText(atMs: number, now: number): string {
  const s = Math.max(0, Math.round((now - atMs) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** "Chainlink $178.20 · 4 min ago", or without the age when none arrived; undefined with no Chainlink price. */
export function chainlinkLine(
  row: Pick<XStockRow, 'chainlinkPrice' | 'chainlinkUpdatedAt'>,
  fmtPrice: (n: number) => string,
  now: number,
): string | undefined {
  if (!finite(row.chainlinkPrice)) return undefined;
  const at = toMs(row.chainlinkUpdatedAt);
  return `Chainlink ${fmtPrice(row.chainlinkPrice)}${at === undefined ? '' : ` · ${ageText(at, now)}`}`;
}

/** "Pool $178.61", undefined without a pool price. */
export function poolLine(row: Pick<XStockRow, 'poolPrice'>, fmtPrice: (n: number) => string): string | undefined {
  return finite(row.poolPrice) ? `Pool ${fmtPrice(row.poolPrice)}` : undefined;
}

/** "Pool 0.23% above Chainlink", from signed basis points; undefined when no gap was measured. */
export function deviationLine(deviationBps: unknown): string | undefined {
  if (!finite(deviationBps)) return undefined;
  if (deviationBps === 0) return 'Pool matches Chainlink';
  const pct = Math.abs(deviationBps) / 100;
  return `Pool ${pct.toFixed(2)}% ${deviationBps > 0 ? 'above' : 'below'} Chainlink`;
}

/** The pool's address, however the executor shaped it. */
export function poolAddress(pool: XStockRow['pool']): string | undefined {
  if (typeof pool === 'string') return pool || undefined;
  return pool?.address || undefined;
}
