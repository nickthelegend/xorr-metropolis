/**
 * The wallet's on-chain record as Envio's HyperIndex holds it (`GET /indexed`, `server/src/routes/indexed.ts`,
 * `indexer/`): what the owner granted, spent and stopped, each day against its cap, which venue carried how much, and
 * whether each Perpl desk can still be traded — derived by the indexer from the contracts' own events.
 *
 * Amounts arrive as base-unit strings; the settlement token (USDC on the fork, AUSD on testnet) has 6 decimals.
 */
type Base = string;

export type IndexedRecord = {
  source: 'envio-hyperindex';
  chainId: number;
  synced: { block: number; head: number; fromBlock: number; events: number } | null;
  owner: {
    grants: number;
    dailyCap: Base;
    revoked: boolean;
    spends: number;
    spentTotal: Base;
    closes: number;
    venues: number;
  } | null;
  days: { day: string; spent: Base; fills: number; capAtDay: Base }[];
  fills: { kind: 'spent' | 'closed'; venueName: string; amount: Base; timestamp: number; txHash: string }[];
  venues: { name: string; spends: number; spentVolume: Base; closes: number }[];
  desks: { id: string; operatorActive: boolean; operatorChanges: number }[];
  revocations: { delegate: string; timestamp: number; txHash: string }[];
};

const usd = (base: Base) => `$${(Number(base) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The record in a few plain lines; `today` is yyyy-mm-dd (UTC). */
export function indexedLines(r: IndexedRecord, today: string): string[] {
  const lines: string[] = [];
  const o = r.owner;
  if (!o) return ['Nothing on chain for this wallet yet.'];
  const orders = `${o.spends} order${o.spends === 1 ? '' : 's'}`;
  lines.push(`${usd(o.spentTotal)} spent over ${orders}${o.closes ? `, ${o.closes} closed` : ''}${o.revoked ? ' · permission stopped on chain' : ''}.`);
  const d = r.days.find((x) => x.day === today);
  if (d && !o.revoked) lines.push(`Today: ${usd(d.spent)} of the ${usd(d.capAtDay)} cap.`);
  const used = r.venues.filter((v) => v.spends > 0 || v.closes > 0);
  if (used.length) lines.push(`Where fills went, every wallet: ${used.map((v) => `${v.name} ${v.spends + v.closes} (${usd(v.spentVolume)} in)`).join(' · ')}.`);
  if (r.desks.length) {
    const live = r.desks.filter((x) => x.operatorActive).length;
    lines.push(`Perpl desk${r.desks.length === 1 ? '' : 's'}: ${live ? `${live} tradable` : 'stopped'}${r.desks.length - live && live ? `, ${r.desks.length - live} stopped` : ''}.`);
  }
  return lines;
}
