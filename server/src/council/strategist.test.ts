/**
 * Kimi's seat decides real rounds, so what it may say is pinned: a vote it may cast, a confidence, and a reason whose
 * every number some desk reported. Without a key it does not sit.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Ballot } from './personas.js';
import { kimiConfigured, numbersIn, parseStrategist, strategistBallot, strategistMessages } from './strategist.js';

const ballots: Ballot[] = [
  { persona: 'session-desk', vote: 'yes', confidence: 0.8, reason: 'Prices agree: Chainlink $0.02393 (1 min old), fill $0.02409, 66.9 bps apart (limit 150).', cites: ['price'] },
  { persona: 'risk-keeper', vote: 'yes', confidence: 0.9, reason: '$50.00 fits: $1,550.00 left today.', cites: ['permission'] },
  { persona: 'trend-reader', vote: 'abstain', confidence: 0.2, reason: 'Flat: +0.04% over the rounds read.', cites: ['trend'] },
  { persona: 'macro-desk', vote: 'no', confidence: 0.7, reason: 'Longs crowded on MON and ETH: MON longs pay 0.0056%/h.', cites: ['perps'] },
];
const ctx = { proposal: { side: 'buy', symbol: 'MON', usd: 50 }, inputs: { chainlink: { price: 0.02393 } }, ballots };
const shown = `${strategistMessages(ctx)[1]!.content} 2 1 4`;

const kimi = (content: string, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }));
const LIVE = { MOONSHOT_API_KEY: 'test-key', KIMI_MODEL: 'kimi-k2.6' } as NodeJS.ProcessEnv;

describe('the answer', () => {
  it('takes a vote, a confidence and a reason that quotes the desks', () => {
    const p = parseStrategist('{"vote":"no","confidence":0.6,"reason":"Perps Desk carries it: MON longs pay 0.0056%/h, and the trend is flat at +0.04%."}', shown);
    expect(p).toEqual({ ok: true, vote: 'no', confidence: 0.6, reason: 'Perps Desk carries it: MON longs pay 0.0056%/h, and the trend is flat at +0.04%.' });
  });

  it('refuses a number no desk reported', () => {
    const p = parseStrategist('{"vote":"yes","confidence":0.7,"reason":"MON will rise 12% this week."}', shown);
    expect(p).toEqual({ ok: false, why: 'its reason used 12, which no desk reported' });
  });

  it('refuses a veto, a non-vote, prose instead of JSON', () => {
    expect(parseStrategist('{"vote":"veto","confidence":1,"reason":"No."}', shown)).toMatchObject({ ok: false, why: 'it tried to veto, which this seat cannot' });
    expect(parseStrategist('{"vote":"maybe","confidence":1,"reason":"No."}', shown)).toMatchObject({ ok: false });
    expect(parseStrategist('I would vote yes.', shown)).toEqual({ ok: false, why: 'the answer was not JSON' });
  });

  it('reads JSON inside a code fence, and clamps the confidence', () => {
    expect(parseStrategist('```json\n{"vote":"abstain","confidence":3,"reason":"Nothing decisive."}\n```', shown)).toMatchObject({ ok: true, confidence: 1 });
  });

  it('normalises numbers the way people write them', () => {
    expect(numbersIn('$1,550.00 left, 0.10 and +0.25%')).toEqual(['1550', '0.1', '0.25']);
  });
});

describe('the seat', () => {
  it('does not sit without a key: no ballot at all, nothing stood in', async () => {
    expect(kimiConfigured({})).toBe(false);
    expect(await strategistBallot(ctx, { env: {} })).toBeNull();
  });

  it('asks Kimi with the key and casts its vote', async () => {
    const f = kimi('{"vote":"no","confidence":0.65,"reason":"The Perps Desk outweighs a flat trend: MON longs pay 0.0056%/h."}');
    const b = await strategistBallot(ctx, { env: LIVE, fetchImpl: f });
    expect(b).toMatchObject({ persona: 'strategist', vote: 'no', confidence: 0.65, cites: ['ballots', 'kimi:kimi-k2.6'] });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.moonshot.ai/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'kimi-k2.6', response_format: { type: 'json_object' } });
  });

  it('abstains, saying why, when Kimi invents a number or does not answer', async () => {
    expect((await strategistBallot(ctx, { env: LIVE, fetchImpl: kimi('{"vote":"yes","confidence":0.9,"reason":"Up 40% soon."}') }))?.reason).toBe(
      "Kimi's answer was refused (its reason used 40, which no desk reported), so the Strategist abstains.",
    );
    expect((await strategistBallot(ctx, { env: LIVE, fetchImpl: kimi('', 429) }))?.reason).toBe('Kimi did not answer (HTTP 429), so the Strategist abstains.');
    const throwing = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    expect((await strategistBallot(ctx, { env: LIVE, fetchImpl: throwing }))?.vote).toBe('abstain');
  });
});
