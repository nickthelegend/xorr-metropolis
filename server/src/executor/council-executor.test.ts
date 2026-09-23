/**
 * An approved council round goes through the executor's own spend paths, and their answer becomes the round's outcome.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const OWNER = '0x95A0b368588713011a15f4b1041423f31B08e615';
const HASH = `0x${'ab'.repeat(32)}`;

vi.mock('../db/index.js', () => ({ one: vi.fn(async () => ({ id: 'w-1', address: OWNER })) }));
vi.mock('../evm/balances.js', () => ({ holdings: vi.fn() }));
vi.mock('../routes/panic.js', () => ({ closeHolding: vi.fn() }));
vi.mock('./order.js', () => ({ placeOrder: vi.fn() }));
vi.mock('../venues/tokens.js', () => ({ canonicalSymbol: (s: string) => s.toUpperCase(), ensureRegistry: async () => undefined }));

const { placeOrder } = await import('./order.js');
const { closeHolding } = await import('../routes/panic.js');
const { holdings } = await import('../evm/balances.js');
const { councilExecutor } = await import('./council-executor.js');

const round = (side: 'buy' | 'sell', usd = 50) => ({ walletId: 'w-1', owner: OWNER as `0x${string}`, proposal: { side, symbol: 'nvda', usd }, roundId: '7' });

beforeEach(() => vi.clearAllMocks());

describe('the council’s trade path', () => {
  it('buys through placeOrder and reports the transaction', async () => {
    vi.mocked(placeOrder).mockResolvedValue({
      placed: true,
      orderId: 's-1',
      outcome: { status: 'filled', runId: 'r-1', signature: HASH, units: 0.2184, price: 228.86 },
    });
    expect(await councilExecutor(round('buy'))).toMatchObject({ status: 'executed', txHash: HASH, detail: 'Bought 0.218400 NVDA at $228.8600.', fill: { units: 0.2184, price: 228.86 } });
    expect(placeOrder).toHaveBeenCalledWith(expect.objectContaining({ id: 'w-1' }), 'NVDA', 50, 'Council round 7: buy $50 of NVDA');
  });

  it('reports a refusal from the order path — the cap, the stock gate — as refused, with its reason', async () => {
    vi.mocked(placeOrder).mockResolvedValue({
      placed: true,
      orderId: 's-1',
      outcome: { status: 'blocked', runId: 'r-1', reason: 'stock_closed', detail: 'The US market is closed.' },
    });
    expect(await councilExecutor(round('buy'))).toEqual({ status: 'refused', detail: 'stock_closed: The US market is closed.' });
  });

  it('sells through closeHolding, sized as the share of the holding the round asked for', async () => {
    vi.mocked(holdings).mockResolvedValue([{ symbol: 'NVDA', units: 0.4, usd: 100, raw: 400_000_000_000_000_000n }]);
    vi.mocked(closeHolding).mockResolvedValue({ status: 200, body: { status: 'closed', units: 0.1, usd: 24.9, txHash: HASH } });
    expect(await councilExecutor(round('sell', 25))).toMatchObject({ status: 'executed', txHash: HASH });
    expect(closeHolding).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'NVDA', fraction: 0.25, actor: 'Council' }));
  });

  it('refuses a sale of something not held without asking the chain to sell it', async () => {
    vi.mocked(holdings).mockResolvedValue([]);
    expect(await councilExecutor(round('sell'))).toEqual({ status: 'refused', detail: 'No NVDA to sell.' });
    expect(closeHolding).not.toHaveBeenCalled();
  });
});
