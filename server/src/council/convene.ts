/**
 * Convene the council on one proposed trade, persist the round, and — when it is approved — execute it and write the
 * transaction hash (or the refusal) back onto the round (PLAN.md P3.3, 2026-09-23).
 *
 * Execution is not done here: the trade path (`setCouncilExecutor`) is the executor's one spend chokepoint, which enforces
 * the permission and the stock guards again on its own. The council decides whether to ask; the contract decides whether
 * it happens. Until a trade path is registered, an approved round is recorded as `not_executed` with that reason.
 */
import type { Address } from 'viem';
import { query, one } from '../db/index.js';
import { THIS_CHAIN } from '../db/chain-scope.js';
import { IS_MONAD, explorerTx } from '../evm/chains.js';
import { readCouncilInputs, type CouncilInputs, type Proposal } from './inputs.js';
import { readMonadCouncilInputs, type MonadCouncilInputs } from './monad-inputs.js';
import { strategistBallot } from './strategist.js';
import { castBallots, tally, type Ballot, type Decision } from './personas.js';

/** What a fill bought or sold: token units, the price per token, and the dollars. */
export type Fill = { units: number; price: number; usd: number };
export type ExecutionResult =
  | { status: 'executed'; txHash: `0x${string}`; detail: string; fill?: Fill }
  | { status: 'refused' | 'failed'; detail: string; txHash?: `0x${string}` };

/** `agentId` is the agent that proposed the round (from `convenedBy: agent:<id>`): its own key signs the trade. */
export type CouncilExecutor = (p: { walletId: string; owner: Address; proposal: Proposal; roundId: string; agentId?: string }) => Promise<ExecutionResult>;

let executor: CouncilExecutor | undefined;
/** The executor's trade path registers itself here at startup. */
export function setCouncilExecutor(e: CouncilExecutor | undefined): void {
  executor = e;
}

export type CouncilRound = {
  id: string;
  walletId: string;
  owner: string;
  proposal: Proposal;
  inputs: CouncilInputs | MonadCouncilInputs;
  decision: Decision;
  summary: string;
  outcome: 'pending' | 'executed' | 'refused' | 'failed' | 'not_executed';
  txHash: string | null;
  /** Where the transaction can be seen: an explorer URL, or `fork:<hash>` on a fork no public explorer has. */
  txLink: string | null;
  outcomeDetail: string | null;
  convenedBy: string;
  chain: string;
  createdAt: string;
  settledAt: string | null;
  votes: Ballot[];
};

type RoundRow = {
  id: string;
  wallet_id: string;
  owner: string;
  proposal: Proposal;
  inputs: (CouncilInputs | MonadCouncilInputs) & { summary?: string };
  decision: Decision;
  outcome: CouncilRound['outcome'];
  tx_hash: string | null;
  outcome_detail: string | null;
  convened_by: string;
  chain: string;
  created_at: Date;
  settled_at: Date | null;
};
type VoteRow = { round_id: string; persona: Ballot['persona']; vote: Ballot['vote']; confidence: string; reason: string; cites: string[] };

function toRound(r: RoundRow, votes: VoteRow[]): CouncilRound {
  const { summary, ...inputs } = r.inputs;
  return {
    id: String(r.id),
    walletId: r.wallet_id,
    owner: r.owner,
    proposal: r.proposal,
    inputs: inputs as CouncilInputs | MonadCouncilInputs,
    decision: r.decision,
    summary: summary ?? '',
    outcome: r.outcome,
    txHash: r.tx_hash,
    txLink: r.tx_hash ? explorerTx(r.tx_hash) : null,
    outcomeDetail: r.outcome_detail,
    convenedBy: r.convened_by,
    chain: r.chain,
    createdAt: r.created_at.toISOString(),
    settledAt: r.settled_at?.toISOString() ?? null,
    votes: votes.map((v) => ({ persona: v.persona, vote: v.vote, confidence: Number(v.confidence), reason: v.reason, cites: v.cites })),
  };
}

export async function convene(p: {
  walletId: string;
  owner: Address;
  proposal: Proposal;
  convenedBy: string;
  /** Read inputs and vote, record the round, but do not ask the executor. */
  dryRun?: boolean;
}): Promise<CouncilRound> {
  if (!(p.proposal.usd > 0)) throw new Error('A proposal needs a positive dollar size.');
  const agentId = p.convenedBy.startsWith('agent:') ? p.convenedBy.slice('agent:'.length) : undefined;
  // An agent's round is judged against that agent's OWN permission; the owner's is the desk's.
  // Monad reads its own inputs (Chainlink on Monad, the fill's venue, Kuru, Perpl); the seats and the tally are shared.
  const inputs = IS_MONAD ? await readMonadCouncilInputs(p.owner, p.proposal, agentId) : await readCouncilInputs(p.owner, p.proposal, agentId);
  const ballots = castBallots(inputs);
  // On Monad, the fifth seat: Kimi weighs the four desks and decides a split (`strategist.ts`). It never vetoes, and without
  // a Moonshot key it does not sit at all.
  if (IS_MONAD) {
    const kimi = await strategistBallot({ proposal: inputs.proposal, inputs, ballots: [...ballots] });
    if (kimi) ballots.push(kimi);
  }
  const t = tally(ballots);
  const row = await one<RoundRow>(
    `INSERT INTO council_rounds (wallet_id, owner, proposal, inputs, decision, outcome, convened_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      p.walletId,
      p.owner.toLowerCase(),
      JSON.stringify(inputs.proposal),
      JSON.stringify({ ...inputs, summary: t.summary }),
      t.decision,
      t.decision === 'approved' ? 'pending' : 'not_executed',
      p.convenedBy,
    ],
  );
  if (!row) throw new Error('The round was not recorded.');
  for (const b of ballots) {
    await query(`INSERT INTO council_votes (round_id, persona, vote, confidence, reason, cites) VALUES ($1, $2, $3, $4, $5, $6)`, [
      row.id,
      b.persona,
      b.vote,
      b.confidence,
      b.reason,
      b.cites,
    ]);
  }
  if (t.decision === 'approved') {
    if (p.dryRun) {
      await settle(row.id, { outcome: 'not_executed', detail: 'Convened as a dry run: approved, not sent.' });
    } else if (!executor) {
      await settle(row.id, { outcome: 'not_executed', detail: 'No trade path is registered on this executor.' });
    } else {
      let result: ExecutionResult;
      try {
        result = await executor({ walletId: p.walletId, owner: p.owner, proposal: inputs.proposal, roundId: String(row.id), agentId });
      } catch (e) {
        result = { status: 'failed', detail: e instanceof Error ? e.message : String(e) };
      }
      await settle(row.id, { outcome: result.status, detail: result.detail, txHash: result.txHash, fill: result.status === 'executed' ? result.fill : undefined });
    }
  }
  const round = await roundById(String(row.id), p.walletId);
  if (!round) throw new Error('The round vanished after it was written.');
  return round;
}

async function settle(id: string, s: { outcome: CouncilRound['outcome']; detail: string; txHash?: string; fill?: Fill }) {
  await query(`UPDATE council_rounds SET outcome = $2, outcome_detail = $3, tx_hash = $4, fill = $5, settled_at = now() WHERE id = $1`, [
    id,
    s.outcome,
    s.detail.slice(0, 2000),
    s.txHash ?? null,
    s.fill ? JSON.stringify(s.fill) : null,
  ]);
}

export async function roundById(id: string, walletId: string): Promise<CouncilRound | undefined> {
  if (!/^\d+$/.test(id)) return undefined;
  const r = await one<RoundRow>(`SELECT * FROM council_rounds WHERE id = $1 AND wallet_id = $2 AND chain = ${THIS_CHAIN}`, [id, walletId]);
  if (!r) return undefined;
  const votes = await query<VoteRow>(`SELECT * FROM council_votes WHERE round_id = $1 ORDER BY persona`, [id]);
  return toRound(r, votes);
}

export async function roundsFor(walletId: string, limit = 50): Promise<CouncilRound[]> {
  const rows = await query<RoundRow>(`SELECT * FROM council_rounds WHERE wallet_id = $1 AND chain = ${THIS_CHAIN} ORDER BY created_at DESC LIMIT $2`, [
    walletId,
    Math.min(200, Math.max(1, limit)),
  ]);
  if (rows.length === 0) return [];
  const votes = await query<VoteRow>(`SELECT * FROM council_votes WHERE round_id = ANY($1::bigint[])`, [rows.map((r) => r.id)]);
  return rows.map((r) => toRound(r, votes.filter((v) => String(v.round_id) === String(r.id))));
}
