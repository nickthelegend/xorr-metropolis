/**
 * How much gas a delegated call declares (2026-10-07; MONAD-TECH item 6).
 *
 * The estimate is taken against the state as it is NOW, and the transaction executes later. That gap is not free: a
 * lending pool accrues interest on the way through and writes a slot the estimate never priced, and a router's route can
 * touch a pool whose tick has since moved. Measured on a Base fork, an Aave withdraw estimated at 172,488 and used
 * 177,503 — a 3% shortfall, which is an out-of-gas revert, not a slow trade. So the limit carries head-room.
 *
 * How much is a question of who pays for it. On Ethereum and its L2s unused gas is refunded, so head-room only raises the
 * balance a sender must hold: 30%. On Monad the fee is the gas LIMIT times the price — nothing unused comes back — so
 * every point of head-room is paid on every fill. There it is 10%: still three times the shortfall above, and the
 * estimate itself sits well over what a fill uses (7 Oct, the fork: a Uniswap fill estimated ~239k and used 199k; a Kuru
 * fill ~386k and used 309k), while the gap between estimate and execution is one 300 ms block.
 */
import { IS_MONAD } from './chains.js';

export function gasHeadroomPct(monad: boolean): bigint {
  return monad ? 10n : 30n;
}

/** The limit to declare for an estimate. */
export function withHeadroom(estimate: bigint, monad: boolean = IS_MONAD): bigint {
  return (estimate * (100n + gasHeadroomPct(monad))) / 100n;
}
