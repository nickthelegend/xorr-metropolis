/**
 * Chainlink price feeds on Monad mainnet (PLAN.md P2.2, 2026-09-24).
 *
 * The proxies are the ones in Monad's protocol registry (github.com/monad-crypto/protocols, mainnet/chainlink.jsonc).
 * Each answered `description()` with its pair and 8 decimals on chain 143 on 2026-09-24: MON/USD $0.02407 (38 s old),
 * ETH/USD $2,676.03, AUSD/USD $0.99985.
 *
 * A round older than `maxAgeSec` is reported as stale, never used as if it were a price: a feed that stopped is a reason
 * to refuse, which the caller decides.
 */
import type { PublicClient } from 'viem';
import { monadMainnet } from './mainnet.js';

export const CHAINLINK_MONAD = {
  MON: '0xBcD78f76005B7515837af6b50c7C52BCf73822fb',
  ETH: '0x1B1414782B859871781bA3E4B0979b9ca57A0A04',
  USDC: '0xf5F15f188AbCb0d165D1Edb7f37F7d6fA2fCebec',
  AUSD: '0xE20751C7B5867bCBef815ffc1b284c3f412a9e13',
} as const satisfies Record<string, `0x${string}`>;

export type ChainlinkSymbol = keyof typeof CHAINLINK_MONAD;

/** The registry's symbols a Chainlink feed prices: WMON is MON, WETH is ETH. */
const FEED_FOR: Record<string, ChainlinkSymbol> = { MON: 'MON', WMON: 'MON', ETH: 'ETH', WETH: 'ETH', USDC: 'USDC', AUSD: 'AUSD' };

export function feedFor(symbol: string): ChainlinkSymbol | undefined {
  return FEED_FOR[symbol.toUpperCase()];
}

const AGGREGATOR_ABI = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const;

export type FeedReading = {
  symbol: ChainlinkSymbol;
  feed: `0x${string}`;
  price: number;
  updatedAt: string;
  ageSec: number;
  stale: boolean;
};

/**
 * One feed's latest round. `maxAgeSec` defaults to an hour: MON/USD and ETH/USD moved within a minute when read, and a
 * stablecoin feed updates on deviation, so an hour-old AUSD round is not by itself a fault.
 */
export async function readFeed(
  symbol: ChainlinkSymbol,
  opts: { client?: PublicClient; maxAgeSec?: number; nowSec?: number } = {},
): Promise<FeedReading> {
  const client = opts.client ?? monadMainnet();
  const feed = CHAINLINK_MONAD[symbol];
  const [decimals, round] = await Promise.all([
    client.readContract({ address: feed, abi: AGGREGATOR_ABI, functionName: 'decimals' }),
    client.readContract({ address: feed, abi: AGGREGATOR_ABI, functionName: 'latestRoundData' }),
  ]);
  const [, answer, , updatedAt] = round;
  if (answer <= 0n) throw new Error(`Chainlink ${symbol}/USD answered ${answer}, which is not a price`);
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const ageSec = Math.max(0, now - Number(updatedAt));
  return {
    symbol,
    feed,
    price: Number(answer) / 10 ** decimals,
    updatedAt: new Date(Number(updatedAt) * 1000).toISOString(),
    ageSec,
    stale: ageSec > (opts.maxAgeSec ?? 3600),
  };
}
