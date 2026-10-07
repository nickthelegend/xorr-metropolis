import { describe, expect, it } from 'vitest';
import { failedReason, failedStage, gauntlet, libraryCounts, listStrategies } from './library.js';

describe('the gauntlet, stage by stage, from the book', () => {
  it('313 went in; each stage keeps fewer; the last keeps exactly the ones the engine marked as surviving', () => {
    const g = gauntlet();
    expect(g.tested).toBe(313);
    expect(g.stages.map((s) => s.key)).toEqual(['oos', 'sweep', 'commission', 'assets']);
    for (let i = 1; i < g.stages.length; i++) expect(g.stages[i]!.passed).toBeLessThanOrEqual(g.stages[i - 1]!.passed);
    expect(g.stages.at(-1)!.passed).toBe(libraryCounts().survivors);
    // As read on 7 Oct: 313 → 16 → 16 → 15 → 10.
    expect(g.stages.map((s) => s.passed)).toEqual([16, 16, 15, 10]);
  });

  it('every survivor fell at no stage, and every strategy that did not survive fell at one', () => {
    for (const s of listStrategies()) expect(s.failedStage === null).toBe(s.survives);
  });

  it('a strategy falls at the first stage its failures name, not the last', () => {
    expect(failedStage(['Multi', 'OOS'])).toBe('oos');
    expect(failedStage(['comm2x', 'Multi'])).toBe('commission');
    expect(failedStage(['BTC-only n=3 (judged on portfolio)'])).toBeNull();
  });

  it('the reason is the failure, in words — a portfolio profit that lost on BTC says so', () => {
    expect(failedReason(['OOS', 'Sens', 'comm2x'])).toBe('lost on BTC out of sample');
    expect(failedReason(['BTC-only n=0 (judged on portfolio)', 'too few trades anywhere'])).toBe('too few trades to judge');
    expect(failedReason(['comm2x'])).toBe('broke at double commission');
    expect(failedReason(['BTC-only n=3 (judged on portfolio)'])).toBeNull();
  });
});
