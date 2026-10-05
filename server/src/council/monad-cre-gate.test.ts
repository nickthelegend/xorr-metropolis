/**
 * On Monad testnet, MON has no Chainlink feed of its own; the CRE workflow's report is the anchor (`monad/cre-price.ts`).
 * A halt in that report refuses the order, and before the receiver's first report the gate reads mainnet Chainlink.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  process.env.XORR_CHAIN = 'monad-testnet';
  return {
    cre: null as null | { receiver: string; price: number; sources: number; spreadBps: number; anchorGapBps: number; halt: boolean; observedAt: number },
    ask: 0.02404,
  };
});

vi.mock('../monad/mainnet.js', () => ({ monadMainnet: () => ({}) }));
vi.mock('../evm/client.js', async (importOriginal) => ({ ...(await importOriginal<object>()), publicClient: {} }));
vi.mock('../monad/cre-price.js', () => ({
  creMonUsdReceiver: () => '0x00000000000000000000000000000000000C4E01',
  readCrePrice: vi.fn(async () => h.cre),
}));
vi.mock('../monad/chainlink.js', () => ({
  CHAINLINK_MONAD: {},
  feedFor: () => 'MON',
  readFeed: vi.fn(async () => ({ symbol: 'MON', feed: '0xfeed', price: 0.024, ageSec: 60, updatedAt: '2026-10-05T00:00:00Z', stale: false })),
}));
vi.mock('../monad/kuru.js', () => ({ readBook: vi.fn(async () => ({ mid: 0.02401, spreadBps: 4 })) }));
vi.mock('../http/get.js', () => ({
  getJson: vi.fn(async () => ({
    markets: [{ id: 64, name: 'MON Perp', config: { is_open: true, price_decimals: 5, size_decimals: 0 }, state: { mrk: 2403, bid: 2402, ask: Math.round(h.ask * 1e5) } }],
  })),
}));

const { manualPriceGate } = await import('./monad-inputs.js');

beforeEach(() => {
  h.cre = { receiver: '0x00000000000000000000000000000000000C4E01', price: 0.024, sources: 3, spreadBps: 17, anchorGapBps: 8, halt: false, observedAt: Math.floor(Date.now() / 1000) - 120 };
  h.ask = 0.02404;
});

describe('MON on Monad testnet, against the CRE report', () => {
  it('passes when Perpl’s ask is near the CRE price', async () => {
    expect(await manualPriceGate('MON', 50)).toMatchObject({ ok: true });
  });

  it('is refused while the report says halt, with the reason', async () => {
    h.cre = { ...h.cre!, halt: true, anchorGapBps: 410 };
    expect(await manualPriceGate('MON', 50)).toEqual({
      ok: false,
      detail: "Not placed: the CRE workflow's latest MON/USD report says halt (a market 410 bps from Chainlink, 3 sources).",
    });
  });

  it('measures the fill against the CRE price, not mainnet’s feed', async () => {
    h.cre = { ...h.cre!, price: 0.026 };
    const g = await manualPriceGate('MON', 50);
    expect(g).toMatchObject({ ok: false });
    expect((g as { detail: string }).detail).toMatch(/from Chainlink \(\$0\.02600\)/);
  });

  it('reads mainnet Chainlink before the receiver’s first report', async () => {
    h.cre = null;
    expect(await manualPriceGate('MON', 50)).toMatchObject({ ok: true });
  });
});
