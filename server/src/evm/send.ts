/**
 * Sending a fill on Monad: the receipt with the send, and the time to final (2026-10-07; MONAD-TECH item 2).
 *
 * Monad's RPC has `eth_sendRawTransactionSync` (EIP-7966): the node answers the send with the transaction's receipt once
 * it has executed in a proposed block, so there is no receipt polling and the time to "executed" is the time the call
 * took. That receipt is speculative — the block is Proposed, not yet final — so the fill is timed twice, honestly:
 *
 *   executed  the send call's own duration, from broadcast to the receipt in hand;
 *   final     until the chain's `finalized` block reaches the fill's block (two slots on Monad, ~600 ms), with the block
 *             hash at that height checked against the receipt's: a fill that landed in a proposal that lost is not final.
 *
 * The transaction is signed here first, so its hash is known before anything is sent: a crash mid-send still leaves the
 * hash the run recorded. A node without the method (or one that refuses it, as a node without execution events does)
 * gets the same signed bytes through `eth_sendRawTransaction`, and the fill is timed by polling as before.
 *
 * On the local fork anvil implements the sync send (one parameter only, which is what this sends) but has no consensus:
 * every block is final when mined. The speed card says so rather than letting a fork's numbers stand for Monad's.
 */
import { keccak256, type Hex, type PublicClient, type TransactionReceipt, type WalletClient } from 'viem';
import { getBalance, sendRawTransaction, sendRawTransactionSync } from 'viem/actions';
import { inFlightCheck, reserveLedger, type ReserveLedger } from '../monad/reserve.js';

export type Sent = {
  hash: Hex;
  /** When the bytes went to the node (ms since epoch). */
  sentAt: number;
  /** The receipt the node returned with the send, and how long the call took; null when it was sent without one. */
  sync: { receipt: TransactionReceipt; ms: number } | null;
};

/** The few sends kept for the run that made them to read back (`syncOf`), newest last. */
const recent = new Map<string, Sent>();
const KEEP = 64;

/** What `broadcast` measured for a hash it sent, if it still holds it. */
export function sentOf(hash: string): Sent | undefined {
  return recent.get(hash.toLowerCase());
}

function remember(s: Sent): void {
  recent.set(s.hash.toLowerCase(), s);
  while (recent.size > KEEP) recent.delete(recent.keys().next().value!);
}

/** An RPC refusal that means "this node has no sync send", as opposed to "this transaction failed". */
export function noSyncMethod(e: unknown): boolean {
  const err = e as { name?: string; code?: number; details?: string; message?: string; cause?: unknown };
  const text = `${err?.name ?? ''} ${err?.details ?? ''} ${err?.message ?? ''}`;
  if (err?.name === 'MethodNotFoundRpcError' || err?.name === 'MethodNotSupportedRpcError') return true;
  if (err?.code === -32601 || err?.code === -32004) return true;
  if (/method not (found|supported)|does not exist|not supported|unknown method/i.test(text)) return true;
  return err?.cause !== undefined && err.cause !== e ? noSyncMethod(err.cause) : false;
}

/** A plain send of bytes the node may already hold (a sync call that failed after the node took them). */
function alreadyKnown(e: unknown): boolean {
  const text = String((e as { details?: string; message?: string })?.details ?? (e as Error)?.message ?? e);
  return /already known|known transaction|nonce too low|already imported/i.test(text);
}

/**
 * Sign `request` with the wallet's local account and send it, with the receipt if the node can give one.
 * `useSync` false sends plainly (chains without the method). The request is a prepared call (`simulateContract`'s).
 */
export async function broadcast(
  wallet: WalletClient,
  request: Parameters<WalletClient['prepareTransactionRequest']>[0],
  opts: { useSync: boolean; now?: () => number; ledger?: ReserveLedger },
): Promise<Sent> {
  const now = opts.now ?? Date.now;
  const account = wallet.account;
  if (!account || account.type !== 'local') throw new Error('broadcast signs locally; this wallet has no local account');
  const prepared = await wallet.prepareTransactionRequest({ ...request, account, chain: wallet.chain } as never);
  const serializedTransaction = (await account.signTransaction(prepared as never)) as Hex;
  const hash = keccak256(serializedTransaction);
  /*
   * Monad's reserve rule at consensus (monad/reserve.ts, MONAD-TECH item 6): the fees this sender has in flight must fit
   * within min(10 MON, its balance three blocks ago), or a later transaction is not included. Only asked when something
   * is in flight, so the common send costs no extra read; when it would not fit, the window is waited out once.
   */
  const ledger = opts.ledger ?? reserveLedger;
  const p = prepared as { gas?: bigint; maxFeePerGas?: bigint; gasPrice?: bigint };
  const feeWei = (p.gas ?? 0n) * (p.maxFeePerGas ?? p.gasPrice ?? 0n);
  if (opts.useSync && ledger.inFlight(account.address, now()) > 0n) {
    const balance = await getBalance(wallet, { address: account.address }).catch(() => undefined);
    if (balance !== undefined && !inFlightCheck({ laggedBalanceWei: balance, inFlightFeesWei: ledger.inFlight(account.address, now()), feeWei }).ok) {
      await new Promise((r) => setTimeout(r, ledger.waitMs(account.address, now())));
    }
  }
  const sentAt = now();
  if (opts.useSync) ledger.record(account.address, feeWei, sentAt);
  if (opts.useSync) {
    try {
      const receipt = await sendRawTransactionSync(wallet, { serializedTransaction });
      const s: Sent = { hash, sentAt, sync: { receipt, ms: Math.max(0, now() - sentAt) } };
      remember(s);
      return s;
    } catch (e) {
      // Only "no such method" falls back; anything else is this transaction's own failure and is the caller's.
      if (!noSyncMethod(e)) throw e;
    }
  }
  await sendRawTransaction(wallet, { serializedTransaction }).catch((e) => {
    if (!alreadyKnown(e)) throw e;
  });
  const s: Sent = { hash, sentAt, sync: null };
  remember(s);
  return s;
}

/**
 * Milliseconds from `sentAt` until `block` is final: the chain's `finalized` block at or past it, and the hash at that
 * height the receipt's. Undefined when it does not happen within `timeoutMs`, or the block at that height is another
 * proposal's (the fill must be looked up again; it is not final where the receipt said).
 */
export async function finalTimed(
  client: Pick<PublicClient, 'getBlock'>,
  receipt: { blockNumber: bigint; blockHash: Hex },
  sentAt: number,
  opts: { timeoutMs?: number; pollMs?: number; now?: () => number } = {},
): Promise<number | undefined> {
  const now = opts.now ?? Date.now;
  const deadline = sentAt + (opts.timeoutMs ?? 30_000);
  for (;;) {
    const fin = await client.getBlock({ blockTag: 'finalized' }).catch(() => undefined);
    if (fin && fin.number !== null && fin.number >= receipt.blockNumber) {
      const at = fin.number === receipt.blockNumber ? fin : await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => undefined);
      if (!at || at.hash !== receipt.blockHash) return undefined;
      return Math.max(0, now() - sentAt);
    }
    if (now() > deadline) return undefined;
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 100));
  }
}
