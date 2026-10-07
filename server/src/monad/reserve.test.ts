import { describe, expect, it } from 'vitest';
import { parseEther } from 'viem';
import { inFlightCheck, ReserveLedger, valueSpendCheck } from './reserve.js';

const MON = (n: string) => parseEther(n);

describe('valueSpendCheck — does a transfer execute, or revert on the 10 MON reserve', () => {
  it('a transaction moving no value is never stopped by the rule', () => {
    expect(valueSpendCheck({ balanceWei: MON('0.05'), valueWei: 0n, delegated: true, sentWithinWindow: true })).toEqual({ ok: true });
  });
  it('from 50 MON, sending 30 leaves 20: fine', () => {
    expect(valueSpendCheck({ balanceWei: MON('50'), valueWei: MON('30'), delegated: false, sentWithinWindow: true })).toEqual({ ok: true });
  });
  it('from 50 MON, sending 45 right after another send reverts: 5 left is under the reserve', () => {
    const r = valueSpendCheck({ balanceWei: MON('50'), valueWei: MON('45'), delegated: false, sentWithinWindow: true });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/leave 5 MON, under Monad's 10 MON reserve/);
  });
  it('the same send as the first in three blocks is the emptying transaction, and executes', () => {
    expect(valueSpendCheck({ balanceWei: MON('50'), valueWei: MON('45'), delegated: false, sentWithinWindow: false })).toEqual({ ok: true, emptying: true });
  });
  it('a 7702-delegated account never gets the exception', () => {
    const r = valueSpendCheck({ balanceWei: MON('50'), valueWei: MON('45'), delegated: true, sentWithinWindow: false });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/7702-delegated/);
  });
  it('under 10 MON, any value spend needs the exception: the floor is the whole balance', () => {
    expect(valueSpendCheck({ balanceWei: MON('3'), valueWei: MON('1'), delegated: false, sentWithinWindow: true }).ok).toBe(false);
    expect(valueSpendCheck({ balanceWei: MON('3'), valueWei: MON('1'), delegated: false, sentWithinWindow: false }).ok).toBe(true);
  });
});

describe('inFlightCheck — fees in flight against min(10 MON, the balance three blocks ago)', () => {
  it('a small account can carry one Kuru fill (0.043 MON) but not two in the same window', () => {
    const fee = 425_000n * 102_000_000_000n;
    expect(inFlightCheck({ laggedBalanceWei: MON('0.06'), inFlightFeesWei: 0n, feeWei: fee }).ok).toBe(true);
    expect(inFlightCheck({ laggedBalanceWei: MON('0.06'), inFlightFeesWei: fee, feeWei: fee }).ok).toBe(false);
  });
  it('a rich account is capped at 10 MON of fees in flight, not its balance', () => {
    expect(inFlightCheck({ laggedBalanceWei: MON('500'), inFlightFeesWei: MON('9.99'), feeWei: MON('0.02') }).ok).toBe(false);
  });
});

describe('ReserveLedger — what consensus still counts against a sender', () => {
  it('sums fees within the window, forgets them after, and says how long to wait', () => {
    const l = new ReserveLedger(1_200);
    l.record('0xAbC', 5n, 1_000);
    l.record('0xabc', 7n, 1_500);
    expect(l.inFlight('0xABC', 1_600)).toBe(12n);
    expect(l.recent('0xabc', 1_600)).toBe(true);
    expect(l.waitMs('0xabc', 1_600)).toBe(600);
    expect(l.inFlight('0xabc', 2_300)).toBe(7n);
    expect(l.inFlight('0xabc', 2_800)).toBe(0n);
    expect(l.recent('0xabc', 2_800)).toBe(false);
  });
});
