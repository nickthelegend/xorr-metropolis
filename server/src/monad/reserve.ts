/**
 * Monad's reserve balance (2026-10-07; MONAD-TECH item 6, docs.monad.xyz "reserve balance", MIP-4).
 *
 * Consensus on Monad runs three blocks ahead of execution, so it must know every transaction it includes can pay for its
 * gas without executing it. Each account keeps a reserve of 10 MON for that:
 *
 *   - at execution, a transaction reverts if its VALUE would leave the sender below min(10 MON, its balance before it) —
 *     its own gas fee may still dip in. An account that has not sent anything in the last three blocks and is not
 *     EIP-7702-delegated may go below once ("the emptying transaction"); a delegated account never may;
 *   - at consensus, the gas fees of an account's transactions in flight must fit within min(10 MON, its balance three
 *     blocks ago), or the later ones are not included.
 *
 * A reverted transaction still pays its gas, so the executor checks before it sends rather than learning from a revert:
 * the agent-gas top-up (the only MON the executor moves with value) is refused with a reason, and a sender whose fees in
 * flight would not fit waits out the three-block window instead of having its transaction dropped. anvil enforces none of
 * this and has no code at the 0x1001 precompile, so on the fork these are the rules, unit-tested; on a Monad network they
 * are what the chain does.
 */
import { formatEther } from 'viem';

export const RESERVE_WEI = 10n * 10n ** 18n;
/** Three blocks at 300 ms, with room for the RPC's delivery. */
export const RESERVE_WINDOW_MS = 1_200;
/** The precompile that reports whether this transaction dipped into the reserve (`dippedIntoReserve()`, CALL only). */
export const RESERVE_PRECOMPILE = '0x0000000000000000000000000000000000001001';

const min = (a: bigint, b: bigint) => (a < b ? a : b);

export type ReserveCheck = { ok: true; emptying?: boolean } | { ok: false; reason: string };

/** Whether a transaction moving `valueWei` executes, or reverts on the reserve rule. */
export function valueSpendCheck(p: { balanceWei: bigint; valueWei: bigint; delegated: boolean; sentWithinWindow: boolean }): ReserveCheck {
  if (p.valueWei === 0n) return { ok: true };
  const floor = min(RESERVE_WEI, p.balanceWei);
  const after = p.balanceWei - p.valueWei;
  if (after >= floor && p.balanceWei >= RESERVE_WEI) return { ok: true };
  if (!p.delegated && !p.sentWithinWindow) return { ok: true, emptying: true };
  return {
    ok: false,
    reason: p.delegated
      ? `it would leave ${formatEther(after > 0n ? after : 0n)} MON, under Monad's 10 MON reserve, and a 7702-delegated account may never go below it`
      : `it would leave ${formatEther(after > 0n ? after : 0n)} MON, under Monad's 10 MON reserve, and this account sent within the last three blocks (only a first transaction in that window may empty it)`,
  };
}

/** Whether one more transaction's fee fits, with what this account already has in flight, at consensus. */
export function inFlightCheck(p: { laggedBalanceWei: bigint; inFlightFeesWei: bigint; feeWei: bigint }): ReserveCheck {
  const room = min(RESERVE_WEI, p.laggedBalanceWei);
  if (p.inFlightFeesWei + p.feeWei <= room) return { ok: true };
  return { ok: false, reason: `${formatEther(p.inFlightFeesWei + p.feeWei)} MON of gas in flight against ${formatEther(room)} MON the reserve rule allows` };
}

/** The fees each sender has sent within the window: what consensus still counts against it. */
export class ReserveLedger {
  private readonly sent = new Map<string, { at: number; feeWei: bigint }[]>();
  constructor(private readonly windowMs: number = RESERVE_WINDOW_MS) {}

  record(address: string, feeWei: bigint, at: number): void {
    const k = address.toLowerCase();
    this.sent.set(k, [...this.live(k, at), { at, feeWei }]);
  }

  inFlight(address: string, now: number): bigint {
    return this.live(address.toLowerCase(), now).reduce((s, x) => s + x.feeWei, 0n);
  }

  /** Whether this sender sent anything within the window (the emptying exception needs it not to have). */
  recent(address: string, now: number): boolean {
    return this.live(address.toLowerCase(), now).length > 0;
  }

  /** How long until the oldest fee in flight leaves the window; 0 when none is. */
  waitMs(address: string, now: number): number {
    const l = this.live(address.toLowerCase(), now);
    return l.length ? Math.max(0, l[0]!.at + this.windowMs - now) : 0;
  }

  private live(k: string, now: number) {
    return (this.sent.get(k) ?? []).filter((x) => now - x.at < this.windowMs);
  }
}

export const reserveLedger = new ReserveLedger();
