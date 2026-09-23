/**
 * What every venue would give for the same trade (`GET /route/compare`), rebuilt for the venues this build has
 * (2026-09-23): Uniswap v3, and 1inch where this deployment may ask it. The Base-era Aqua and SwapVM books are gone.
 *
 * `settle.ts` picks one and the trail names it; this says what the other would have done. A quote surface: it builds
 * nothing submittable and touches no permission. Each venue's answer is its own quote for the same input, and a venue
 * that cannot serve the size says why in a sentence rather than failing the comparison.
 */
import type { Address } from 'viem';
import { TOKENS as VENUE_TOKENS } from './tokens.js';
import { quote as uniswapQuote } from './uniswap.js';

export type ComparedVenue = 'uniswap-v3' | '1inch';

export type VenueQuote =
  | {
      venue: ComparedVenue;
      /** Units of the OUT token the venue says the taker receives. */
      outAmount: number;
      /** How the venue got there — the pools of a Uniswap path, the protocols 1inch named. */
      detail: string;
      served: true;
      /** Not measured by this comparison: undefined, never zero. */
      gasUsd?: number;
      netUsd?: number;
    }
  | {
      venue: ComparedVenue;
      served: false;
      /** Why this venue is not an option for this size, in a sentence. */
      reason: string;
    };

export type RouteComparison = {
  inSymbol: string;
  outSymbol: string;
  amount: number;
  quotes: VenueQuote[];
  /** The venue with the highest out, or undefined when nothing could serve the size. */
  best?: ComparedVenue;
  /** Undefined here: no leg is costed for gas, and a net comparison missing its costs is not one. */
  bestNet?: ComparedVenue;
  /** How much better the winner is than the next venue that served, in basis points; undefined with one venue. */
  edgeBps?: number;
};

export type ComparePatience = { withinMs: number; priceMs: number };

async function within<T>(work: Promise<T>, ms: number | undefined): Promise<T> {
  if (ms === undefined) return work;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('did not answer in time')), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

const why = (e: unknown) => (e instanceof Error ? e.message.split('\n')[0]! : String(e));

export async function compareVenues(params: {
  owner: Address;
  inSymbol: string;
  outSymbol: string;
  amount: number;
  patience?: ComparePatience;
}): Promise<RouteComparison> {
  const { inSymbol, outSymbol, amount, patience } = params;
  if (!VENUE_TOKENS[inSymbol] || !VENUE_TOKENS[outSymbol]) throw new Error(`No token registry entry for ${inSymbol}/${outSymbol}`);

  const uniswap = within(uniswapQuote({ inSymbol, outSymbol, amount, skipPriceImpact: true }), patience?.withinMs).then(
    (q): VenueQuote => ({ venue: 'uniswap-v3', served: true, outAmount: q.outAmount, detail: q.route }),
    (e): VenueQuote => ({ venue: 'uniswap-v3', served: false, reason: why(e) }),
  );
  const inch = import('./oneinch.js').then(async (m): Promise<VenueQuote | null> => {
    if (!m.oneinchConfigured()) return null;
    try {
      const q = await within(m.quote({ inSymbol, outSymbol, amount, skipPriceImpact: true }), patience?.withinMs);
      return { venue: '1inch', served: true, outAmount: q.outAmount, detail: q.venues.join(', ') || q.route };
    } catch (e) {
      return { venue: '1inch', served: false, reason: why(e) };
    }
  });

  const quotes = (await Promise.all([uniswap, inch])).filter((q): q is VenueQuote => q !== null);
  const served = quotes
    .filter((q): q is Extract<VenueQuote, { served: true }> => q.served)
    .sort((a, b) => b.outAmount - a.outAmount);
  const [first, second] = served;
  return {
    inSymbol,
    outSymbol,
    amount,
    quotes,
    best: first?.venue,
    edgeBps: first && second && second.outAmount > 0 ? ((first.outAmount - second.outAmount) / second.outAmount) * 10_000 : undefined,
  };
}
