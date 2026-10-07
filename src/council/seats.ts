/**
 * The council's seats as a person sees them: each one's name, its short name on the bench, its face's colours, and the
 * colours of a vote and a verdict. Shared by the council screen and the replay, so a seat looks the same in both.
 */
import { colors, type Gradient, type TagTone } from '@/ui';
import { onMonad } from '@/chain';
import type { CouncilBallot, CouncilRound } from '@/data/council';

type Seat = CouncilBallot['persona'];

export const SEAT_NAMES: Record<Seat, string> = onMonad
  ? { 'session-desk': 'Price Desk', 'risk-keeper': 'Risk Keeper', 'trend-reader': 'Trend Reader', 'macro-desk': 'Perps Desk', strategist: 'Strategist (Kimi)' }
  : { 'session-desk': 'Session Desk', 'risk-keeper': 'Risk Keeper', 'trend-reader': 'Trend Reader', 'macro-desk': 'Macro Desk', strategist: 'Strategist' };

export const SEAT_SHORT: Record<Seat, string> = onMonad
  ? { 'session-desk': 'Price', 'risk-keeper': 'Risk', 'trend-reader': 'Trend', 'macro-desk': 'Perps', strategist: 'Kimi' }
  : { 'session-desk': 'Session', 'risk-keeper': 'Risk', 'trend-reader': 'Trend', 'macro-desk': 'Macro', strategist: 'Strategist' };

/**
 * Each seat's face (2026-10-06). The council was four names in a list; it is four characters now, each in one of the
 * agent identity gradients, the same on the bench at the top and beside every vote it casts.
 */
export const SEAT_GRADIENT: Record<Seat, Gradient> = {
  'session-desk': colors.agent.momentum,
  'risk-keeper': colors.agent.drawdown,
  'trend-reader': colors.agent.earnings,
  'macro-desk': colors.agent.yield,
  strategist: colors.agent.strategist,
};

export function voteTone(v: CouncilBallot['vote']): TagTone {
  if (v === 'yes') return 'up';
  if (v === 'veto') return 'solidDown';
  if (v === 'no') return 'down';
  return 'neutral';
}

export function voteColor(v: CouncilBallot['vote']): string {
  return v === 'yes' ? colors.up : v === 'no' || v === 'veto' ? colors.down : colors.ink28;
}

export function decisionTone(d: CouncilRound['decision']): string {
  return d === 'approved' ? colors.up : d === 'vetoed' ? colors.down : colors.ink55;
}

export function decisionBg(d: CouncilRound['decision']): string {
  return d === 'approved' ? colors.upBg : d === 'vetoed' ? colors.downBg : colors.neutralBg;
}

/** What became of a round, in a few words. */
export function outcomeLine(r: CouncilRound): string {
  if (r.outcome === 'executed') return 'Executed';
  if (r.outcome === 'pending') return 'Sending';
  if (r.outcome === 'refused') return `Refused: ${r.outcomeDetail ?? ''}`;
  if (r.outcome === 'failed') return `Failed: ${r.outcomeDetail ?? ''}`;
  return r.decision === 'approved' ? (r.outcomeDetail ?? 'Not sent') : 'Not sent';
}
