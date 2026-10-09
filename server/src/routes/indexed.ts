/**
 * The wallet's on-chain record, as Envio's HyperIndex holds it (Envio bounty, 2026-10-06; `indexer/`).
 *
 * The indexer reads XorrDelegation, the audit anchor and Perpl's desk factory over RPC and writes, beside the events, what
 * they add up to: the owner's grants, spend and stop; each day's spend against its cap; which venue carried how much;
 * whether each Perpl desk can still be traded. It writes into this executor's own Postgres, in its own schema
 * (`ENVIO_PG_SCHEMA`, default `envio`), so this route is the indexer's API: one query per table, no RPC, no scan.
 *
 * Where the indexer has not run, the route says so (503 `index_unavailable`) rather than answering with nothing, which
 * would read as "nothing happened".
 */
import { Hono } from 'hono';
import { query } from '../db/index.js';
import { chain } from '../evm/chains.js';
import { currentWallet } from './wallet-context.js';
import { TOKENS } from '../venues/tokens.js';

export const indexedRoutes = new Hono();

const SCHEMA = (process.env.ENVIO_PG_SCHEMA ?? 'envio').replace(/[^a-z0-9_]/gi, '');
const t = (table: string) => `"${SCHEMA}"."${table}"`;

/** NUMERIC and BIGINT arrive as strings: kept as strings (base units), never rounded through a float. */
type Row = Record<string, string | number | boolean | null>;

export async function indexedFor(owner: string) {
  const o = owner.toLowerCase();
  const id = chain.id;
  const [meta, owners, days, fills, venues, desks, revocations] = await Promise.all([
    query<Row>(`SELECT latest_processed_block, block_height, start_block, num_events_processed, timestamp_caught_up_to_head_or_endblock FROM ${t('chain_metadata')} WHERE chain_id = $1`, [id]),
    query<Row>(`SELECT * FROM ${t('Owner')} WHERE id = $1 AND "chainId" = $2`, [o, id]),
    query<Row>(`SELECT day, spent, fills, "capAtDay" FROM ${t('DailySpend')} WHERE owner = $1 AND "chainId" = $2 ORDER BY day DESC LIMIT 14`, [o, id]),
    query<Row>(`SELECT kind, "venueName", venue, token, amount, timestamp, "txHash" FROM ${t('Fill')} WHERE owner = $1 AND "chainId" = $2 ORDER BY block DESC, id DESC LIMIT 20`, [o, id]),
    query<Row>(`SELECT name, spends, "spentVolume", closes, owners FROM ${t('Venue')} WHERE "chainId" = $1 ORDER BY "spentVolume" DESC`, [id]),
    query<Row>(`SELECT id, operator, "operatorActive", "operatorChanges", "createdAt", "createdTx" FROM ${t('Desk')} WHERE owner = $1 AND "chainId" = $2 ORDER BY "createdAt" DESC`, [o, id]),
    query<Row>(`SELECT delegate, timestamp, "txHash" FROM ${t('Revocation')} WHERE owner = $1 AND "chainId" = $2 ORDER BY block DESC LIMIT 10`, [o, id]),
  ]);
  const m = meta[0];
  return {
    source: 'envio-hyperindex',
    chainId: id,
    synced: m
      ? { block: Number(m.latest_processed_block), head: Number(m.block_height), fromBlock: Number(m.start_block), events: Number(m.num_events_processed) }
      : null,
    owner: owners[0] ?? null,
    days,
    fills,
    venues,
    desks,
    revocations,
  };
}

indexedRoutes.get('/indexed', async (c) => {
  const w = await currentWallet(c);
  if (!w) return c.json({ error: 'no_wallet', detail: 'No wallet for this user yet.' }, 409);
  try {
    return c.json(await indexedFor(w.address));
  } catch (e) {
    const missing = e instanceof Error && /relation .* does not exist|schema .* does not exist/.test(e.message);
    if (missing) {
      return c.json({ error: 'index_unavailable', detail: 'The Envio indexer has not run against this database (indexer/README.md).' }, 503);
    }
    throw e;
  }
});

/** One of the latest fills on xorr, anyone's, as a person reads it (ROADMAP-WIN W3). */
export type RecentFill = { kind: 'spent' | 'closed'; owner: string; venue: string; symbol: string; amount: number | null; at: string; block: number; tx: string };

/** A `Fill` row from the index in words: the token by its symbol here, the amount in its own decimals. */
export function recentFill(r: Row, tokens: Record<string, { address: string; decimals: number }> = TOKENS): RecentFill {
  const addr = String(r.token ?? '').toLowerCase();
  const hit = Object.entries(tokens).find(([, t]) => t.address.toLowerCase() === addr);
  const raw = r.amount === null || r.amount === undefined ? null : String(r.amount);
  const amount = hit && raw !== null && /^\d+$/.test(raw) ? Number(BigInt(raw) * 10_000n / 10n ** BigInt(hit[1].decimals)) / 10_000 : null;
  return {
    kind: r.kind === 'closed' ? 'closed' : 'spent',
    owner: String(r.owner),
    venue: String(r.venueName ?? r.venue ?? ''),
    symbol: hit ? hit[0] : `${addr.slice(0, 6)}…${addr.slice(-4)}`,
    amount,
    at: new Date(Number(r.timestamp) * 1000).toISOString(),
    block: Number(r.block),
    tx: String(r.txHash),
  };
}

/**
 * The latest fills on xorr, anyone's, from Envio's index (ROADMAP-WIN W3). Public: they are on chain already. A new
 * account's History and Runs show these until it has its own, so a first look is at real fills rather than an empty list.
 */
indexedRoutes.get('/indexed/recent', async (c) => {
  try {
    const rows = await query<Row>(
      `SELECT kind, owner, "venueName", venue, token, amount::text AS amount, timestamp, block, "txHash" FROM ${t('Fill')} WHERE "chainId" = $1 ORDER BY block DESC LIMIT 8`,
      [chain.id],
    );
    return c.json({ fills: rows.map((r) => recentFill(r)) });
  } catch (e) {
    const missing = e instanceof Error && /relation .* does not exist|schema .* does not exist/.test(e.message);
    if (missing) return c.json({ error: 'index_unavailable', detail: 'The Envio indexer has not run against this database (indexer/README.md).' }, 503);
    throw e;
  }
});
