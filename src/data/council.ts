/**
 * The council's rounds, as the executor records them (`server/src/council/`, PLAN.md P3.4).
 *
 * Every field is the executor's: the proposal, each seat's vote and reason, the decision, and the transaction hash the
 * round produced (or why it produced none). Nothing here is computed on the phone.
 */
import { api } from './api';

export type CouncilVote = 'yes' | 'no' | 'veto' | 'abstain';
export type CouncilSeatId = 'session-desk' | 'risk-keeper' | 'trend-reader' | 'macro-desk';

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
  votes: CouncilBallot[];
};

export type CouncilSeat = { id: CouncilSeatId; name: string; role: string };

export const council = {
  seats: () => api.get<{ seats: CouncilSeat[] }>('/council/seats').then((r) => r.seats),
  rounds: () => api.get<{ rounds: CouncilRound[] }>('/council/rounds').then((r) => r.rounds),
  convene: (p: { side: 'buy' | 'sell'; symbol: string; usd: number }) =>
    api.post<{ round: CouncilRound }>('/council/convene', p).then((r) => r.round),
};
