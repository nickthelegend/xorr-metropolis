/**
 * The Stock Token risk gate the executor runs before any stock BUY or SELL on Robinhood Chain (PLAN.md P1.7,
 * 2026-09-23): `robinhood/guards.ts` `stockTradeCheck` — session tradable now, not halted, a funded pool, a fresh
 * Chainlink feed, whole-vs-fractional, and pool-vs-Chainlink deviation ≤ `ROBINHOOD_MAX_DEVIATION_BPS` (150). A refusal
 * carries its reason and the numbers it was decided on, and is written to the audit trail.
 *
 * Every spend path calls it: `run.ts` (agents, one-off orders, `/xstocks/buy`), `routes/panic.ts closeHolding`
 * (`/positions/close`, `/xstocks/sell`), and `executor/swap.ts` (a conversion out of a stock). Off Robinhood Chain, and
 * for anything that is not a Stock Token, it answers `ok` without asking anything.
 *
 * ## Where each input is read, and why — the snapshot node
 *
 * On Robinhood Chain itself every input is live: Robinhood's API for session and halt, the chain for pool, quote and feed.
 *
 * On `robinhood-fork` the node the fills land on is a SNAPSHOT of Robinhood Chain at block 70254193
 * (`infra/robinhood-fork`), and the choice is:
 *
 *   - **Session and halt**: Robinhood's live API, against the real clock. The fork's clock follows the wall clock, and
 *     whether the US market is open is a fact about now, not about the snapshot.
 *   - **Pool and quote**: the FORK — the pool the fill will actually hit, at the size it will be sent, so the deviation
 *     check measures the price this trade pays.
 *   - **Chainlink**: the LIVE Robinhood Chain feed, through `ROBINHOOD_RPC` (the public RPC; it must not point at the
 *     fork). The snapshot did not capture the feeds — `latestRoundData` on the hosted node returns no data (measured
 *     2026-09-23) — so a fork feed does not exist to be read. Staleness is therefore the live feed's `updatedAt` against
 *     the wall clock: an honest age of a real price.
 *
 *     Comparing the fork's pool with the live feed is honest because the question the deviation rule asks is "is the
 *     price this fill pays fair against the oracle for the real market?" — and it is the fork pool that sets the fill
 *     price. The consequence is stated, not hidden: the snapshot's pools do not follow the market, so as the real price
 *     moves away from the snapshot's, trades on the fork are refused with `deviation` once the gap passes the limit. That
 *     is the rule working — a fill at a price 2% off the market is exactly what it exists to stop — and the remedy is a
 *     fresh snapshot, not a looser rule. (The alternative, the snapshot's own feed values measured against the snapshot's
 *     time, is not available: the feeds were not captured.)
 */
import { erc20Abi, type Address } from 'viem';
import { CHAIN_KEY, IS_ROBINHOOD } from '../evm/chains.js';
import { append } from '../audit/log.js';
import { log } from '../http/request-id.js';
import { fetchAsset, fetchPrice } from '../robinhood/api.js';
import { chainlinkPrice, RH, type SwapQuote as RhSwapQuote, type UsdgPool } from '../robinhood/chain.js';
import { liveGuardDeps, stockTradeCheck, type GuardDeps, type GuardDetail, type GuardReason, type GuardResult } from '../robinhood/guards.js';
import { TOKENS, canonicalSymbol } from '../venues/tokens.js';
import { rhStockAsync } from '../venues/rh-stocks.js';
import { quoteRoute } from '../venues/uniswap.js';

export type StockGuardOutcome =
  | { ok: true; checked: boolean; detail?: GuardDetail }
  | { ok: false; reason: `stock_${GuardReason | 'unreadable'}`; message: string; detail: GuardDetail };

/**
 * Guard inputs on the fork: live API and live feed, fork pool and fork quote. See the file header.
 */
export const forkGuardDeps: GuardDeps = {
  asset: fetchAsset,
  price: fetchPrice,
  chainlink: chainlinkPrice,
  async pool(token: Address): Promise<UsdgPool | null> {
    const entry = await rhStockAsync(symbolAt(token));
    const fee = entry?.pool.fee;
    if (!entry || fee === undefined) return null;
    const { publicClient } = await import('../evm/client.js');
    const usdgBalance = await publicClient.readContract({
      address: RH.USDG,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [entry.pool.address],
    });
    return { pool: entry.pool.address, fee, usdgBalance, usdg: Number(usdgBalance) / 10 ** RH.USDG_DECIMALS };
  },
  async quoteBuy(token, usdg, pool) {
    return forkQuote(RH.USDG, token, BigInt(Math.round(usdg * 1e6)), pool, 'buy');
  },
  async quoteSell(token, tokens, pool) {
    return forkQuote(token, RH.USDG, BigInt(Math.round(tokens * 1e9)) * 10n ** 9n, pool, 'sell');
  },
};

function symbolAt(address: Address): string {
  const k = Object.keys(TOKENS).find((s) => TOKENS[s]!.address.toLowerCase() === address.toLowerCase());
  if (!k) throw new Error(`${address} is not in the registry`);
  return k;
}

async function forkQuote(tokenIn: Address, tokenOut: Address, amountIn: bigint, pool: UsdgPool, side: 'buy' | 'sell'): Promise<RhSwapQuote> {
  const { amountOut, gasEstimate } = await quoteRoute({ tokens: [symbolAt(tokenIn), symbolAt(tokenOut)], fees: [pool.fee] }, amountIn);
  const usdg = side === 'buy' ? Number(amountIn) / 1e6 : Number(amountOut) / 1e6;
  const tokens = side === 'buy' ? Number(amountOut) / 1e18 : Number(amountIn) / 1e18;
  return {
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    fee: pool.fee,
    pool: pool.pool,
    gasEstimate,
    impliedPrice: tokens > 0 ? usdg / tokens : Number.POSITIVE_INFINITY,
  };
}

/** The inputs for the chain this executor settles on. */
export function guardDeps(): GuardDeps {
  return CHAIN_KEY === 'robinhood-fork' ? forkGuardDeps : liveGuardDeps;
}

/**
 * Run the gate for one stock leg, and audit a refusal when a wallet is named.
 *
 * `checked: false` means the gate does not apply (not Robinhood Chain, or not a Stock Token) — never that it was skipped
 * for convenience. A gate that could not be READ (the API down, the feed unreadable) refuses: an unanswered question is
 * not a pass, for a trade in a restricted security.
 */
export async function stockGuard(p: {
  symbol: string;
  side: 'buy' | 'sell';
  usd: number;
  walletId?: string;
  actor?: string;
  now?: Date;
  deps?: GuardDeps;
}): Promise<StockGuardOutcome> {
  const symbol = canonicalSymbol(p.symbol);
  if (!IS_ROBINHOOD || TOKENS[symbol]?.kind !== 'stock') return { ok: true, checked: false };

  let result: GuardResult;
  try {
    result = await stockTradeCheck({ symbol, side: p.side, usdg: p.usd, now: p.now }, p.deps ?? guardDeps());
  } catch (e) {
    const message = `The ${symbol} trade checks could not be read (${e instanceof Error ? e.message.split('\n')[0] : String(e)}), so nothing was placed.`;
    return refuse(p, { ok: false, reason: 'unreadable', detail: { symbol, side: p.side, usdg: p.usd, message } });
  }
  if (result.ok) return { ok: true, checked: true, detail: result.detail };
  return refuse(p, result);
}

async function refuse(
  p: { symbol: string; side: 'buy' | 'sell'; usd: number; walletId?: string; actor?: string },
  result: { ok: false; reason: GuardReason | 'unreadable'; detail: GuardDetail },
): Promise<StockGuardOutcome> {
  const reason = `stock_${result.reason}` as const;
  if (p.walletId) {
    await append({
      walletId: p.walletId,
      agent: p.actor ?? 'Risk check',
      action: `Refused ${p.side === 'buy' ? 'buying' : 'selling'} ${result.detail.symbol}`,
      detail: result.detail.message,
      kind: 'block',
      payload: { reason, guard: JSON.parse(JSON.stringify(result.detail, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) },
    }).catch((e: unknown) => log.error('[stock-guard] failed to audit a refusal:', e));
  }
  return { ok: false, reason, message: result.detail.message, detail: result.detail };
}
