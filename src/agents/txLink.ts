/**
 * A transaction as a line: an explorer link where the chain has one, the bare hash "on the fork" where it does not —
 * a fork's hash on the real chain's explorer would 404 and read as the transaction not being real.
 */
import { activeChain, walletSignsOnly } from '@/chain';

export function shortHash(hash: string): string {
  return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

export function txLink(hash: string): { label: string; url?: string } {
  const base = activeChain.blockExplorers?.default.url;
  if (walletSignsOnly || !base) return { label: `${shortHash(hash)} · on the fork` };
  return { label: shortHash(hash), url: `${base.replace(/\/$/, '')}/tx/${hash}` };
}
