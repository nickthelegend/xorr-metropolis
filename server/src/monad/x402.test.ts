/**
 * The paid market read over x402 v2, end to end with the official client: the 402 names Monad testnet USDC at $0.01, a
 * real key signs the payment the client builds from it, and the read is served only when the facilitator verifies it —
 * the facilitator stood in, so nothing is sent anywhere and nothing is spent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';

vi.mock('../evm/client.js', () => ({ delegateAccount: { address: '0x00000000000000000000000000000000000000Aa' } }));
vi.mock('../council/monad-inputs.js', () => ({
  MONAD_COUNCIL_SYMBOLS: ['MON', 'ETH', 'BTC'],
  readMonadMarketInputs: async (p: { side: string; symbol: string; usd: number }) => ({
    venue: 'monad',
    readAt: '2026-10-07T12:00:00.000Z',
    proposal: p,
    price: { ok: true, source: 'test', chainlink: { price: 0.0258, ageSec: 20, feed: '0x', updatedAt: '', maxAgeSec: 3600 }, fill: { price: 0.0259, venue: 'Kuru' }, kuru: { mid: 0.0258, spreadBps: 12 }, gapBps: 30, maxGapBps: 150 },
    trend: { ok: true, source: 'test', rounds: [], changePct: 1.2, spanHours: 6 },
    perps: { ok: true, source: 'test', markets: [{ market: 'MON', mark: 0.0258, fundingPctPerHour: 0, openInterest: 1 }] },
  }),
}));

const { x402Routes, x402Server, MONAD_TESTNET_USDC } = await import('./x402.js');

const facilitator = {
  getSupported: vi.fn(async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:10143', extra: {} }], extensions: [], signers: {} })),
  verify: vi.fn(),
  settle: vi.fn(),
};

const account = privateKeyToAccount(generatePrivateKey());
const client = new x402HTTPClient(new x402Client().register('eip155:10143', new ExactEvmScheme(toClientEvmSigner(account))));
const ask = (app: ReturnType<typeof x402Routes>, headers: Record<string, string> = {}) =>
  app.request('http://xorr.test/x402/council', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ side: 'buy', symbol: 'MON', usd: 50 }) });

beforeEach(() => {
  facilitator.verify.mockReset().mockResolvedValue({ isValid: true, payer: account.address });
  facilitator.settle.mockReset().mockResolvedValue({ success: true, transaction: `0x${'ab'.repeat(32)}`, network: 'eip155:10143', payer: account.address });
});

describe('POST /x402/council — the council’s market read, paid per call', () => {
  it('without payment: 402, asking $0.01 of Monad testnet USDC, to the executor', async () => {
    const app = x402Routes(() => x402Server(facilitator as never));
    const res = await ask(app);
    expect(res.status).toBe(402);
    const required = client.getPaymentRequiredResponse((n) => res.headers.get(n), await res.json().catch(() => undefined));
    expect(required.x402Version).toBe(2);
    expect(required.accepts[0]).toMatchObject({ scheme: 'exact', network: 'eip155:10143', asset: MONAD_TESTNET_USDC, amount: '10000', payTo: '0x00000000000000000000000000000000000000Aa' });
    expect(facilitator.verify).not.toHaveBeenCalled();
  });

  it('with a signed payment the facilitator verifies: the read is served and the payment settled', async () => {
    const app = x402Routes(() => x402Server(facilitator as never));
    const first = await ask(app);
    const required = client.getPaymentRequiredResponse((n) => first.headers.get(n), await first.json().catch(() => undefined));
    const payment = await client.createPaymentPayload(required);
    const res = await ask(app, client.encodePaymentSignatureHeader(payment));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ballots: { persona: string; vote: string }[] };
    expect(body.ballots.map((b) => b.persona)).toEqual(['session-desk', 'trend-reader', 'macro-desk']);
    // What the facilitator was asked to verify: an EIP-3009 authorization from the payer for 10,000 units.
    const [payload] = facilitator.verify.mock.calls[0]!;
    expect(payload.payload.authorization).toMatchObject({ from: account.address, value: '10000' });
    expect(facilitator.settle).toHaveBeenCalledTimes(1);
    expect(client.getPaymentSettleResponse((n) => res.headers.get(n))).toMatchObject({ success: true, transaction: `0x${'ab'.repeat(32)}` });
  });

  it('a payment the facilitator refuses (an unfunded payer) gets no read and settles nothing', async () => {
    facilitator.verify.mockResolvedValue({ isValid: false, invalidReason: 'insufficient_funds', payer: account.address });
    const app = x402Routes(() => x402Server(facilitator as never));
    const first = await ask(app);
    const required = client.getPaymentRequiredResponse((n) => first.headers.get(n), await first.json().catch(() => undefined));
    const res = await ask(app, client.encodePaymentSignatureHeader(await client.createPaymentPayload(required)));
    expect(res.status).toBe(402);
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it('GET /x402 says what it costs and where it settles, free', async () => {
    const res = await x402Routes(() => x402Server(facilitator as never)).request('http://xorr.test/x402');
    expect(await res.json()).toMatchObject({ route: 'POST /x402/council', price: '$0.01', network: 'eip155:10143', x402Version: 2 });
  });
});
