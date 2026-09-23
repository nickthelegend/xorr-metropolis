/**
 * The agents, on EVM chains: each hired agent is its own wallet and proposes its own trades (2026-09-23).
 *
 * Every scheduler tick, for every wallet whose kill switch is off, each hired agent with a live permission of its own on
 * `XorrDelegation` (`grantAgent` — its own cap and end date, read from the chain) gets one turn:
 *
 *   - pacing, per agent (each is individual): one round per `COOLDOWN_MINUTES`; it enters a stock at most once a UTC day;
 *   - the size: a tenth of THAT agent's daily cap, never more than it has left today, never under $5;
 *   - the proposal, from the agent's own strategy, on real data only:
 *       Momentum Scout  the stock whose own Chainlink rounds rose the most (≥ 0.25%);
 *       Earnings Desk   a stock with an announced cash dividend not yet processed (Robinhood's corporate actions);
 *       Yield Keeper    one steady buy a day of the index (SPY);
 *       Drawdown Guard  a sale of a holding marked ≥ 3% below its cost at the Chainlink price;
 *     (an agent someone made follows the style it was made in); no qualifying setup is a turn with no proposal, logged;
 *   - then `convene`: the four seats vote on live inputs and an approved round executes — signed by THAT agent's own key
 *     (`evm/agents.ts`), charged to its own tally, named in the `Spent` event.
 */
import type { Address } from 'viem';
import { query, one } from '../db/index.js';
import { THIS_CHAIN } from '../db/chain-scope.js';
import { log } from '../http/request-id.js';
import { readPolicy } from '../evm/delegation.js';
import { agentAddress } from '../evm/agents.js';
import { robinhoodStocks } from '../venues/rh-stocks.js';
import { fetchCorporateActions } from '../robinhood/api.js';
import { chainlinkPrice } from '../robinhood/chain.js';
import { convene } from './convene.js';
import { trendOf, type Proposal } from './inputs.js';

export const COOLDOWN_MINUTES = 60;
export const SHARE_OF_DAILY_CAP = 0.1;
export const MIN_TRADE_USD = 5;
/** A trend weaker than this (percent over the feed's recent rounds) proposes nothing. */
export const MIN_TREND_PCT = 0.25;
/** Drawdown Guard sells a holding this far below its cost. */
export const DRAWDOWN_PCT = 3;
export const INDEX_SYMBOL = 'SPY';

export type Candidate = { symbol: string; changePct: number };
export type Style = 'momentum-scout' | 'earnings-desk' | 'yield-keeper' | 'drawdown-guard';

/** The strongest rising stock not already entered today, or why there is none. Pure, for tests. */
export function pickCandidate(trends: Candidate[], enteredToday: Set<string>): Candidate | { none: string } {
  const rising = trends.filter((t) => t.changePct >= MIN_TREND_PCT && !enteredToday.has(t.symbol)).sort((a, b) => b.changePct - a.changePct);
  if (rising[0]) return rising[0];
  return { none: trends.length === 0 ? 'no Stock Token trend could be read' : `nothing rising ≥ ${MIN_TREND_PCT}% that was not already entered today` };
}

/** A tenth of the agent's cap, bounded by what it has left today; null when that is under the minimum. */
export function sizeFor(dailyCapUsd: number, remainingTodayUsd: number): number | null {
  const usd = Math.floor(Math.min(dailyCapUsd * SHARE_OF_DAILY_CAP, remainingTodayUsd) * 100) / 100;
  return usd >= MIN_TRADE_USD ? usd : null;
}

/** Drawdown: the holding furthest below cost, if any is ≥ DRAWDOWN_PCT under. Pure, for tests. */
export function pickDrawdown(held: { symbol: string; units: number; costUsd: number; price: number }[]): { symbol: string; valueUsd: number; downPct: number } | { none: string } {
  const marks = held
    .filter((h) => h.units > 0 && h.costUsd > 0)
    .map((h) => ({ symbol: h.symbol, valueUsd: h.units * h.price, downPct: ((h.costUsd - h.units * h.price) / h.costUsd) * 100 }))
    .filter((m) => m.downPct >= DRAWDOWN_PCT)
    .sort((a, b) => b.downPct - a.downPct);
  return marks[0] ?? { none: `no holding is ${DRAWDOWN_PCT}% or more below its cost` };
}

type Tradable = { symbol: string };

/** What one agent proposes this turn, from its own style, or why nothing. */
async function proposalFor(p: {
  style: Style;
  walletId: string;
  usd: number;
  stocks: Tradable[];
  trends: Candidate[];
  enteredToday: Set<string>;
}): Promise<Proposal | { none: string }> {
  const tradable = new Set(p.stocks.map((s) => s.symbol));
  switch (p.style) {
    case 'momentum-scout': {
      const pick = pickCandidate(p.trends, p.enteredToday);
      return 'none' in pick ? pick : { side: 'buy', symbol: pick.symbol, usd: p.usd };
    }
    case 'earnings-desk': {
      const actions = await fetchCorporateActions();
      const upcoming = actions
        .filter((a) => a.type.includes('CASH_DIVIDEND') && a.status !== 'CORPORATE_ACTION_STATUS_COMPLETED')
        .map((a) => a.tokenSymbol.toUpperCase())
        .filter((s) => tradable.has(s) && !p.enteredToday.has(s));
      return upcoming[0] ? { side: 'buy', symbol: upcoming[0], usd: p.usd } : { none: 'no tradable stock has an announced cash dividend still to process' };
    }
    case 'yield-keeper':
      if (!tradable.has(INDEX_SYMBOL)) return { none: `${INDEX_SYMBOL} does not trade here` };
      if (p.enteredToday.has(INDEX_SYMBOL)) return { none: `already bought ${INDEX_SYMBOL} today` };
      return { side: 'buy', symbol: INDEX_SYMBOL, usd: p.usd };
    case 'drawdown-guard': {
      const rows = await query<{ symbol: string; units: string; cost_usd: string }>(
        `SELECT symbol, units, cost_usd FROM positions WHERE wallet_id = $1 AND side = 'long' AND units > 0 AND chain = ${THIS_CHAIN}`,
        [p.walletId],
      ).catch(() => query<{ symbol: string; units: string; cost_usd: string }>(`SELECT symbol, units, cost_usd FROM positions WHERE wallet_id = $1 AND side = 'long' AND units > 0`, [p.walletId]));
      const held = (
        await Promise.all(
          rows.filter((r) => tradable.has(r.symbol)).map(async (r) => {
            const cl = await chainlinkPrice(r.symbol).catch(() => null);
            return cl ? { symbol: r.symbol, units: Number(r.units), costUsd: Number(r.cost_usd), price: cl.price } : null;
          }),
        )
      ).filter((h): h is NonNullable<typeof h> => h !== null);
      const pick = pickDrawdown(held);
      return 'none' in pick ? pick : { side: 'sell', symbol: pick.symbol, usd: Math.floor(pick.valueUsd * 100) / 100 };
    }
  }
}

export async function councilSweep(now: Date = new Date()): Promise<number> {
  const agents = await query<{ wallet_id: string; address: string; persona_id: string; style: string | null }>(
    `SELECT w.id AS wallet_id, w.address, a.persona_id, a.style
       FROM wallets w JOIN agents a ON a.wallet_id = w.id AND a.hired AND a.fired_at IS NULL
      WHERE (w.agents_stopped IS NULL OR w.agents_stopped = false)
      ORDER BY w.created_at DESC, a.persona_id LIMIT 40`,
  ).catch((e: unknown) => {
    log.error('[council] could not read the hired agents to sweep:', e);
    return [];
  });
  if (agents.length === 0) return 0;

  const stocks = await robinhoodStocks().catch(() => []);
  const trends = (
    await Promise.all(stocks.map((s) => trendOf(s.symbol).then((t) => ({ symbol: s.symbol, changePct: t.changePct })).catch(() => null)))
  ).filter((t): t is Candidate => t !== null);

  let executed = 0;
  for (const a of agents) {
    const tag = `agent:${a.persona_id}`;
    try {
      const recent = await one<{ id: string }>(
        `SELECT id FROM council_rounds WHERE wallet_id = $1 AND chain = ${THIS_CHAIN} AND convened_by = $2
            AND created_at > now() - ($3 || ' minutes')::interval LIMIT 1`,
        [a.wallet_id, tag, String(COOLDOWN_MINUTES)],
      );
      if (recent) continue;
      // The agent's OWN permission: no grant to this agent's wallet, no turn.
      const policy = await readPolicy(a.address as Address, agentAddress(a.persona_id)).catch(() => null);
      if (!policy || policy.revoked || policy.expiresAt <= now.getTime()) continue;
      const usd = sizeFor(policy.dailyCapUsd, policy.remainingTodayUsd);
      const style = (a.style ?? a.persona_id) as Style;
      if (usd === null && style !== 'drawdown-guard') continue;
      const entered = await query<{ symbol: string }>(
        `SELECT proposal->>'symbol' AS symbol FROM council_rounds
          WHERE wallet_id = $1 AND chain = ${THIS_CHAIN} AND convened_by = $2 AND outcome = 'executed' AND proposal->>'side' = 'buy'
            AND created_at >= date_trunc('day', now() AT TIME ZONE 'utc')`,
        [a.wallet_id, tag],
      );
      const proposal = await proposalFor({ style, walletId: a.wallet_id, usd: usd ?? 0, stocks, trends, enteredToday: new Set(entered.map((r) => r.symbol)) });
      if ('none' in proposal) {
        log.info(`[council] ${a.wallet_id} ${a.persona_id}: no proposal — ${proposal.none}`);
        continue;
      }
      const round = await convene({ walletId: a.wallet_id, owner: a.address as Address, proposal, convenedBy: tag });
      log.info(`[council] ${a.wallet_id} ${a.persona_id}: ${proposal.side} ${proposal.symbol} $${proposal.usd} → ${round.decision}${round.txHash ? ` ${round.txHash}` : ''}`);
      if (round.outcome === 'executed') executed += 1;
    } catch (e) {
      log.error(`[council] sweep error for ${a.wallet_id} ${a.persona_id}:`, e);
    }
  }
  return executed;
}
