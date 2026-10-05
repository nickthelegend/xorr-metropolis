/**
 * The council's four seats, and how a round is decided (PLAN.md P3.2–P3.3, 2026-09-23).
 *
 * Each seat is a pure function of the round's inputs: the same inputs always cast the same vote, and every reason names
 * the numbers it rests on, so anyone reading the dashboard can check a vote against what it saw. No seat invents an
 * input: one it cannot read makes it abstain and say which.
 *
 *   session-desk  Robinhood's session and halt state, the feed's freshness and the pool-vs-Chainlink deviation. Its "no"
 *                 is a VETO: a stock that cannot be traded right now, or whose price sources disagree, is not traded.
 *   risk-keeper   The owner's own permission and exposure. Also a veto: no grant, a revoked or expired one, a trade
 *                 larger than what is left today, or a position that would pass a quarter of the grant.
 *   trend-reader  The stock's direction: its last Chainlink rounds, and where the ask sits in today's range.
 *   macro-desk    Crypto's risk appetite on GMX V2: who pays funding on ETH and BTC, and how one-sided open interest is.
 *
 * On Monad (`monad-inputs.ts`) the same seats read Monad's own inputs: the session desk becomes the price desk (Chainlink
 * against the fill's venue and Kuru's book; crypto has no session), and the macro desk reads Perpl's funding. The risk
 * keeper and the trend reader are unchanged.
 *
 * A round is approved when nobody vetoes and at least two seats vote yes with more yes than no.
 */
import type { CouncilInputs } from './inputs.js';
import type { MonadCouncilInputs } from './monad-inputs.js';

export type SeatId = 'session-desk' | 'risk-keeper' | 'trend-reader' | 'macro-desk';
export type Vote = 'yes' | 'no' | 'veto' | 'abstain';
export type Ballot = { persona: SeatId; vote: Vote; confidence: number; reason: string; cites: string[] };
export type Decision = 'approved' | 'rejected' | 'vetoed';

export const SEATS: readonly { id: SeatId; name: string; role: string }[] = [
  { id: 'session-desk', name: 'Session Desk', role: 'Is the market open, the stock not halted, and do the prices agree?' },
  { id: 'risk-keeper', name: 'Risk Keeper', role: 'Does it fit the permission and the position limit?' },
  { id: 'trend-reader', name: 'Trend Reader', role: 'Which way is the stock moving?' },
  { id: 'macro-desk', name: 'Macro Desk', role: 'Is the wider market crowded, per GMX funding and open interest?' },
];

/** The seats as they sit on Monad: the same ids (stored with every vote), asking Monad's questions. */
export const MONAD_SEATS: readonly { id: SeatId; name: string; role: string }[] = [
  { id: 'session-desk', name: 'Price Desk', role: 'Is Chainlink fresh, and does the fill price agree with it?' },
  { id: 'risk-keeper', name: 'Risk Keeper', role: 'Does it fit the permission and the position limit?' },
  { id: 'trend-reader', name: 'Trend Reader', role: 'Which way is Chainlink moving?' },
  { id: 'macro-desk', name: 'Perps Desk', role: 'Are Perpl longs crowded, per who pays funding on BTC, ETH and MON?' },
];

/** The share of the whole grant one symbol may reach (the pacing rule the Solana build enforced: 25%). */
export const POSITION_SHARE_OF_GRANT = 0.25;
/** Funding above this, paid by longs, with open interest this one-sided, reads as a crowded long market. */
export const CROWDED_FUNDING_PCT_PER_HOUR = 0.005;
export const CROWDED_LONG_SHARE_PCT = 65;

const usd = (n: number) => `$${n.toFixed(2)}`;
/** A unit price: cents where that is enough, four significant digits under a dollar (MON is $0.024). */
const px = (n: number) => (n >= 1 ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${n.toPrecision(4)}`);
const pct = (n: number, d = 2) => `${n >= 0 ? '+' : ''}${n.toFixed(d)}%`;

export function sessionDesk(i: CouncilInputs): Ballot {
  const base = { persona: 'session-desk' as const };
  if (!i.guard.ok) {
    return { ...base, vote: 'veto', confidence: 1, reason: `The trade check could not run: ${i.guard.error}. Nothing is traded blind.`, cites: ['guard'] };
  }
  const r = i.guard.result;
  const d = r.detail;
  if (!r.ok) {
    return { ...base, vote: 'veto', confidence: 1, reason: `Refused — ${r.reason}: ${d.message}`, cites: ['guard'] };
  }
  const parts = [
    d.session ? `${d.session} session` : undefined,
    d.chainlink ? `Chainlink ${usd(d.chainlink.price)} (${Math.round(d.chainlink.ageSec / 60)} min old)` : undefined,
    d.quote ? `pool ${usd(d.quote.impliedPrice)}` : undefined,
    d.deviationBps !== undefined ? `${d.deviationBps.toFixed(1)} bps apart (limit ${d.maxDeviationBps ?? 150})` : undefined,
  ].filter(Boolean);
  const room = d.maxDeviationBps && d.deviationBps !== undefined ? 1 - d.deviationBps / d.maxDeviationBps : 0.5;
  return { ...base, vote: 'yes', confidence: Math.max(0.5, Math.min(0.95, 0.5 + room / 2)), reason: `Tradable now: ${parts.join(', ')}.`, cites: ['guard'] };
}

export function riskKeeper(i: Pick<CouncilInputs, 'proposal' | 'permission' | 'holding' | 'readAt'>): Ballot {
  const base = { persona: 'risk-keeper' as const };
  const { proposal } = i;
  if (!i.permission.ok) {
    return { ...base, vote: 'veto', confidence: 1, reason: `No readable permission: ${i.permission.error}.`, cites: ['permission'] };
  }
  const p = i.permission;
  if (p.revoked) return { ...base, vote: 'veto', confidence: 1, reason: 'The owner revoked the permission.', cites: ['permission'] };
  if (p.expiresAt * 1000 <= Date.parse(i.readAt)) {
    return { ...base, vote: 'veto', confidence: 1, reason: `The permission expired ${new Date(p.expiresAt * 1000).toISOString()}.`, cites: ['permission'] };
  }
  if (proposal.side === 'buy' && proposal.usd > p.remainingTodayUsd) {
    return {
      ...base,
      vote: 'veto',
      confidence: 1,
      reason: `${usd(proposal.usd)} is more than the ${usd(p.remainingTodayUsd)} left of today's ${usd(p.dailyCapUsd)} cap; the contract would refuse it.`,
      cites: ['permission'],
    };
  }
  if (proposal.side === 'sell') {
    if (!i.holding.ok) return { ...base, vote: 'abstain', confidence: 0, reason: `Holdings unreadable: ${i.holding.error}.`, cites: ['holding'] };
    if (i.holding.valueUsd + 0.01 < proposal.usd) {
      return { ...base, vote: 'veto', confidence: 1, reason: `Selling ${usd(proposal.usd)} of a ${usd(i.holding.valueUsd)} position.`, cites: ['holding'] };
    }
    return { ...base, vote: 'yes', confidence: 0.8, reason: `A sale reduces exposure (${usd(i.holding.valueUsd)} held).`, cites: ['holding'] };
  }
  if (!i.holding.ok) {
    return { ...base, vote: 'abstain', confidence: 0, reason: `Within today's cap (${usd(p.remainingTodayUsd)} left), but holdings are unreadable: ${i.holding.error}.`, cites: ['permission', 'holding'] };
  }
  const after = i.holding.valueUsd + proposal.usd;
  const limit = p.grantUsd * POSITION_SHARE_OF_GRANT;
  if (after > limit) {
    return {
      ...base,
      vote: 'veto',
      confidence: 1,
      reason: `${proposal.symbol} would be ${usd(after)}, over the ${usd(limit)} limit (25% of the ${usd(p.grantUsd)} grant).`,
      cites: ['permission', 'holding'],
    };
  }
  return {
    ...base,
    vote: 'yes',
    confidence: Math.max(0.5, 1 - after / limit),
    reason: `Fits: ${usd(proposal.usd)} of ${usd(p.remainingTodayUsd)} left today; ${proposal.symbol} goes to ${usd(after)} of a ${usd(limit)} limit.`,
    cites: ['permission', 'holding'],
  };
}

export function trendReader(i: Pick<CouncilInputs, 'proposal' | 'trend'> & { day?: CouncilInputs['day'] }): Ballot {
  const base = { persona: 'trend-reader' as const };
  const buy = i.proposal.side === 'buy';
  if (!i.trend.ok && !i.day?.ok) {
    const why = [i.trend.ok ? undefined : i.trend.error, i.day && !i.day.ok ? i.day.error : undefined].filter(Boolean).join('; ');
    return { ...base, vote: 'abstain', confidence: 0, reason: `No price history: ${why}.`, cites: i.day ? ['trend', 'day'] : ['trend'] };
  }
  const notes: string[] = [];
  let score = 0;
  if (i.trend.ok && i.trend.rounds.length >= 2) {
    const c = i.trend.changePct;
    notes.push(`Chainlink ${pct(c)} over ${i.trend.rounds.length} rounds (${i.trend.spanHours.toFixed(0)} h)`);
    score += c > 0.5 ? 1 : c < -2 ? -1 : 0;
  } else if (i.trend.ok) {
    notes.push('one Chainlink round only');
  }
  if (i.day?.ok) {
    const at = i.day.positionInRange;
    notes.push(`ask ${usd(i.day.ask)} at ${(at * 100).toFixed(0)}% of today's ${usd(i.day.low)}–${usd(i.day.high)} range`);
    score += at > 0.9 ? -1 : at < 0.5 ? 0.5 : 0;
  }
  const s = buy ? score : -score;
  const vote: Vote = s > 0 ? 'yes' : s < 0 ? 'no' : 'abstain';
  const lead = vote === 'yes' ? (buy ? 'Leaning up' : 'Leaning down') : vote === 'no' ? (buy ? 'Stretched or falling' : 'Still rising') : 'No clear direction';
  return { ...base, vote, confidence: Math.min(0.9, 0.4 + Math.abs(s) * 0.25), reason: `${lead}: ${notes.join('; ')}.`, cites: i.day ? ['trend', 'day'] : ['trend'] };
}

export function macroDesk(i: CouncilInputs): Ballot {
  const base = { persona: 'macro-desk' as const };
  if (!i.gmx.ok) return { ...base, vote: 'abstain', confidence: 0, reason: `GMX unreadable: ${i.gmx.error}.`, cites: ['gmx'] };
  const { eth, btc } = i.gmx;
  const crowded = (m: typeof eth) => m.fundingLongPctPerHour > CROWDED_FUNDING_PCT_PER_HOUR && m.longSharePct > CROWDED_LONG_SHARE_PCT;
  const describe = (name: string, m: typeof eth) =>
    `${name} longs ${m.fundingLongPctPerHour >= 0 ? 'pay' : 'earn'} ${Math.abs(m.fundingLongPctPerHour).toFixed(4)}%/h, ${m.longSharePct.toFixed(0)}% of $${(m.openInterestUsd / 1e6).toFixed(1)}M OI long`;
  const text = `${describe('ETH', eth)}; ${describe('BTC', btc)}`;
  const crowdedCount = [eth, btc].filter(crowded).length;
  if (i.proposal.side === 'sell') {
    return { ...base, vote: crowdedCount > 0 ? 'yes' : 'abstain', confidence: crowdedCount > 0 ? 0.6 : 0, reason: `${crowdedCount > 0 ? 'Crowded longs favour taking risk off' : 'Nothing crowded either way'}: ${text}.`, cites: ['gmx'] };
  }
  if (crowdedCount === 2) return { ...base, vote: 'no', confidence: 0.7, reason: `Crowded long on both majors: ${text}.`, cites: ['gmx'] };
  if (crowdedCount === 1) return { ...base, vote: 'abstain', confidence: 0.3, reason: `One major crowded long: ${text}.`, cites: ['gmx'] };
  return { ...base, vote: 'yes', confidence: 0.6, reason: `Risk appetite not stretched: ${text}.`, cites: ['gmx'] };
}

/** Monad's price desk, in the session desk's seat. Its "no" is a veto: a stale feed, or a fill far from Chainlink. */
export function priceDesk(i: MonadCouncilInputs): Ballot {
  const base = { persona: 'session-desk' as const };
  if (!i.price.ok) {
    return { ...base, vote: 'veto', confidence: 1, reason: `The price check could not run: ${i.price.error}. Nothing is traded blind.`, cites: ['price'] };
  }
  const { chainlink, fill, kuru, gapBps, maxGapBps } = i.price;
  if (i.price.halt) return { ...base, vote: 'veto', confidence: 1, reason: `Halted: ${i.price.halt}.`, cites: ['price'] };
  const feed = `Chainlink ${px(chainlink.price)} (${Math.round(chainlink.ageSec / 60)} min old)`;
  if (chainlink.ageSec > chainlink.maxAgeSec) {
    return { ...base, vote: 'veto', confidence: 1, reason: `Stale: ${feed}, past its ${chainlink.maxAgeSec / 60} min heartbeat.`, cites: ['price'] };
  }
  const parts = [feed, `fill ${px(fill.price)} on ${fill.venue}`, kuru ? `Kuru mid ${px(kuru.mid)}` : undefined, `${gapBps.toFixed(1)} bps apart (limit ${maxGapBps})`];
  if (gapBps > maxGapBps) {
    return { ...base, vote: 'veto', confidence: 1, reason: `The fill is too far from Chainlink: ${parts.filter(Boolean).join(', ')}.`, cites: ['price'] };
  }
  const room = 1 - gapBps / maxGapBps;
  return { ...base, vote: 'yes', confidence: Math.max(0.5, Math.min(0.95, 0.5 + room / 2)), reason: `Prices agree: ${parts.filter(Boolean).join(', ')}.`, cites: ['price'] };
}

/** Monad's perps desk, in the macro desk's seat: Perpl's funding says whether longs are crowded. */
export function perpsDesk(i: MonadCouncilInputs): Ballot {
  const base = { persona: 'macro-desk' as const };
  if (!i.perps.ok) return { ...base, vote: 'abstain', confidence: 0, reason: `Perpl unreadable: ${i.perps.error}.`, cites: ['perps'] };
  const crowded = i.perps.markets.filter((m) => m.fundingPctPerHour > CROWDED_FUNDING_PCT_PER_HOUR);
  const text = i.perps.markets
    .map((m) => `${m.market} longs ${m.fundingPctPerHour >= 0 ? 'pay' : 'earn'} ${Math.abs(m.fundingPctPerHour).toFixed(4)}%/h`)
    .join('; ');
  const own = crowded.some((m) => m.market === i.proposal.symbol);
  if (i.proposal.side === 'sell') {
    return { ...base, vote: crowded.length > 0 ? 'yes' : 'abstain', confidence: crowded.length > 0 ? 0.6 : 0, reason: `${crowded.length > 0 ? 'Crowded longs favour taking risk off' : 'Nothing crowded either way'}: ${text}.`, cites: ['perps'] };
  }
  if (own || crowded.length >= 2) return { ...base, vote: 'no', confidence: 0.7, reason: `Longs crowded on ${crowded.map((m) => m.market).join(' and ')}: ${text}.`, cites: ['perps'] };
  if (crowded.length === 1) return { ...base, vote: 'abstain', confidence: 0.3, reason: `One market crowded long: ${text}.`, cites: ['perps'] };
  return { ...base, vote: 'yes', confidence: 0.6, reason: `Perps not stretched: ${text}.`, cites: ['perps'] };
}

export function castBallots(i: CouncilInputs | MonadCouncilInputs): Ballot[] {
  if ('venue' in i && i.venue === 'monad') return [priceDesk(i), riskKeeper(i), trendReader(i), perpsDesk(i)];
  const r = i as CouncilInputs;
  return [sessionDesk(r), riskKeeper(r), trendReader(r), macroDesk(r)];
}

export function tally(ballots: readonly Ballot[]): { decision: Decision; yes: number; no: number; summary: string } {
  const yes = ballots.filter((b) => b.vote === 'yes').length;
  const no = ballots.filter((b) => b.vote === 'no').length;
  const vetoes = ballots.filter((b) => b.vote === 'veto');
  if (vetoes.length > 0) {
    return { decision: 'vetoed', yes, no, summary: `Vetoed by ${vetoes.map((v) => v.persona).join(' and ')}.` };
  }
  if (yes >= 2 && yes > no) return { decision: 'approved', yes, no, summary: `Approved ${yes}–${no}.` };
  return { decision: 'rejected', yes, no, summary: `Not approved: ${yes} yes, ${no} no.` };
}
