/**
 * The catalog carries no prices at all (PLAN.md P4.6).
 *
 * It used to carry the design prototype's numbers — "BTC $66,560", "LINK $18.44", and under a SIMULATED tag
 * "OPENAI $164.20" — and a live instrument whose feed timed out could fall back to them. Every row is now a dash until a
 * live read replaces it. The commodity, index and pre-IPO classes went with their numbers: nothing prices or trades them
 * on this build, and a class that is only dashes is not a market.
 *
 * This keeps it that way: `tools/gen-fixtures.mjs` regenerates the file from `ui/mobile-ui/data/markets.json`, which
 * still has every one of those numbers.
 */
import { describe, expect, it } from 'vitest';
import { assetClasses } from './markets';

const instruments = assetClasses.flatMap((c) => c.instruments);

describe('no invented prices in the catalog', () => {
  it('gives no row a price', () => {
    const priced = instruments.filter((i) => /\d/.test(i.px)).map((i) => `${i.sym} ${i.px}`);
    expect(priced, `rows carry a price: ${priced.join(', ')}`).toEqual([]);
  });

  it('gives no row a change figure, so no ranking can sort a move nobody made', () => {
    const moved = instruments.filter((i) => i.chg.trim() !== '').map((i) => `${i.sym} ${i.chg}`);
    expect(moved, `rows carry a change: ${moved.join(', ')}`).toEqual([]);
  });

  it('keeps what is genuinely catalog on every row', () => {
    for (const i of instruments) {
      expect(i.sym, 'a row lost its symbol').toBeTruthy();
      expect(i.name, `${i.sym} lost its name`).toBeTruthy();
    }
  });
});
