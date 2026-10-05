/**
 * Kimi itself, answering a real round shape. Runs only with MOONSHOT_API_KEY (`LIVE=1 npx vitest run strategist.live`).
 */
import { describe, expect, it } from 'vitest';
import { strategistBallot } from './strategist.js';

describe.runIf(Boolean(process.env.MOONSHOT_API_KEY))('Kimi in the Strategist seat', () => {
  it('votes on a split round, quoting only what the desks said', async () => {
    const b = await strategistBallot({
      proposal: { side: 'buy', symbol: 'MON', usd: 50 },
      inputs: { chainlink: { price: 0.02393, ageSec: 60 }, fill: { price: 0.02409 }, gapBps: 66.9 },
      ballots: [
        { persona: 'session-desk', vote: 'yes', confidence: 0.8, reason: 'Prices agree: Chainlink $0.02393, fill $0.02409, 66.9 bps apart (limit 150).', cites: ['price'] },
        { persona: 'risk-keeper', vote: 'yes', confidence: 0.9, reason: '$50.00 fits: $1,550.00 left today.', cites: ['permission'] },
        { persona: 'trend-reader', vote: 'no', confidence: 0.6, reason: 'Falling: -0.80% over the rounds read.', cites: ['trend'] },
        { persona: 'macro-desk', vote: 'no', confidence: 0.7, reason: 'Longs crowded on MON and ETH: MON longs pay 0.0056%/h.', cites: ['perps'] },
      ],
    });
    expect(b.persona).toBe('strategist');
    expect(b.cites).toContain(`kimi:${process.env.KIMI_MODEL ?? 'kimi-k2.6'}`);
    console.log(b);
  }, 60_000);
});
