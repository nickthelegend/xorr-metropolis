/**
 * Leaderboard — PLAN.md 12.23, closing [G33].
 *
 * The handoff shipped four agents with hardcoded pnl30d / win / trades. This computes all three
 * from the REAL trade record: filled runs valued at the current price against what was paid.
 *
 * An agent with no trades gets zeros and says so, rather than borrowing a flattering number.
 */
import { XSTOCKS, xStockKey, xStockPriceUsd } from '../venues/xstocks.js';
import { query } from '../db/index.js';
import { THIS_CHAIN } from '../db/chain-scope.js';
import { priceOf } from '../market/prices.js';
import { stockPriceUsd } from '../venues/stocks.js';
import { personaForKind } from './attribution.js';

export type LeaderboardRow = {
  id: string;
  name: string;
  role: string;
  metric: string;
  pnl30d: number;
  win: number;
  trades: number;
  c1: string;
  c2: string;
};

/** One agent's record over the window, whoever the agent is — one of the four or one a person made. */
export type AgentRecord = Pick<LeaderboardRow, 'pnl30d' | 'win' | 'trades' | 'metric'>;

/** No trades means no record. Saying "no trades yet" is honest; a win rate is not. */
export const NO_TRADES: AgentRecord = { pnl30d: 0, win: 0, trades: 0, metric: 'No trades yet' };

const AGENTS = [
  { id: 'momentum-scout', name: 'Momentum Scout', role: 'Buys the stock with the strongest trend', c1: '#5B93FF', c2: '#1B44CE' },
  { id: 'earnings-desk', name: 'Earnings Desk', role: 'Buys ahead of announced dividends', c1: '#F0BE55', c2: '#C98518' },
  { id: 'yield-keeper', name: 'Yield Keeper', role: 'Moves idle cash into best APY', c1: '#49E39B', c2: '#12A45F' },
  { id: 'drawdown-guard', name: 'Drawdown Guard', role: 'Sells a holding 3% under its cost', c1: '#B58CFF', c2: '#7A45E0' },
];

type RunRow = { kind: string; persona_id: string | null; symbol: string; usd: string; units: string; price: string };

/**
 * Every agent's record on this wallet, by persona id: the four always, and every agent a person made that has traded
 * (`custom:<id>`), credited through the strategies it owns.
 */
export async function agentRecords(walletId: string): Promise<Map<string, AgentRecord>> {
  const runs = await query<RunRow>(
    /*
     * Credited by the rule the trail itself records (PLAN.md 2.2): the agent that owns the strategy
     * when it has one, otherwise the persona that runs its kind (`personaForKind`). It was found by
     * searching the wallet's audit log for each run's id inside JSON — a scan of the trail per run —
     * and a run that search missed was credited to Yield Keeper by default.
     *
     * Buys only (PLAN.md 2.15). A sale's `usd` is what it paid, so valuing it as units at today's mark
     * minus that amount scored every profitable exit as a loss of roughly its own proceeds.
     */
    `SELECT s.kind, ag.persona_id, s.symbol, r.usd, r.units, r.price
     FROM strategy_runs r
     JOIN strategies s ON s.id = r.strategy_id
     LEFT JOIN agents ag ON ag.id = s.agent_id
     WHERE s.wallet_id = $1 AND s.chain = ${THIS_CHAIN}
       AND r.status = 'filled' AND r.side = 'buy' AND r.started_at > now() - interval '30 days'`,
    [walletId],
  );

  /*
   * The autonomous agent's own entries (2026-09-19). They are not strategy runs — each is a position sleeve credited to
   * the persona that took it (`bot/autonomous.ts`) — so a Momentum Scout that had bought MSFTx on the hosted build showed
   * "0 trades" on its own profile. Its open entries, at cost, are its record beside the runs above.
   */
  const entries = await query<{ source_label: string; symbol: string; units: string; cost_usd: string }>(
    `SELECT source_label, symbol, units, cost_usd FROM position_sleeves
      WHERE wallet_id = $1 AND chain = ${THIS_CHAIN} AND source = 'agent' AND cost_usd > 0
        AND opened_at > now() - interval '30 days'`,
    [walletId],
  ).catch(() => []);
  /*
   * Individual agents on EVM chains (2026-09-23): each agent's buys are the council rounds it convened and that executed
   * — signed by its own wallet — with the fill the executor measured.
   */
  const council = await query<{ persona_id: string; symbol: string; units: string; usd: string }>(
    `SELECT substring(convened_by from 7) AS persona_id, proposal->>'symbol' AS symbol, fill->>'units' AS units, fill->>'usd' AS usd
       FROM council_rounds
      WHERE wallet_id = $1 AND chain = ${THIS_CHAIN} AND convened_by LIKE 'agent:%' AND outcome = 'executed'
        AND proposal->>'side' = 'buy' AND fill IS NOT NULL AND created_at > now() - interval '30 days'`,
    [walletId],
  ).catch(() => []);
  for (const r of [...council]) runs.push({ kind: 'agent', persona_id: r.persona_id, symbol: r.symbol, usd: r.usd, units: r.units, price: '0' });
  const personaByName = new Map(AGENTS.map((a) => [a.name, a.id]));
  for (const e of entries) {
    const persona = personaByName.get(e.source_label);
    if (persona) runs.push({ kind: 'agent', persona_id: persona, symbol: e.symbol, usd: e.cost_usd, units: e.units, price: '0' });
  }

  // One price lookup per symbol, not per run — and all of them at once, not one after another.
  const symbols = [...new Set(runs.map((r) => r.symbol))];
  const marks = new Map<string, number>();
  await Promise.all(
    symbols.map(async (s) => {
      try {
        // A screen, so a short deadline: an unpriced symbol is excluded, not waited for.
        // An xStock is priced where it trades, Jupiter; the feed table has none of them.
        const x = XSTOCKS[xStockKey(s) ?? s];
        // A Robinhood Stock Token is priced by the pool it trades in; an xStock by Jupiter; the rest by the feed table.
        const rh = x ? null : await stockPriceUsd(s).catch(() => null);
        const mark = x ? await xStockPriceUsd(x.symbol) : rh !== null && rh > 0 ? rh : await priceOf(s, 3_000);
        if (mark !== null && mark > 0) marks.set(s, mark);
      } catch {
        // No feed for this symbol — its runs are excluded rather than valued at a guess.
      }
    }),
  );

  const byAgent = new Map<string, { pnl: number; wins: number; trades: number }>();
  for (const r of runs) {
    const mark = marks.get(r.symbol);
    if (mark === undefined) continue;
    // A run no persona ran — a recurring buy, a rebalance — is on nobody's record.
    const agent = r.persona_id ?? personaForKind(r.kind);
    if (!agent) continue;
    const value = Number(r.units) * mark;
    const paid = Number(r.usd);
    const pnl = value - paid;
    const acc = byAgent.get(agent) ?? { pnl: 0, wins: 0, trades: 0 };
    acc.pnl += pnl;
    acc.trades += 1;
    if (pnl > 0) acc.wins += 1;
    byAgent.set(agent, acc);
  }

  const records = new Map<string, AgentRecord>(AGENTS.map((a) => [a.id, NO_TRADES]));
  for (const [agent, acc] of byAgent) {
    const win = acc.trades > 0 ? Math.round((acc.wins / acc.trades) * 100) : 0;
    records.set(agent, {
      pnl30d: Number(acc.pnl.toFixed(2)),
      win,
      trades: acc.trades,
      metric: acc.trades === 0 ? NO_TRADES.metric : `${win}% win rate`,
    });
  }
  return records;
}

/** The four personas, each with its record: the leaderboard's rows. */
export async function leaderboard(walletId: string): Promise<LeaderboardRow[]> {
  const records = await agentRecords(walletId);
  return AGENTS.map((a) => ({ ...a, ...(records.get(a.id) ?? NO_TRADES) }));
}
