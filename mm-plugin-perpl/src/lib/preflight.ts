/**
 * Every Perpl transaction is simulated from the wallet's own address before the wallet is asked to sign it, so a refusal
 * — a stale price, a size under the minimum, margin short — is named here instead of being paid for on chain.
 */
import { CommandError } from '@metamask/agent-wallet/plugin';
import { BaseError, ContractFunctionRevertedError, decodeErrorResult, parseAbi, type Address, type Hex, type PublicClient } from 'viem';

const PERPL_ERRORS = parseAbi([
  'error TakerOrderSettlementFailed(uint256 perpId, uint256 accountId, uint256 entryPricePNS, uint256 collatPricePNS, uint256 pnlPricePNS, uint256 filledLotLNS, uint256 unfillableLotLNS, uint256 resultCode)',
  'error ExceedsLastExecutionBlock(uint256 lastExecutionBlock)',
  'error AccountNotCreated()',
]);

/** A revert, by the name Perpl gave it where it can be decoded. */
export function revertName(err: unknown): string {
  const data = err instanceof BaseError ? (err.walk((e) => typeof (e as { data?: unknown }).data === 'string') as { data?: string } | null)?.data : undefined;
  if (typeof data === 'string' && data.startsWith('0x') && data.length >= 10) {
    try {
      const d = decodeErrorResult({ abi: PERPL_ERRORS, data: data as Hex });
      return `${d.errorName}(${(d.args ?? []).map(String).join(', ')})`;
    } catch {
      /* not one of Perpl's named errors */
    }
  }
  const reverted = err instanceof BaseError ? err.walk((e) => e instanceof ContractFunctionRevertedError) : null;
  if (reverted instanceof ContractFunctionRevertedError) return reverted.data?.errorName ?? reverted.shortMessage;
  return err instanceof BaseError ? err.shortMessage : err instanceof Error ? err.message.split('\n')[0]! : String(err);
}

export async function simulate(client: PublicClient, from: Address, to: Address, data: Hex, what: string): Promise<void> {
  try {
    await client.call({ account: from, to, data });
  } catch (e) {
    throw new CommandError('PERPL_REFUSED', `Perpl would refuse ${what}: ${revertName(e)}.`, 'Nothing was sent. mm perpl account shows the account; mm perpl markets the book.');
  }
}
