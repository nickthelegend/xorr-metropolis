/**
 * On a fork the fill is held to the fork's own Chainlink and Kuru, aged at the fork block — not to live mainnet, which
 * moves on while the fork's pools stand still.
 */
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  process.env.XORR_CHAIN = 'monad-fork';
  return { readFeedCalls: [] as unknown[], forkClient: { tag: 'fork' } as Record<string, unknown> };
});

vi.mock('../evm/client.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  publicClient: Object.assign(h.forkClient, {
    request: vi.fn(async () => ({ forkConfig: { forkBlockNumber: 110857492 } })),
    getBlock: vi.fn(async () => ({ timestamp: 1791200000n })),
  }),
}));
vi.mock('../monad/mainnet.js', () => ({ monadMainnet: () => ({ tag: 'mainnet' }) }));
vi.mock('../monad/chainlink.js', () => ({
  CHAINLINK_MONAD: {},
  feedFor: () => 'MON',
  readFeed: vi.fn(async (_s: string, opts: unknown) => {
    h.readFeedCalls.push(opts);
    return { symbol: 'MON', feed: '0xfeed', price: 0.0315, ageSec: 30, updatedAt: '2026-10-06T00:00:00Z', stale: false };
  }),
}));
vi.mock('../monad/kuru.js', () => ({ readBook: vi.fn(async () => ({ mid: 0.03151, spreadBps: 4 })) }));
vi.mock('../venues/uniswap.js', () => ({ quote: vi.fn(async () => ({ outAmount: 634.9 })) })); // $20 → $0.0315
vi.mock('../venues/tokens.js', () => ({ canonicalSymbol: (s: string) => s, ensureRegistry: async () => undefined }));

const { manualPriceGate } = await import('./monad-inputs.js');

describe('the price gate on a fork', () => {
  it('reads the fork’s own feed, aged at the fork block', async () => {
    expect(await manualPriceGate('WMON', 20)).toMatchObject({ ok: true });
    expect(h.readFeedCalls[0]).toMatchObject({ client: { tag: 'fork' }, nowSec: 1791200000 });
  });
});
