/**
 * Filling on Kuru's order book through xorr's `KuruVenue` adapter (Monad mainnet and its fork).
 *
 * Kuru's MON/USDC book is a native-MON book; the delegation spends USDC and sells WMON. The adapter takes the market
 * order and forwards WMON (a buy) or USDC (a sale) to the owner, which is where `XorrDelegation` measures the floor
 * (`contracts/src/KuruVenue.sol`). Sizes are Kuru's own, worked out inside the adapter from the book's parameters; this
 * module only names the side, the amount and the recipient.
 */
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { KURU } from '../evm/chains.js';

const VENUE_ABI = [
  {
    type: 'function',
    name: 'buy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'book', type: 'address' },
      { name: 'quoteIn', type: 'uint256' },
      { name: 'minBaseOut', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [{ name: 'baseOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'sell',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'book', type: 'address' },
      { name: 'baseIn', type: 'uint256' },
      { name: 'minQuoteOut', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [{ name: 'quoteOut', type: 'uint256' }],
  },
] as const;

export type KuruSide = 'buy' | 'sell';

/** Which side of Kuru's MON/USDC book a leg is, or null when Kuru has no book for it here. */
export function kuruSide(inSymbol: string, outSymbol: string): KuruSide | null {
  if (!KURU) return null;
  const pair = `${inSymbol.toUpperCase()}>${outSymbol.toUpperCase()}`;
  if (pair === 'USDC>WMON') return 'buy';
  if (pair === 'WMON>USDC') return 'sell';
  return null;
}

/**
 * The adapter call for one leg. `minOut` is Kuru's own floor (in the output's units): the book reverts rather than fill
 * below it. The delegation checks the same floor again on the owner's balance.
 */
export function kuruSwap(side: KuruSide, amountRaw: bigint, receiver: Address, minOut: bigint): { to: Address; data: Hex } {
  if (!KURU) throw new Error('Kuru is not a venue on this deployment (no KuruVenue address).');
  const book = KURU.books['MON/USDC'];
  return {
    to: KURU.venue,
    data: encodeFunctionData({ abi: VENUE_ABI, functionName: side, args: [book, amountRaw, minOut, receiver] }),
  };
}
