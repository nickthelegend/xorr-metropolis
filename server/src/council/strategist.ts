/**
 * The Strategist: Kimi (Moonshot AI) in the council's fifth seat (Kimi bounty, 2026-10-06).
 *
 * The four desks are rules over live readings, and they split: a 2–1 with an abstention, a 2–2. The Strategist reads
 * everything they read — the proposal, the readings, each desk's ballot and reason — and casts a real vote that decides
 * those rounds. It is the only seat that weighs the desks against each other, so it is load-bearing, not a chat window.
 *
 * What it may not do:
 *   - veto. A veto is a safety stop (a stale feed, a fill far from Chainlink, a cap) and stays with the rules;
 *   - invent a number. Every number in its reason must appear in what it was shown, or the answer is refused and the seat
 *     abstains, saying why;
 *   - reach the screen unparsed. Its answer is JSON — vote, confidence, reason — validated field by field.
 *
 * Moonshot's API is OpenAI-compatible: POST {MOONSHOT_BASE_URL}/chat/completions with `MOONSHOT_API_KEY`; the model is
 * `KIMI_MODEL` (default `kimi-k2.6`; k2.5 and older are retired). Without a key the seat is **not configured**: it does
 * not sit, casts nothing, and `/council/seats` says so with the key it needs. There is no stand-in answer (6 Oct: no
 * production mocks).
 */
import type { Ballot, Vote } from './personas.js';

export const KIMI_BASE_URL = process.env.MOONSHOT_BASE_URL ?? 'https://api.moonshot.ai/v1';
export const KIMI_MODEL = process.env.KIMI_MODEL ?? 'kimi-k2.6';
const TIMEOUT_MS = Number(process.env.KIMI_TIMEOUT_MS ?? 25_000);

/** Whether the Strategist sits: only with a Moonshot key. */
export function kimiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.MOONSHOT_API_KEY);
}

export type StrategistContext = {
  proposal: { side: string; symbol: string; usd: number };
  /** The readings the desks voted on, as recorded with the round. */
  inputs: unknown;
  ballots: readonly Ballot[];
};

const SYSTEM = [
  "You hold the Strategist seat on xorr's trading council. xorr's agents trade MON, ETH and BTC on Monad inside a spending",
  'permission the owner granted on chain. Four desks have already voted on the proposal below, each a rule over live',
  'readings: the Price Desk (Chainlink against the fill), the Risk Keeper (the permission and position limit), the Trend',
  "Reader (Chainlink's recent rounds) and the Perps Desk (Perpl funding). Your job is to weigh them against each other and",
  'decide the close calls: when the desks split, your vote settles the round.',
  '',
  'Answer with one JSON object and nothing else: {"vote": "yes" | "no" | "abstain", "confidence": number from 0 to 1,',
  '"reason": string}. You cannot veto. The reason is at most two sentences, plain English, for the owner to read; it names',
  'which desk readings carried your decision. Use only numbers that appear in the readings or ballots — never compute or',
  'invent one. If the readings do not support a view, abstain and say what is missing.',
].join('\n');

/** The messages Kimi is sent: the rules, then the round as JSON. */
export function strategistMessages(ctx: StrategistContext) {
  return [
    { role: 'system' as const, content: SYSTEM },
    {
      role: 'user' as const,
      content: JSON.stringify({
        proposal: ctx.proposal,
        readings: ctx.inputs,
        ballots: ctx.ballots.map((b) => ({ desk: b.persona, vote: b.vote, confidence: b.confidence, reason: b.reason })),
      }),
    },
  ];
}

/** Every number written in a piece of text, normalised ("1,037.94" → "1037.94"; "+0.25%" → "0.25"). */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1'));
}

export type Parsed = { ok: true; vote: Exclude<Vote, 'veto'>; confidence: number; reason: string } | { ok: false; why: string };

/**
 * Kimi's answer, checked: JSON with a vote it may cast, a confidence, and a reason whose every number was in what it was
 * shown (`shown`, the serialised context).
 */
export function parseStrategist(raw: string, shown: string): Parsed {
  const body = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let v: { vote?: unknown; confidence?: unknown; reason?: unknown };
  try {
    v = JSON.parse(body);
  } catch {
    return { ok: false, why: 'the answer was not JSON' };
  }
  if (v.vote === 'veto') return { ok: false, why: 'it tried to veto, which this seat cannot' };
  if (v.vote !== 'yes' && v.vote !== 'no' && v.vote !== 'abstain') return { ok: false, why: `"${String(v.vote)}" is not a vote` };
  const confidence = typeof v.confidence === 'number' && Number.isFinite(v.confidence) ? Math.min(1, Math.max(0, v.confidence)) : null;
  if (confidence === null) return { ok: false, why: 'it gave no confidence' };
  const reason = typeof v.reason === 'string' ? v.reason.trim().replace(/\s+/g, ' ') : '';
  if (!reason) return { ok: false, why: 'it gave no reason' };
  if (reason.length > 500) return { ok: false, why: 'its reason ran past two sentences' };
  const known = new Set(numbersIn(shown));
  const invented = numbersIn(reason).filter((n) => !known.has(n));
  if (invented.length > 0) return { ok: false, why: `its reason used ${invented.join(', ')}, which no desk reported` };
  return { ok: true, vote: v.vote, confidence, reason };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The Strategist's ballot for this round, or null when the seat is not configured (no key): it does not sit. Never throws:
 * a failure to answer is an abstention that says what failed.
 */
export async function strategistBallot(ctx: StrategistContext, opts: { env?: NodeJS.ProcessEnv; fetchImpl?: Fetch } = {}): Promise<Ballot | null> {
  const env = opts.env ?? process.env;
  if (!kimiConfigured(env)) return null;
  const messages = strategistMessages(ctx);
  const yes = ctx.ballots.filter((b) => b.vote === 'yes').length;
  const no = ctx.ballots.filter((b) => b.vote === 'no' || b.vote === 'veto').length;
  // What the reason may quote from: the round as Kimi saw it, and the desks' tally (a count it may state).
  const shown = `${messages[1]!.content} ${yes} ${no} ${ctx.ballots.length}`;
  const model = env.KIMI_MODEL ?? KIMI_MODEL;
  const seat = (vote: Ballot['vote'], confidence: number, reason: string, cites: string[]): Ballot => ({ persona: 'strategist', vote, confidence, reason, cites });

  let raw: string;
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${env.MOONSHOT_BASE_URL ?? KIMI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.MOONSHOT_API_KEY}` },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 400, response_format: { type: 'json_object' } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return seat('abstain', 0, `Kimi did not answer (HTTP ${res.status}), so the Strategist abstains.`, [`kimi:${model}`]);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    raw = body.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    const why = e instanceof Error && e.name === 'TimeoutError' ? 'it timed out' : 'the request failed';
    return seat('abstain', 0, `Kimi did not answer (${why}), so the Strategist abstains.`, [`kimi:${model}`]);
  }
  const p = parseStrategist(raw, shown);
  if (!p.ok) return seat('abstain', 0, `Kimi's answer was refused (${p.why}), so the Strategist abstains.`, [`kimi:${model}`]);
  return seat(p.vote, p.confidence, p.reason, ['ballots', `kimi:${model}`]);
}
