/**
 * Send once the sender's MON is spendable (2026-09-24).
 *
 * Monad executes asynchronously: a transaction is admitted against state a few blocks behind the head, so MON that has just
 * arrived — a gas top-up the executor mined a moment ago — is not spendable yet, and the node answers "Signer had
 * insufficient balance" (measured on Monad testnet: an idle key refused at +0 s and admitted at +3 s; a key topped up right before an order
 * still refused after 15 s). Every place that funds a key and
 * then signs with it goes through this. viem carries the node's words in `details`, not `message`, which is why a check of
 * `message` alone never retried.
 */
import { BaseError, type Hex } from 'viem';

export function isNotYetSpendable(e: unknown): boolean {
  const text = e instanceof BaseError ? `${e.details ?? ''} ${e.shortMessage} ${e.message}` : String(e);
  return /insufficient balance/i.test(text);
}

export async function sendWhenSpendable(send: () => Promise<Hex>, opts: { attempts?: number; waitMs?: number } = {}): Promise<Hex> {
  // Up to ~40 s: the lag was 3 s on an idle key, and past 15 s for a key topped up right before an order (testnet).
  const attempts = opts.attempts ?? 20;
  for (let i = 0; ; i++) {
    try {
      return await send();
    } catch (e) {
      if (i >= attempts - 1 || !isNotYetSpendable(e)) throw e;
      await new Promise((r) => setTimeout(r, opts.waitMs ?? 2000));
    }
  }
}

/**
 * Fees for a Monad transaction: the base fee plus 10%, and a 2 gwei tip.
 *
 * Monad admits a transaction only if the sender holds gas LIMIT × MAX FEE up front, and bills the limit. viem's default
 * max fee is twice the base fee, which nearly doubles what a small wallet must hold: a 261k-gas withdrawal needed 0.048
 * MON at viem's 182 gwei against 0.027 MON at the 102 gwei the network charges (Monad testnet, 2026-09-24). A wallet
 * holding a 0.05 MON drip could not send it. Elsewhere this returns nothing and the client's defaults stand.
 */
export async function monadFees(client: { getBlock: (a: { blockTag: 'latest' }) => Promise<{ baseFeePerGas: bigint | null }> }, chainId: number) {
  if (chainId !== 143 && chainId !== 10143) return {};
  const block = await client.getBlock({ blockTag: 'latest' });
  const base = block.baseFeePerGas ?? 100_000_000_000n;
  const tip = 2_000_000_000n;
  return { maxFeePerGas: (base * 110n) / 100n + tip, maxPriorityFeePerGas: tip };
}
