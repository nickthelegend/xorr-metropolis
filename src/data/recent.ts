/**
 * The latest fills on xorr, anyone's, read from Envio's index by the executor (`GET /indexed/recent`; ROADMAP-WIN W3).
 * Public: they are on chain already. Shapes mirror `server/src/routes/indexed.ts`.
 */
import { api } from './api';

export type RecentFill = { kind: 'spent' | 'closed'; owner: string; venue: string; symbol: string; amount: number | null; at: string; block: number; tx: string };

export const recent = {
  fills: () => api.get<{ fills: RecentFill[] }>('/indexed/recent').then((r) => r.fills),
};

/** "Bought with $20.00 through Kuru", "Sold 635.95 WMON through Uniswap v3": a fill as a sentence. */
export function fillWords(f: Pick<RecentFill, 'kind' | 'symbol' | 'amount' | 'venue'>): string {
  const venue = f.venue ? ` through ${f.venue}` : '';
  if (f.kind === 'closed') {
    const n = f.amount === null ? '' : `${f.amount.toLocaleString('en-US', { maximumFractionDigits: f.amount >= 100 ? 2 : 4 })} `;
    return `Sold ${n}${f.symbol}${venue}`;
  }
  const usd = f.amount !== null && (f.symbol === 'USDC' || f.symbol === 'AUSD' || f.symbol === 'USDG');
  return usd ? `Bought with $${f.amount!.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${venue}` : `Spent ${f.amount ?? ''} ${f.symbol}${venue}`.replace('  ', ' ');
}
