/**
 * The council's rounds, as the executor records them (`server/src/council/`, PLAN.md P3.4).
 *
 * Every field is the executor's: the proposal, each seat's vote and reason, the decision, and the transaction hash the
 * round produced (or why it produced none). Nothing here is computed on the phone.
 */
import { api } from './api';

export type CouncilVote = 'yes' | 'no' | 'veto' | 'abstain';
export type CouncilSeatId = 'session-desk' | 'risk-keeper' | 'trend-reader' | 'macro-desk' | 'strategist';

export type CouncilBallot = { persona: CouncilSeatId; vote: CouncilVote; confidence: number; reason: string; cites: string[] };

export type CouncilRound = {
  id: string;
  proposal: { side: 'buy' | 'sell'; symbol: string; usd: number };
  decision: 'approved' | 'rejected' | 'vetoed';
  summary: string;
  outcome: 'pending' | 'executed' | 'refused' | 'failed' | 'not_executed';
  txHash: string | null;
  txLink: string | null;
  outcomeDetail: string | null;
  convenedBy: string;
  chain: string;
  createdAt: string;
  /** When the round was settled — sent and confirmed, or decided not to send. Absent while pending. */
  settledAt?: string | null;
  votes: CouncilBallot[];
  /** What the seats read when the round convened, keyed by what a ballot cites (`price`, `permission`, …). */
  inputs?: Record<string, unknown> & { readAt?: string };
};

/** Seconds from the council convening to its trade confirmed, for an executed round; null otherwise. */
export function voteToFillSec(r: Pick<CouncilRound, 'outcome' | 'createdAt' | 'settledAt'>): number | null {
  if (r.outcome !== 'executed' || !r.settledAt) return null;
  const s = (Date.parse(r.settledAt) - Date.parse(r.createdAt)) / 1000;
  return Number.isFinite(s) && s >= 0 ? s : null;
}

export type CouncilSeat = { id: CouncilSeatId; name: string; role: string };

export const council = {
  seats: () => api.get<{ seats: CouncilSeat[] }>('/council/seats').then((r) => r.seats),
  /** Whether Kimi sits as the Strategist on this executor, and the key it needs when not. Null off Monad. */
  strategist: () =>
    api.get<{ strategist: { configured: boolean; needs: string | null } | null }>('/council/seats').then((r) => r.strategist),
  rounds: () => api.get<{ rounds: CouncilRound[] }>('/council/rounds').then((r) => r.rounds),
  /** One of this wallet's rounds, with the inputs its votes rest on (the replay, ROADMAP-WIN F3). */
  round: (id: string) => api.get<{ round: CouncilRound }>(`/council/rounds/${encodeURIComponent(id)}`).then((r) => r.round),
  convene: (p: { side: 'buy' | 'sell'; symbol: string; usd: number }) =>
    api.post<{ round: CouncilRound }>('/council/convene', p).then((r) => r.round),
};
