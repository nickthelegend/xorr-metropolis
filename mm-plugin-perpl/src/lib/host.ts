/**
 * What every `mm perpl` command shares with the host: which Perpl, which wallet, and how a transaction is sent — always
 * through `ctx.walletExecutor`, so MetaMask's Guard mode, Blockaid screening and 2FA apply to every Perpl order as they do
 * to a swap. The plugin never sees a key.
 */
import { CommandError, InputFieldType, type CommandIO, type PluginCommandContext } from '@metamask/agent-wallet/plugin';
import type { Address, Hex } from 'viem';
import { NETWORKS, type NetworkKey, type PerplNet } from './perpl.js';

export const networkInput = {
  type: InputFieldType.Select,
  flag: 'network',
  message: 'Which Perpl',
  required: false,
  prompt: false,
  options: [
    { value: 'testnet', label: 'Perpl testnet (Monad testnet, chain 10143)' },
    { value: 'mainnet', label: 'Perpl (Monad mainnet, chain 143)' },
  ],
} as const;

/** Testnet unless asked: a first order should not be real money. */
export function perplNet(choice: string | undefined): PerplNet {
  return NETWORKS[(choice === 'mainnet' ? 'mainnet' : 'testnet') as NetworkKey];
}

type WalletRecord = { address?: string; id?: string; name?: string };
type WalletState = { byokWallets: WalletRecord[]; remoteWallets: WalletRecord[]; selectedWallet?: { ref?: Record<string, string> } };

/** The wallet `mm` has selected, else its first EVM wallet. */
export function selectedEvmAddress(state: WalletState): Address {
  const all = [...state.byokWallets, ...state.remoteWallets].filter((w) => typeof w.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(w.address));
  const ref = state.selectedWallet?.ref ?? {};
  const chosen =
    all.find((w) => (ref.address && w.address?.toLowerCase() === ref.address.toLowerCase()) || (ref.id && w.id === ref.id) || (ref.name && w.name === ref.name)) ??
    all[0];
  if (!chosen) throw new CommandError('NO_EVM_WALLET', 'This agent wallet has no EVM address.', 'Create or select one: mm wallet');
  return chosen.address as Address;
}

export type Sent = { hash: string; status: string; explorer: string };

/** One transaction from the agent wallet, through MetaMask's executor, waited until mined. */
export async function send(
  ctx: PluginCommandContext,
  io: CommandIO,
  commandId: string,
  net: PerplNet,
  tx: { to: Address; data: Hex },
  intent: { summary: string; action: 'perps.open' | 'perps.close' | 'perps.deposit' | 'call'; details?: Record<string, string | undefined> },
): Promise<Sent> {
  const execute = await ctx.walletExecutor(io, commandId);
  const result = await execute({ kind: 'transaction', chainId: net.chainId, transaction: { to: tx.to, data: tx.data }, intent }, { waitForReceipt: true });
  if (result.kind !== 'transaction') throw new CommandError('UNEXPECTED_RESULT', 'The wallet answered with a signature, not a transaction.', 'Report this to the plugin author.');
  if (result.failureCode) {
    throw new CommandError(result.failureCode, `The wallet did not send it: ${result.failureDescription ?? result.status}`, 'mm wallet status shows the job.');
  }
  return { hash: result.hash, status: result.status, explorer: net.explorerTx(result.hash) };
}
