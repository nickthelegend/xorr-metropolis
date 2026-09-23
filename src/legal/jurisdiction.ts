/**
 * Who may hold Robinhood Stock Tokens (PLAN.md P1.9).
 *
 * Robinhood does not offer Stock Tokens to US persons, and restricts them in Canada, the UK and Switzerland. Said once at
 * onboarding, on the screen where the permission is granted, and in one line on every stock ticket; the risk disclosure
 * carries the rest.
 */
export const STOCK_TOKEN_NOTICE = {
  title: 'Stock Tokens are not for US persons',
  detail: 'They are also restricted in Canada, the UK and Switzerland. Hold them only where you may.',
} as const;

/** The one line under a stock ticket. */
export const STOCK_TOKEN_TICKET_LINE = 'Not for US persons. Restricted in Canada, the UK and Switzerland.';

/**
 * Monad's notice (2026-09-24): no Stock Token trades there; the restriction that applies is Perpl's. Perpl's own
 * `geo_block` list (its public context, mainnet and testnet alike, read 2026-09-24): BY, CU, GB, IR, KP, RU, SY, UA, US.
 */
export const PERPL_NOTICE = {
  title: 'Perps on Perpl are not offered in the US or the UK',
  detail: 'Perpl also blocks Belarus, Cuba, Iran, North Korea, Russia, Syria and Ukraine. Trade only where you may.',
} as const;
