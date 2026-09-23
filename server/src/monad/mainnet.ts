/**
 * Reads of Monad MAINNET's live state, whatever chain key the executor settles on (PLAN.md P2.1, 2026-09-24).
 *
 * The fork is a copy of Monad at one block: its pools fill for real, but its Chainlink rounds and Kuru's resting orders
 * are as old as the fork. A price reference that has stopped moving is not a reference, so the checks in this folder
 * (`chainlink.ts`, `kuru.ts`, `crosscheck.ts`) read mainnet itself — as the Robinhood Chain build read its live feeds
 * beside a snapshot node. On `monad` the two are the same chain; on `monad-testnet` mainnet is the only market there is.
 *
 * MONAD_RPC overrides the public endpoint (QuickNode's, 25 requests a second).
 */
import { createPublicClient, http, type PublicClient } from 'viem';
import { monad } from 'viem/chains';

export const MONAD_MAINNET_RPC = process.env.MONAD_RPC ?? 'https://rpc.monad.xyz';

let client: PublicClient | undefined;

/** One client for Monad mainnet, batched through Multicall3. */
export function monadMainnet(): PublicClient {
  client ??= createPublicClient({
    chain: monad,
    transport: http(MONAD_MAINNET_RPC, { timeout: 10_000 }),
    batch: { multicall: true },
  }) as PublicClient;
  return client;
}
