/**
 * The draft portfolio's three sleeves on this build (2026-09-24).
 *
 * `fixtures/sleeves.ts` is generated from the design's Base portfolio — WETH and cbBTC, Ondo equities, Aave yield — none
 * of which is on Monad. On Monad the same three slots hold what trades there: the two majors, MON itself, and cash in the
 * settlement dollar. Product config, not measured data, as before.
 */
import { onMonad, settlementSymbol } from '@/chain';
import { sleeveFixtures } from './fixtures/sleeves';
import type { Sleeve } from './types';

const MONAD_SLEEVES: Sleeve[] = [
  { name: 'Blue-chip crypto', weight: 55, note: 'WETH and WBTC, the liquid core the bot rebalances.', color: '#5B93FF' },
  { name: 'Monad', weight: 30, note: 'WMON, the chain’s own token.', color: '#B58CFF' },
  { name: 'Cash', weight: 15, note: `Held in ${settlementSymbol}, ready for the agents.`, color: '#49E39B' },
];

export const sleeves: Sleeve[] = onMonad ? MONAD_SLEEVES : sleeveFixtures;
