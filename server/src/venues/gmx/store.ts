/**
 * `gmx_orders`: GMX orders remembered by key between creation and a keeper's verdict (migration
 * 20260923T120000-gmx-orders.sql). The chain is the truth; this table is where the app finds what to ask the chain
 * about, and what the last answer was. Rows are scoped to the executor's chain by the column default.
 */
import type { Hex, PublicClient } from 'viem';
import { query } from '../../db/index.js';
import { orderStatus, type OrderState } from './tracker.js';

export type GmxOrderRow = {
  key: string;
  owner: string;
  market: string;
  is_long: boolean;
  kind: string;
  size_usd: string;
  collateral_usd: string;
  status: string;
  created_tx: string;
  executed_tx: string | null;
  reason: string | null;
  chain: string;
  created_at: Date;
  updated_at: Date | null;
};

export async function recordGmxOrder(o: {
  key: Hex;
  owner: string;
  market: string;
  isLong: boolean;
  kind: 'increase' | 'decrease';
  sizeUsd: number;
  collateralUsd: number;
  createdTx: Hex;
}): Promise<void> {
  await query(
    `INSERT INTO gmx_orders (key, owner, market, is_long, kind, size_usd, collateral_usd, status, created_tx)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
     ON CONFLICT (key) DO NOTHING`,
    [o.key, o.owner, o.market, o.isLong, o.kind, o.sizeUsd, o.collateralUsd, o.createdTx],
  );
}

/** Write what the chain said. 'unknown' writes nothing: not finding an order is not a verdict. */
export async function applyGmxOrderState(s: OrderState): Promise<void> {
  if (s.status === 'unknown') return;
  await query(
    `UPDATE gmx_orders
        SET status = $2, executed_tx = COALESCE($3, executed_tx), reason = COALESCE($4, reason), updated_at = now()
      WHERE key = $1 AND chain = current_setting('xorr.chain_key')`,
    [s.key, s.status, s.status === 'pending' ? null : (s.tx ?? null), s.reason ?? null],
  );
}

export async function listGmxOrders(owner: string, limit = 50): Promise<GmxOrderRow[]> {
  return query<GmxOrderRow>(
    `SELECT * FROM gmx_orders
      WHERE chain = current_setting('xorr.chain_key') AND lower(owner) = lower($1)
      ORDER BY created_at DESC LIMIT $2`,
    [owner, limit],
  );
}

/**
 * The owner's orders, with every still-pending one re-read from the chain first — so "waiting for keeper" is
 * never a stale row. A read that fails leaves the row as it was and says so in `stale`.
 */
export async function listGmxOrdersFresh(
  client: Pick<PublicClient, 'readContract' | 'getLogs' | 'getBlockNumber' | 'getTransactionReceipt'>,
  owner: string,
): Promise<{ orders: GmxOrderRow[]; stale: string[] }> {
  const rows = await listGmxOrders(owner);
  const stale: string[] = [];
  for (const row of rows.filter((r) => r.status === 'pending' || r.status === 'frozen')) {
    try {
      const created = await client.getTransactionReceipt({ hash: row.created_tx as Hex });
      await applyGmxOrderState(await orderStatus(client, row.key as Hex, { fromBlock: created.blockNumber }));
    } catch {
      stale.push(row.key);
    }
  }
  return { orders: stale.length === rows.length && rows.length > 0 ? rows : await listGmxOrders(owner), stale };
}
