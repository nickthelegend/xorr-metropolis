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
