/**
 * Which screens this build has, and where the ones it does not should go instead.
 *
 * The app carries screens from the builds it came from: Hyperliquid perps and movers, Aave savings on Base, 1inch limit
 * orders and cross-chain quotes, Basenames, a Base subgraph, the Base tokenized-share list. On the Robinhood Chain and
 * Arbitrum build each of those reads a chain it is not on or a venue that is not here, so none is drawn.
 *
 * One list, so a screen is hidden in one place: the route guard redirects to `/not-here`, and every list of links
 * (Explore, Settings, Profile, Safety, Portfolio, chat shortcuts) filters through `shownHere`. The EVM screens — the
 * delegation's approvals, history, verifier, anchor, policy, flatten, Networks — are this build's own and always shown.
 */

import { CHAIN_KEY } from '@/chain';

/** A Monad build (mainnet, testnet or the fork). */
const ON_MONAD = CHAIN_KEY === 'monad' || CHAIN_KEY === 'monad-testnet' || CHAIN_KEY === 'monad-fork';

/**
 * Where the tab bar's Trade button goes: the Stock Token list where Stock Tokens trade (Robinhood Chain), the market list
 * on Monad, where no tokenized equity trades (PLAN.md P2) and MON, WETH and WBTC do.
 */
export const TRADE_ROUTE = ON_MONAD ? '/markets' : '/xstocks';

/** Where "Perps on Perpl" goes: the desk where Perpl runs on this chain, the live markets view on a fork. */
export const PERPS_ROUTE = CHAIN_KEY === 'monad' || CHAIN_KEY === 'monad-testnet' ? '/perps' : '/perpl';

/** Route prefixes with nothing behind them on this build. A prefix matches itself and anything under it. */
export const HIDDEN_HERE: readonly string[] = [
  // Perpetuals: Hyperliquid data. GMX V2 perps get their own screens (PLAN.md P4.5).
  '/futures',
  '/perp',
  '/funding',
  '/movers',
  // Aave savings on Base.
  '/yield',
  '/rates',
  '/balance',
  '/allocation',
  '/strategy/yield',
  // 1inch on Base: limit orders and Base → Arbitrum cross-chain quotes.
  '/limit-orders',
  '/crosschain',
  // Base names, the Base subgraph and the Base sponsor list.
  '/basename',
  '/graph',
  '/spend',
  '/sponsors',
  // The Base tokenized shares (NVDAc…) priced through 1inch; Stock Tokens are `/xstocks`.
  '/stocks',
  // Base crypto replayed over CoinGecko history; nothing on it trades here.
  '/compare',
  '/backtest',
  /*
   * On Monad: GMX V2 is an Arbitrum venue (perps on Monad are Perpl's, PLAN.md P3), and Robinhood's Stock Tokens and
   * their filing dates live on Robinhood Chain. Monad has no tokenized equity to list (checked 2026-09-24 against the
   * official Monad token list).
   */
  // `/oracle` is the Stock Tokens' recorded prices (linked only from the stock list); Monad has no equity to record.
  ...(ON_MONAD ? ['/hedge', '/xstocks', '/xstock', '/earnings', '/oracle'] : []),
  // Perpl perps are Monad's (Perpl's DelegatedAccount desk); no other build has them. The desk needs Perpl on the chain
  // itself — mainnet or testnet — and a fork has no Perpl keeper, so there the live read-only view (`/perpl`) stands in.
  ...(ON_MONAD ? [] : ['/perpl']),
  ...(CHAIN_KEY === 'monad' || CHAIN_KEY === 'monad-testnet' ? [] : ['/perps']),
];

/** Whether `path` has no screen on this build. */
export function hiddenOn(path: string): boolean {
  const bare = path.split('?')[0] ?? path;
  return HIDDEN_HERE.some((p) => bare === p || bare.startsWith(`${p}/`));
}

/** Where a route this build does not have goes instead, or null to stay. */
export function buildRedirect(path: string): string | null {
  return hiddenOn(path) ? `/not-here?from=${encodeURIComponent(path)}` : null;
}

/** Whether a link to `path` should be drawn on this build. */
export function shownHere(path: string): boolean {
  return !hiddenOn(path);
}
