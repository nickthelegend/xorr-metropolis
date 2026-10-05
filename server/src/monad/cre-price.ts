/**
 * The MON/USD price a Chainlink CRE workflow writes on Monad testnet (`cre/mon-price`, `contracts/src/XorrPriceReceiver.sol`,
 * 2026-10-05).
 *
 * Monad testnet has no Chainlink MON/USD feed, and the agents trade MON there. Where `CRE_MON_USD_RECEIVER` names the
 * deployed receiver, the testnet price gate anchors MON to the workflow's report — the median of Perpl's mark, Kuru's
 * book and Chainlink's mainnet feed — and refuses every MON order while the report says halt. Before the receiver's first
 * report (or with none configured) the gate reads Chainlink's mainnet feed, as it always did.
 */
import { BaseError, ContractFunctionRevertedError, getAddress, isAddress, parseAbi, type Address, type PublicClient } from 'viem';

const RECEIVER_ABI = parseAbi([
  'struct Observation { int256 answer; uint8 sources; uint16 spreadBps; uint16 anchorGapBps; bool halt; uint64 observedAt; }',
  'function latestObservation() view returns (Observation)',
  'error NoRound()',
]);

export function creMonUsdReceiver(env: string | undefined = process.env.CRE_MON_USD_RECEIVER): Address | null {
  return env && isAddress(env) ? getAddress(env) : null;
}

export type CreObservation = {
  receiver: Address;
  price: number;
  sources: number;
  spreadBps: number;
  anchorGapBps: number;
  halt: boolean;
  observedAt: number;
};

/** The receiver's latest report, or null before its first one. */
export async function readCrePrice(client: PublicClient, receiver: Address): Promise<CreObservation | null> {
  try {
    const o = await client.readContract({ address: receiver, abi: RECEIVER_ABI, functionName: 'latestObservation' });
    return {
      receiver,
      price: Number(o.answer) / 1e8,
      sources: o.sources,
      spreadBps: o.spreadBps,
      anchorGapBps: o.anchorGapBps,
      halt: o.halt,
      observedAt: Number(o.observedAt),
    };
  } catch (e) {
    const reverted = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName === 'NoRound') return null;
    throw e;
  }
}
