/**
 * Monad's view of a transaction before it is in a block (MONAD-TECH item 3): `txpool_statusByHash` answers `{status,
 * reason?}`. On Monad `eth_getTransactionByHash` returns only included transactions, so this is how a pending send is
 * told from an absent one. anvil has no such method, and says so.
 */
import type { Hex, PublicClient } from 'viem';

type Read<T> = ({ ok: true } & T) | { ok: false; error: string };
const why = (e: unknown) => (e instanceof Error ? e.message.split('\n')[0]! : String(e)).slice(0, 200);

/** Monad's status for a hash: `{status, reason?}`, or the RPC's refusal (anvil has no txpool_status methods). */
export async function txpoolStatus(client: Pick<PublicClient, 'request'>, hash: Hex): Promise<Read<{ status: string; reason: string | null }>> {
  try {
    const r = (await client.request({ method: 'txpool_statusByHash' as never, params: [hash] as never })) as { status?: string; reason?: string } | string | null;
    if (r && typeof r === 'object') return { ok: true, status: String(r.status ?? 'unknown'), reason: r.reason ?? null };
    return { ok: true, status: String(r ?? 'unknown'), reason: null };
  } catch (e) {
    return { ok: false, error: why(e) };
  }
}

