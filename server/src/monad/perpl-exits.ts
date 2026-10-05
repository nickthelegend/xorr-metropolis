/**
 * Exits on Perpl desks, checked every scheduler tick (Perpl API bounty, "production-ready"; SPONSOR-GAP order 4,
 * 2026-10-05).
 *
 * An agent that can open a leveraged position and then only waits for the next council round to close it is not a bot
 * anyone should run. So each desk carries standing exit rules, set by its owner, and the scheduler checks every open
 * position against them on chain each tick (30 s):
 *
 *   liquidation buffer  the mark is within N% of the liquidation price — close before Perpl liquidates (a liquidation
 *                       takes the maintenance margin with it); default 10%
 *   stop-loss           the position is down N% of its margin; default 50%
 *   take-profit         up N% of its margin; off unless set
 *   funding             it is losing AND paying funding at N% a year or more at the current rate — paying to hold a
 *                       loser; default 50%
 *
 * Profit and loss are worked out here from the mark, the entry and the size, not taken from the position's stored PnL,
 * which Perpl settles on its own schedule. A close goes through `placePerpOrder` like any other order — the operator key,
 * the desk, Perpl's book — and a close is never held to a cap. Nothing runs for a wallet whose agents are stopped, or a
 * desk whose owner removed xorr's operator: a stop means nothing trades, protective or not.
 *
 * The rules are the executor's, kept off-chain like the caps: Perpl's desk has no exit of its own. What the chain
 * guarantees is the operator's reach — it can trade and never withdraw.
 */
import type { Address } from 'viem';
import { query, one } from '../db/index.js';
import { log } from '../http/request-id.js';
import { perplHere, type DeskPosition, type PerpMarket } from './perpl-chain.js';
import { PerplRefusal, deskState, perplMarkets, placePerpOrder } from './perpl-desk.js';

export type ExitRules = {
  /** Close at this profit, % of the position's margin; null is off. */
  takeProfitPct: number | null;
  /** Close at this loss, % of the margin; null is off. */
  stopLossPct: number | null;
  /** Close when the mark is this close to liquidation, % of the mark; null is off. */
  liqBufferPct: number | null;
  /** Close a losing position paying funding at this yearly rate or more; null is off. */
  maxFundingAprPct: number | null;
};

export const DEFAULT_EXITS: ExitRules = { takeProfitPct: null, stopLossPct: 50, liqBufferPct: 10, maxFundingAprPct: 50 };

export type ExitRule = 'liquidation' | 'stop_loss' | 'take_profit' | 'funding';
export type ExitDecision = { rule: ExitRule; text: string };

/** Funding per hour, % of notional, from Perpl's per-interval fraction. Positive: longs pay shorts. */
export function fundingPctPerHourOf(m: Pick<PerpMarket, 'fundingPerInterval' | 'fundingIntervalSec'> | undefined): number | null {
  if (!m || m.fundingPerInterval === null || !m.fundingIntervalSec) return null;
  return m.fundingPerInterval * 100 * (3600 / m.fundingIntervalSec);
}

/** Unrealised profit at the mark, in dollars, and as a share of the margin. Null without a mark or a margin. */
export function unrealised(p: DeskPosition): { usd: number; pctOfMargin: number } | null {
  if (p.mark === null || !(p.deposit > 0)) return null;
  const usd = (p.mark - p.entry) * p.lots * (p.long ? 1 : -1);
  return { usd, pctOfMargin: (usd / p.deposit) * 100 };
}

const n1 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 });

/**
 * Whether a position should be closed now, and why in words a person reads in Activity. The first rule that applies
 * wins, most urgent first: a liquidation is worse than a stop, a stop is not a take-profit, and funding is slowest.
 */
export function exitFor(p: DeskPosition, fundingPctPerHour: number | null, rules: ExitRules): ExitDecision | null {
  const what = `${p.market} ${p.long ? 'long' : 'short'}`;
  if (rules.liqBufferPct !== null && p.liqDistance !== null && p.liqDistance * 100 <= rules.liqBufferPct) {
    return {
      rule: 'liquidation',
      text: `The ${what} was ${n1(p.liqDistance * 100)}% from liquidation (your buffer: ${n1(rules.liqBufferPct)}%), so it was closed before Perpl liquidated it.`,
    };
  }
  const pnl = unrealised(p);
  if (!pnl) return null;
  if (rules.stopLossPct !== null && pnl.pctOfMargin <= -rules.stopLossPct) {
    return { rule: 'stop_loss', text: `The ${what} was down ${n1(-pnl.pctOfMargin)}% of its $${n1(p.deposit)} margin (your stop: ${n1(rules.stopLossPct)}%).` };
  }
  if (rules.takeProfitPct !== null && pnl.pctOfMargin >= rules.takeProfitPct) {
    return { rule: 'take_profit', text: `The ${what} was up ${n1(pnl.pctOfMargin)}% of its $${n1(p.deposit)} margin (your take-profit: ${n1(rules.takeProfitPct)}%).` };
  }
  if (rules.maxFundingAprPct !== null && fundingPctPerHour !== null && pnl.usd <= 0) {
    const paysPerHour = p.long ? fundingPctPerHour : -fundingPctPerHour;
    const apr = paysPerHour * 24 * 365;
    if (apr >= rules.maxFundingAprPct) {
      return {
        rule: 'funding',
        text: `The ${what} was losing and paying funding at ${n1(apr)}% a year (your limit: ${n1(rules.maxFundingAprPct)}%) — paying to hold a loser.`,
      };
    }
  }
  return null;
}

type ExitRow = { take_profit_pct: string | null; stop_loss_pct: string | null; liq_buffer_pct: string | null; max_funding_apr_pct: string | null };

const num = (v: string | null) => (v === null ? null : Number(v));
export const rulesFrom = (r: ExitRow): ExitRules => ({
  takeProfitPct: num(r.take_profit_pct),
  stopLossPct: num(r.stop_loss_pct),
  liqBufferPct: num(r.liq_buffer_pct),
  maxFundingAprPct: num(r.max_funding_apr_pct),
});

/** The owner's exit rules on this chain, or the defaults before they have a desk. */
export async function exitRules(owner: Address): Promise<ExitRules> {
  const r = await one<ExitRow>(
    `SELECT take_profit_pct, stop_loss_pct, liq_buffer_pct, max_funding_apr_pct FROM perpl_desks
      WHERE lower(owner) = lower($1) AND chain = current_setting('xorr.chain_key')`,
    [owner],
  );
  return r ? rulesFrom(r) : DEFAULT_EXITS;
}

export async function setExitRules(owner: Address, rules: ExitRules): Promise<void> {
  const r = await one<{ owner: string }>(
    `UPDATE perpl_desks SET take_profit_pct = $2, stop_loss_pct = $3, liq_buffer_pct = $4, max_funding_apr_pct = $5
      WHERE lower(owner) = lower($1) AND chain = current_setting('xorr.chain_key') RETURNING owner`,
    [owner, rules.takeProfitPct, rules.stopLossPct, rules.liqBufferPct, rules.maxFundingAprPct],
  );
  if (!r) throw new PerplRefusal('no_desk', 'Open a Perpl desk first.');
}

export type ExitCheck = { perpId: number; market: string; long: boolean; pnlUsd: number | null; pnlPctOfMargin: number | null; liqDistance: number | null; fundingPctPerHour: number | null; exit: ExitDecision | null };

/** What the guard would do to each of the owner's positions right now — nothing is sent. */
export async function checkExits(owner: Address, markets?: PerpMarket[]): Promise<{ rules: ExitRules; operatorActive: boolean; positions: ExitCheck[] }> {
  const [state, rules, ms] = await Promise.all([deskState(owner), exitRules(owner), markets ? Promise.resolve(markets) : perplMarkets()]);
  const positions = state.positions.map((p) => {
    const funding = fundingPctPerHourOf(ms.find((m) => m.id === p.perpId));
    const pnl = unrealised(p);
    return {
      perpId: p.perpId,
      market: p.market,
      long: p.long,
      pnlUsd: pnl?.usd ?? null,
      pnlPctOfMargin: pnl?.pctOfMargin ?? null,
      liqDistance: p.liqDistance,
      fundingPctPerHour: funding,
      exit: exitFor(p, funding, rules),
    };
  });
  return { rules, operatorActive: state.operatorActive, positions };
}

/** A close that failed (no gas, Perpl refused) is tried again after this, not every tick. */
const RETRY_MS = 5 * 60_000;
const lastTry = new Map<string, number>();

/** One pass over every desk on this chain: close what a rule says to close. Returns the closes that filled. */
export async function perplExitSweep(now: Date = new Date()): Promise<number> {
  if (!perplHere()) return 0;
  const desks = await query<ExitRow & { owner: string; wallet_id: string }>(
    `SELECT DISTINCT ON (lower(d.owner)) d.owner, w.id AS wallet_id,
            d.take_profit_pct, d.stop_loss_pct, d.liq_buffer_pct, d.max_funding_apr_pct
       FROM perpl_desks d JOIN wallets w ON lower(w.address) = lower(d.owner)
      WHERE d.chain = current_setting('xorr.chain_key') AND NOT coalesce(w.agents_stopped, false)
      ORDER BY lower(d.owner), w.created_at`,
  );
  if (desks.length === 0) return 0;
  const markets = await perplMarkets();
  let closed = 0;
  for (const d of desks) {
    const owner = d.owner as Address;
    let check: Awaited<ReturnType<typeof checkExits>>;
    try {
      check = await checkExits(owner, markets);
    } catch (e) {
      log.warn(`[perpl-exits] ${owner}: could not read the desk: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
      continue;
    }
    if (!check.operatorActive) continue;
    for (const p of check.positions) {
      if (!p.exit) continue;
      const key = `${owner.toLowerCase()}:${p.perpId}`;
      if ((lastTry.get(key) ?? 0) + RETRY_MS > now.getTime()) continue;
      lastTry.set(key, now.getTime());
      try {
        const r = await placePerpOrder({
          owner,
          walletId: d.wallet_id,
          perpId: p.perpId,
          side: p.long ? 'close_long' : 'close_short',
          placedBy: 'Exit guard',
          reason: p.exit.text,
        });
        console.log(`[perpl-exits] ${owner} ${p.market}: ${p.exit.rule} → ${r.status} ${r.txHash}`);
        if (r.status === 'filled') {
          closed += 1;
          lastTry.delete(key);
        }
      } catch (e) {
        log.warn(`[perpl-exits] ${owner} ${p.market}: ${p.exit.rule} close not placed: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
      }
    }
  }
  return closed;
}
