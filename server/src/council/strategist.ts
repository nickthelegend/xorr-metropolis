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
import { one } from '../db/index.js';

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
  const fenced = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  // A thinking model may put words around the object: take the outermost {…} when the whole is not JSON.
  const body = /^\s*\{[\s\S]*\}\s*$/.test(fenced) ? fenced : (fenced.match(/\{[\s\S]*\}/)?.[0] ?? fenced);
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
/*
 * The Moonshot credit is $10 (12 Oct): every call is the user's money. So the seat is asked only when its answer can
 * matter and not twice for the same question:
 *   - a round a desk vetoed is decided by the veto, so Kimi is not asked;
 *   - its ballot is cached for 30 minutes by what it weighs — the proposal and the desks' votes — not by the exact
 *     prices in the prompt, which differ every round and would never hit;
 *   - at most KIMI_DAILY_CALLS calls a day (default 30); past that it abstains and says why.
 */
const KIMI_CACHE_MS = 30 * 60_000;
const kimiCache = new Map<string, { at: number; ballot: Ballot }>();
let kimiDay = { day: '', calls: 0 };

/**
 * One call taken from today's budget, counted in Postgres (app_config, key `kimi_calls:<UTC day>`) so a restart or a second
 * executor cannot reset it: the hosted app is public, and anyone with free testnet funds can convene rounds. The count
 * is taken atomically; true when this call is within the cap. If the database cannot be asked, the call is refused —
 * the budget fails closed. Tests pass `count` to stay off the database.
 */
export async function takeKimiCall(day: string, cap: number, count?: (day: string) => Promise<number>): Promise<boolean> {
  try {
    const n = count
      ? await count(day)
      : Number(
          (
            await one<{ value: string }>(
              `INSERT INTO app_config (key, value) VALUES ($1, '1')
               ON CONFLICT (key) DO UPDATE SET value = (app_config.value::int + 1)::text
               RETURNING value`,
              [`kimi_calls:${day}`],
            )
          )?.value ?? NaN,
        );
    return Number.isFinite(n) && n <= cap;
  } catch {
    return false;
  }
}

/** What the Strategist's answer depends on: the trade and how each desk voted. */
export function strategistKey(ctx: Pick<StrategistContext, 'proposal' | 'ballots'>): string {
  const p = ctx.proposal;
  return `${p.side}:${p.symbol}:${p.usd}|${[...ctx.ballots].map((b) => `${b.persona}=${b.vote}`).sort().join(',')}`;
}

/** Test seam: forget the cache and the day's count. */
export function resetStrategistBudget(): void {
  kimiCache.clear();
  kimiDay = { day: '', calls: 0 };
}

export async function strategistBallot(
  ctx: StrategistContext,
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: Fetch; now?: () => number; count?: (day: string) => Promise<number> } = {},
): Promise<Ballot | null> {
  const env = opts.env ?? process.env;
  if (!kimiConfigured(env)) return null;
  const now = (opts.now ?? Date.now)();
  const model0 = env.KIMI_MODEL ?? KIMI_MODEL;
  if (ctx.ballots.some((b) => b.vote === 'veto')) {
    return { persona: 'strategist', vote: 'abstain', confidence: 0, reason: 'A desk vetoed this round, so the Strategist was not asked.', cites: [`kimi:${model0}`] };
  }
  const key = strategistKey(ctx);
  const hit = kimiCache.get(key);
  if (hit && now - hit.at < KIMI_CACHE_MS) return { ...hit.ballot, cites: [...hit.ballot.cites.filter((c) => c !== 'cached'), 'cached'] };
  const today = new Date(now).toISOString().slice(0, 10);
  if (kimiDay.day !== today) kimiDay = { day: today, calls: 0 };
  // KIMI_DAILY_CALLS overrides the cap (e.g. for a demo recording); the default keeps $10 of credit lasting.
  const cap = Number(env.KIMI_DAILY_CALLS ?? 30);
  const counted = opts.count ?? (env === process.env ? undefined : async () => ++kimiDay.calls);
  if (!(await takeKimiCall(today, cap, counted))) {
    return { persona: 'strategist', vote: 'abstain', confidence: 0, reason: `Kimi's daily capacity is reached (${cap} calls), so the Strategist sits this round out.`, cites: [`kimi:${model0}`] };
  }
  const b = await askKimi(ctx, env, opts.fetchImpl);
  // Only a real answer is kept: an abstention for a failed call should not stand in for the next half hour.
  if (b.vote !== 'abstain' || !/did not answer|was refused/.test(b.reason)) kimiCache.set(key, { at: now, ballot: b });
  return b;
}

async function askKimi(ctx: StrategistContext, env: NodeJS.ProcessEnv, fetchImpl?: Fetch): Promise<Ballot> {
  const messages = strategistMessages(ctx);
  const yes = ctx.ballots.filter((b) => b.vote === 'yes').length;
  const no = ctx.ballots.filter((b) => b.vote === 'no' || b.vote === 'veto').length;
  // What the reason may quote from: the round as Kimi saw it, and the desks' tally (a count it may state).
  const shown = `${messages[1]!.content} ${yes} ${no} ${ctx.ballots.length}`;
  const model = env.KIMI_MODEL ?? KIMI_MODEL;
  const seat = (vote: Ballot['vote'], confidence: number, reason: string, cites: string[]): Ballot => ({ persona: 'strategist', vote, confidence, reason, cites });

  let raw: string;
  try {
    const res = await (fetchImpl ?? fetch)(`${env.MOONSHOT_BASE_URL ?? KIMI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.MOONSHOT_API_KEY}` },
      // kimi-k2.6 thinks by default: it ran past 400 tokens with an empty answer, and past the 25 s timeout with more (13 Oct).
      // A council seat needs a vote, not a chain of thought, so thinking is off, which this model pairs with temperature 0.6
      // (it refuses any other). One short JSON answer in a few seconds, ~400 tokens at most.
      body: JSON.stringify({ model, messages, thinking: { type: 'disabled' }, temperature: 0.6, max_tokens: 400, response_format: { type: 'json_object' } }),
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
