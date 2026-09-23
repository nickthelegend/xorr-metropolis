/**
 * Kuru, Monad's on-chain central limit order book: the top of each book xorr reads (PLAN.md P2.3, 2026-09-24).
 *
 * Market addresses from Kuru's contract list (docs.kuru.io/contracts/Contract-addresses). `bestBidAsk()` answers both
 * sides in 18-decimal price units; `getMarketParams()` names the base (the zero address is native MON) and the quote. On
 * chain 143 on 2026-09-24 the MON/USDC book read bid $0.024069 / ask $0.024085 (6.6 bps), and the MON/AUSD book was
 * empty — `bestBidAsk()` answered (2^256−1, 0), Kuru's sentinel for a side with no resting order. An empty side is
 * reported as null, never as a price of zero or infinity.
 *
 * This is the read half of the Kuru venue. Routing a fill through Kuru's router is PLAN.md P2.4.
 */
import { maxUint256, type PublicClient } from 'viem';
import { monadMainnet } from './mainnet.js';

export const KURU_MONAD = {
  router: '0xd651346d7c789536ebf06dc72aE3C8502cd695CC',
  flowRouter: '0x0d3a1BE29E9dEd63c7a5678b31e847D68F71FFa2',
  markets: {
    'MON/USDC': '0x065C9d28E428A0db40191a54d33d5b7c71a9C394',
    'MON/AUSD': '0x131a2e70a5b31a517a74b8c567149bc294470da9',
  },
} as const;

export type KuruMarket = keyof typeof KURU_MONAD.markets;

const ORDERBOOK_ABI = [
  {
    type: 'function',
    name: 'bestBidAsk',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }],
  },
] as const;

/** Kuru's prices are fixed-point with 18 decimals, whatever the tokens' own decimals. */
const PRICE_ONE = 10n ** 18n;

export type KuruBook = {
  market: KuruMarket;
  address: `0x${string}`;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spreadBps: number | null;
};

/** A side's raw value as a price, or null where Kuru says the side is empty (0 or 2^256−1). */
export function side(raw: bigint): number | null {
  if (raw === 0n || raw === maxUint256) return null;
  return Number(raw) / Number(PRICE_ONE);
}

export function bookFrom(market: KuruMarket, bidRaw: bigint, askRaw: bigint): KuruBook {
  const bid = side(bidRaw);
  const ask = side(askRaw);
  const both = bid !== null && ask !== null && ask >= bid;
  const mid = both ? (bid + ask) / 2 : null;
  return {
    market,
    address: KURU_MONAD.markets[market],
    bid,
    ask,
    mid,
    spreadBps: both && mid ? ((ask - bid) / mid) * 10_000 : null,
  };
}

/** The top of one Kuru book, read from Monad mainnet. */
export async function readBook(market: KuruMarket, client: PublicClient = monadMainnet()): Promise<KuruBook> {
  const [bidRaw, askRaw] = await client.readContract({
    address: KURU_MONAD.markets[market],
    abi: ORDERBOOK_ABI,
    functionName: 'bestBidAsk',
  });
  return bookFrom(market, bidRaw, askRaw);
}
