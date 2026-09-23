/**
 * What a route is quoted from, and how its fill paths are named on screen.
 */
import { settlementSymbol } from '@/data/tradable';
import { settlementSymbol as SETTLEMENT_TOKEN } from '@/chain';

/**
 * What a buy pays with. The executor settles every purchase out of USDC, so a route from anything else
 * prices a trade the bot would never make — and a route into USDC is USDC for USDC, which can only fail.
 */
export const PAYS_WITH: string = SETTLEMENT_TOKEN;

/** Is there a route to show into this symbol? Not into the token that pays for it. */
export function routesInto(symbol: string): boolean {
  return settlementSymbol(symbol).toUpperCase() !== PAYS_WITH;
}

/**
 * The three ways a fill can be sourced, named for what each one is. The screens carry no venue names;
 * the route screen names its provider once, in a footnote.
 */
export const FILL_PATH: Readonly<Record<string, string>> = {
  aqua: 'Maker book',
  swapvm: 'Swap program',
  '1inch': 'Aggregator',
  'uniswap-v3': 'Uniswap pool',
};
