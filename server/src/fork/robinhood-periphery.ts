/**
 * Stateless periphery the Robinhood Chain snapshot node is missing, put back from Robinhood Chain itself (2026-09-23).
 *
 * The hosted `robinhood-fork` node serves a state snapshot (`infra/robinhood-fork`) that captured the accounts a trade
 * WRITES — USDG, the Stock Tokens, their pools, SwapRouter02, xorr's contracts — but not every contract that is only
 * READ. Measured on the node: Multicall3 (`0xcA11…CA11`) and Uniswap's QuoterV2 have no code there. Without Multicall3,
 * viem's `multicall` — which `readPolicy` and every balance read use — fails, and the executor cannot read a permission.
 *
 * Both are stateless: Multicall3 has no storage, and QuoterV2's only state is two immutables compiled into its bytecode.
 * So their code is copied, byte for byte, from Robinhood Chain (`ROBINHOOD_RPC`) with `anvil_setCode` — the canonical
 * contracts at their canonical addresses, nothing reimplemented. Only on a node that answers as anvil with Robinhood
 * Chain's id, and only where the code is absent. Idempotent.
 *
 * (Quotes do not depend on this — `venues/uniswap.ts` overrides the quoter's code inside the `eth_call` when it is
 * absent — but writing it once makes every other reader of the quoter work too.)
 */
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { anvil } from './anvil.js';

export const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';
export const RH_QUOTER_V2: Address = '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7';

export type PeripheryResult = { address: Address; name: string; action: 'present' | 'installed' };

export async function ensureRobinhoodForkPeriphery(opts: {
  rpc: string;
  mainnetRpc?: string;
}): Promise<PeripheryResult[]> {
  const fork = createPublicClient({ transport: http(opts.rpc, { retryCount: 1 }) });
  if ((await fork.getChainId()) !== 4663) throw new Error(`${opts.rpc} is not Robinhood Chain (4663)`);
  // anvil answers this; a real node refuses it — and a real node must never be written to.
  await anvil(opts.rpc, 'anvil_nodeInfo', []);
  const mainnet = createPublicClient({
    transport: http(opts.mainnetRpc ?? process.env.ROBINHOOD_RPC ?? 'https://rpc.mainnet.chain.robinhood.com', { timeout: 15_000 }),
  });

  const out: PeripheryResult[] = [];
  for (const [address, name] of [
    [MULTICALL3, 'Multicall3'],
    [RH_QUOTER_V2, 'Uniswap QuoterV2'],
  ] as const) {
    const have = await fork.getCode({ address });
    if (have && have !== '0x') {
      out.push({ address, name, action: 'present' });
      continue;
    }
    const code = (await mainnet.getCode({ address })) as Hex | undefined;
    if (!code || code === '0x') throw new Error(`${name} ${address} has no code on Robinhood Chain either`);
    await anvil(opts.rpc, 'anvil_setCode', [address, code]);
    out.push({ address, name, action: 'installed' });
  }
  return out;
}
