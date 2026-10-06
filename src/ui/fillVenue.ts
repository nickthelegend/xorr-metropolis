/**
 * fillVenue.ts — naming the place a fill actually happened.
 *
 * The executor records a venue on every fill (`strategy_runs.venue`), and until now no screen showed it. A receipt that
 * says "filled" without saying *where* is the one claim in this app nobody can check, because the venue is what decides
 * whether the signature beside it is an AMM trade or a book entry.
 *
 * ## The rule this module exists to enforce
 *
 * `server/src/venues/jupiter.ts` is explicit about its two outcomes, and about the mistake to avoid:
 *
 *   `jupiter-route` — the Jupiter program was invoked and an AMM filled the order.
 *   `venue-vault`   — the venue vault settled it at the Jupiter quote price, with **no route executed**.
 *   "Callers must not describe the second as a Jupiter swap."
 *
 * This is that caller. The two get different words, and the vault's wording never says swap, route, AMM or Jupiter
 * *executed* anything — because it did not. Getting that wrong would not be a copy bug; it would be the app claiming an
 * on-chain trade that never took place, beside a signature that proves something else entirely.
 *
 * A venue this build does not recognise is shown **verbatim**. Inventing a friendly name for an identifier we cannot
 * interpret would be guessing at the one field the reader came to check, and a venue the app cannot name is still a
 * venue the executor recorded.
 */

/** What a receipt can say about where a fill happened. */
export type VenueNaming = {
  /** The short label on the receipt. */
  label: string;
  /** One line saying what that venue actually did. Absent for an identifier this build cannot interpret. */
  detail?: string;
  /** Whether a route was really executed on-chain. `false` for a vault settlement; undefined when unknown. */
  routed?: boolean;
  /** This build does not recognise the identifier, so the label is the raw value. */
  unrecognised?: boolean;
};

/**
 * The venues this build can speak for.
 *
 * Uniswap v3 (Stock Tokens against USDG on Robinhood Chain, spot on Arbitrum) and GMX are this build's. The rest are
 * venues still present in older runs; a wallet's history does not stop existing because the product moved chain, and a
 * receipt from before the move must still name its venue rather than reporting it as unknown.
 */
const KNOWN: Readonly<Record<string, VenueNaming>> = {
  'uniswap-v3': { label: 'Uniswap v3', detail: 'Filled in a Uniswap v3 pool.', routed: true },
  kuru: { label: 'Kuru', detail: 'A market order on Kuru’s on-chain order book, delivered to your wallet.', routed: true },
  gmx: { label: 'GMX', detail: 'An order on GMX V2, executed by its keepers.', routed: true },
  'jupiter-route': {
    label: 'Jupiter route',
    detail: 'The Jupiter program was invoked and an AMM filled this order.',
    routed: true,
  },
  'venue-vault': {
    /*
     * Never "Jupiter". The vault settled at a price Jupiter quoted, which is not the same event as Jupiter filling it,
     * and the difference is the whole reason the executor records two values instead of one.
     */
    label: 'Venue vault',
    detail: 'The venue vault settled this at the Jupiter quote price. No route was executed.',
    routed: false,
  },
  '1inch': { label: '1inch', detail: 'Routed through the 1inch aggregator.', routed: true },
  aqua: { label: 'Aqua book', detail: 'Filled against the Aqua order book.', routed: true },
  swapvm: { label: 'SwapVM', detail: 'Filled by the SwapVM program.', routed: true },
  aave: { label: 'Aave', detail: 'Supplied to the Aave pool.', routed: true },
};

/**
 * How a receipt should name a recorded venue, or `undefined` when none was recorded.
 *
 * `undefined` is a real and distinct answer: a run that never reached a venue — blocked by the cap, refused by the
 * rules, skipped — has no venue, and that is not the same as a venue we failed to read. The caller says "unavailable"
 * for one and nothing at all for the other.
 */
export function venueNaming(venue: string | null | undefined): VenueNaming | undefined {
  if (venue === null || venue === undefined) return undefined;
  const key = venue.trim();
  if (key === '') return undefined;
  return KNOWN[key] ?? KNOWN[key.toLowerCase()] ?? { label: key, unrecognised: true };
}

/**
 * A transaction signature, short enough for one line and long enough to find.
 *
 * Both ends, never a prefix: two signatures can share leading characters, and a truncation nobody can match against an
 * explorer is decoration shaped like proof. Anything already short is returned exactly as it came, because a signature
 * this app did not produce is not one it should reformat.
 */
export function shortSignature(signature: string): string {
  const head = 8;
  const tail = 8;
  return signature.length <= head + tail + 1 ? signature : `${signature.slice(0, head)}…${signature.slice(-tail)}`;
}

/**
 * A slot number as a receipt shows it, or `undefined` when there is nothing real to show.
 *
 * Zero is not a slot and neither is a negative or a fraction, so none of them are drawn: a receipt is the one surface
 * where a placeholder number would be indistinguishable from a recorded fact.
 */
export function slotLabel(slot: number | null | undefined): string | undefined {
  if (typeof slot !== 'number' || !Number.isFinite(slot) || !Number.isInteger(slot) || slot <= 0) return undefined;
  return slot.toLocaleString('en-US');
}

/**
 * What routing was worth on one fill, where both venues were measured (Kuru's book and Uniswap, `settle.ts`): the chosen
 * venue's measure beside what the other would have delivered, and the difference as a share. Null where only one venue
 * was measured.
 */
export function routingLine(run: {
  venue?: string | null;
  compared?: { venue: string; units: number; chosenUnits: number } | null;
  unit: string;
}): string | null {
  const c = run.compared;
  if (!c || !(c.units > 0) || !(c.chosenUnits > 0)) return null;
  const chosen = venueNaming(run.venue)?.label ?? run.venue ?? 'The venue';
  const other = venueNaming(c.venue)?.label ?? c.venue;
  const n = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 2 : 6 });
  const edge = ((c.chosenUnits - c.units) / c.units) * 100;
  const pct = `${Math.abs(edge).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
  // Below a hundredth of a percent the share rounds to "0%", which reads as nothing measured: say the two were level.
  const worth = Math.abs(edge) < 0.005 ? 'level to within 0.01%' : edge >= 0 ? `${pct} more by routing here` : `${pct} less, within the floor`;
  return `${chosen} measured ${n(c.chosenUnits)} ${run.unit}; ${other} would have delivered ${n(c.units)} — ${worth}.`;
}
