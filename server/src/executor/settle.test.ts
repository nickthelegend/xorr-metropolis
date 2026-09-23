/**
 * Where a leg settles, with every venue stood in for (PLAN.md 3.20, 2026-09-23).
 *
 * `chooseSettlement` is best execution across the venues this build has: Uniswap v3 always (where it routes), 1inch only
 * where `oneinchConfigured()` says it may be asked, a direct leg to its own venue. These cases prove which builder is
 * asked, with what — the owner as receiver, the delegation as the holder, the tolerance by urgency or by the person —
 * which venue wins, and which floor the leg is held to, including that on a fork 1inch is measured by a dry run and held
 * to what its route delivers there, and that nothing falls back to a guess.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SwapQuote } from '../venues/tokens.js';
import type { TradeIntent } from './kinds/index.js';
import type { SettlementSend } from './settle.js';

const TOKENS = vi.hoisted(
  () =>
    ({
      USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, toSettlement: [], kind: 'cash' },
      WETH: {
        address: '0x4200000000000000000000000000000000000006',
        decimals: 18,
        toSettlement: [{ via: 'USDC', fee: 500 }],
        kind: 'crypto',
      },
      // An equity no Uniswap pool reaches: only 1inch can route it.
      NVDAc: { address: '0xb20000000000000000000078ee7ce2fE4908108C', decimals: 8, toSettlement: null, kind: 'stock' },
    }) as const,
);

vi.mock('../venues/tokens.js', () => ({
  SETTLEMENT_SYMBOL: 'USDC',
  TOKENS,
  SLIPPAGE: { scheduled: 0.3, stop: 1, panic: 2 },
  // A spy: what settlement hands it, and that its answer is the tolerance the venue gets, are the assertions.
  slippageFor: vi.fn(),
  canonicalSymbol: (s: string) => s,
  isRoutable: (s: string) => (TOKENS as Record<string, { toSettlement: unknown }>)[s]?.toSettlement != null,
  ensureRegistry: async () => undefined,
}));
vi.mock('../venues/uniswap.js', () => ({
  quote: vi.fn(),
  buildSwap: vi.fn(),
  lessPct: (amount: bigint, pct: number) => (amount * BigInt(Math.floor((1 - pct / 100) * 1_000_000))) / 1_000_000n,
}));
const inch = vi.hoisted(() => ({ configured: false }));
vi.mock('../venues/oneinch.js', () => ({
  oneinchConfigured: () => inch.configured,
  buildSwap: vi.fn(),
}));
// Off a fork unless a case says otherwise: where 1inch's prices and the pools drift apart, its route is measured.
const fork = vi.hoisted(() => ({ drifts: false }));
vi.mock('../evm/measure-route.js', () => ({
  get PRICES_DRIFT() {
    return fork.drifts;
  },
  deliveredOnChain: vi.fn(),
}));

const uniswap = await import('../venues/uniswap.js');
const oneinch = await import('../venues/oneinch.js');
const { slippageFor } = await import('../venues/tokens.js');
const { deliveredOnChain } = await import('../evm/measure-route.js');
const { chooseSettlement } = await import('./settle.js');

const WETH = TOKENS.WETH.address;
const OWNER = '0x95A0b368588713011a15f4b1041423f31B08e615';
const DELEGATION = '0x6c5528Fd8E74a047A85bAb413856A9239E73540e';
const SWAP_ROUTER = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45' as const;
const ONEINCH_ROUTER = '0x111111125421cA6dc452d289314280a0f8842A65' as const;
const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
const A_USDC = '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB';

const buy = (over: Partial<TradeIntent> = {}): TradeIntent => ({
  inSymbol: 'USDC',
  outSymbol: 'WETH',
  amountIn: 100,
  usd: 100,
  because: 'Scheduled buy of $100 of WETH.',
  ...over,
});

const settle = (intent: TradeIntent, opts: { isClose?: boolean; send?: SettlementSend } = {}) =>
  chooseSettlement({
    intent,
    owner: OWNER,
    isClose: opts.isClose ?? false,
    delegationFrom: DELEGATION,
    send: opts.send ?? { via: 'spend', amount: 100_000_000n },
  });

const QUOTE: SwapQuote = {
  inSymbol: 'USDC',
  outSymbol: 'WETH',
  inAmount: 100,
  outAmount: 0.04,
  minimumOut: 0.03988,
  slippagePct: 0.3,
  venues: ['Uniswap v3'],
  route: 'Uniswap v3',
  priceImpactPct: 0.42,
};

/** Uniswap's calldata for the buy: floor 0.0399 WETH, along USDC→WETH 0.05%. */
const UNI = {
  to: SWAP_ROUTER,
  data: '0x0101' as const,
  value: '0',
  minOut: 39_900_000_000_000_000n,
  route: { tokens: ['USDC', 'WETH'], fees: [500] },
  quotedOut: 40_000_000_000_000_000n,
};

beforeEach(() => {
  vi.clearAllMocks();
  inch.configured = false;
  fork.drifts = false;
  vi.mocked(uniswap.quote).mockResolvedValue(QUOTE);
  vi.mocked(uniswap.buildSwap).mockResolvedValue(UNI);
  vi.mocked(slippageFor).mockReturnValue(0.63);
});

describe('chooseSettlement', () => {
  it('settles a buy through Uniswap v3: the owner receives, the delegation holds, the floor is the route’s own', async () => {
    const s = await settle(buy());
    expect(s.venue).toBe('uniswap-v3');
    expect(s.swap).toEqual({ to: SWAP_ROUTER, data: '0x0101' });
    expect(s.floor).toEqual({ tokenOut: WETH, minOut: UNI.minOut });
    expect(s.route).toBe('Uniswap v3 USDC→WETH 0.05%');
    expect(s.payToken).toBe(TOKENS.USDC);
    expect(uniswap.buildSwap).toHaveBeenCalledWith(
      expect.objectContaining({ inSymbol: 'USDC', outSymbol: 'WETH', amount: 100, from: DELEGATION, receiver: OWNER, slippagePct: 0.63 }),
    );
    // The scheduled tolerance, widened by the impact the quote measured.
    expect(slippageFor).toHaveBeenCalledWith(0.3, 0.42);
    expect(oneinch.buildSwap).not.toHaveBeenCalled();
  });

  it('gives a close the stop tolerance and sizes the route to exactly what closePosition() sends', async () => {
    await settle(buy({ inSymbol: 'WETH', outSymbol: 'USDC', amountIn: 0.04 }), {
      isClose: true,
      send: { via: 'closePosition', amount: 40_000_000_000_000_123n },
    });
    expect(slippageFor).toHaveBeenCalledWith(1, 0.42);
    expect(uniswap.buildSwap).toHaveBeenCalledWith(expect.objectContaining({ amountRaw: 40_000_000_000_000_123n }));
  });

  it('holds every venue to the tolerance the person chose, not the urgency default', async () => {
    await settle(buy({ slippagePct: 0.1 }));
    expect(slippageFor).not.toHaveBeenCalled();
    expect(uniswap.buildSwap).toHaveBeenCalledWith(expect.objectContaining({ slippagePct: 0.1 }));
  });

  it('falls back to the urgency constant when the quote fails, and still builds the route', async () => {
    vi.mocked(uniswap.quote).mockRejectedValue(new Error('quoter down'));
    await settle(buy());
    expect(slippageFor).toHaveBeenCalledWith(0.3, null);
    expect(uniswap.buildSwap).toHaveBeenCalled();
  });

  it('settles a direct leg against its own venue with its own floor, asking no venue', async () => {
    const s = await settle(
      buy({
        outSymbol: 'aUSDC',
        direct: { venue: AAVE_POOL, data: '0xdead', unitPriceUsd: 1, tokenOut: A_USDC, minOut: 99_000_000n },
      }),
    );
    expect(s).toMatchObject({ venue: 'aave', swap: { to: AAVE_POOL, data: '0xdead' }, floor: { tokenOut: A_USDC, minOut: 99_000_000n } });
    expect(uniswap.quote).not.toHaveBeenCalled();
    expect(uniswap.buildSwap).not.toHaveBeenCalled();
  });

  it('does not ask 1inch where it is not enabled (Robinhood Chain, or no key)', async () => {
    await settle(buy());
    expect(oneinch.buildSwap).not.toHaveBeenCalled();
  });

  it('takes 1inch only when its floor beats Uniswap’s', async () => {
    inch.configured = true;
    vi.mocked(oneinch.buildSwap).mockResolvedValue({ to: ONEINCH_ROUTER, data: '0x1inc', value: '0', minOut: 39_950_000_000_000_000n });
    expect(await settle(buy())).toMatchObject({ venue: '1inch', swap: { to: ONEINCH_ROUTER }, floor: { minOut: 39_950_000_000_000_000n } });

    vi.mocked(oneinch.buildSwap).mockResolvedValue({ to: ONEINCH_ROUTER, data: '0x1inc', value: '0', minOut: 39_800_000_000_000_000n });
    expect((await settle(buy())).venue).toBe('uniswap-v3');
  });

  it('keeps Uniswap when 1inch cannot build a route, and takes 1inch when Uniswap cannot', async () => {
    inch.configured = true;
    vi.mocked(oneinch.buildSwap).mockRejectedValue(new Error('1inch 500'));
    expect((await settle(buy())).venue).toBe('uniswap-v3');

    vi.mocked(uniswap.buildSwap).mockRejectedValue(new Error('No liquidity'));
    vi.mocked(oneinch.buildSwap).mockResolvedValue({ to: ONEINCH_ROUTER, data: '0x1inc', value: '0', minOut: 1n });
    expect((await settle(buy())).venue).toBe('1inch');
  });

  it('routes a token no Uniswap pool reaches through 1inch alone, and refuses it with no 1inch', async () => {
    await expect(settle(buy({ outSymbol: 'NVDAc' }))).rejects.toThrow(/No route for USDC -> NVDAc/);
    expect(uniswap.buildSwap).not.toHaveBeenCalled();

    inch.configured = true;
    vi.mocked(oneinch.buildSwap).mockResolvedValue({ to: ONEINCH_ROUTER, data: '0x1inc', value: '0', minOut: 5n });
    expect(await settle(buy({ outSymbol: 'NVDAc' }))).toMatchObject({ venue: '1inch', floor: { minOut: 5n } });
  });

  it('says why Uniswap refused when nothing else can serve the leg', async () => {
    vi.mocked(uniswap.buildSwap).mockRejectedValue(new Error('No liquidity for USDC -> WETH at this size'));
    await expect(settle(buy())).rejects.toThrow('No liquidity for USDC -> WETH at this size');
  });

  it('on a fork, holds 1inch to what its route delivers THERE, less the tolerance — never to its live quote', async () => {
    inch.configured = true;
    fork.drifts = true;
    // 1inch promises more than Uniswap, priced against the live chain…
    vi.mocked(oneinch.buildSwap).mockResolvedValue({ to: ONEINCH_ROUTER, data: '0x1inc', value: '0', minOut: 41_000_000_000_000_000n });
    // …and delivers less on the fork than Uniswap's floor.
    vi.mocked(deliveredOnChain).mockResolvedValue(39_000_000_000_000_000n);
    expect((await settle(buy())).venue).toBe('uniswap-v3');
    expect(deliveredOnChain).toHaveBeenCalledWith(
      expect.objectContaining({ owner: OWNER, via: 'spend', venue: ONEINCH_ROUTER, amount: 100_000_000n, tokenOut: WETH }),
    );

    // Where it does deliver more there, its floor is that delivery less the tolerance (0.63%).
    vi.mocked(deliveredOnChain).mockResolvedValue(40_500_000_000_000_000n);
    const s = await settle(buy());
    expect(s.venue).toBe('1inch');
    expect(s.floor.minOut).toBe((40_500_000_000_000_000n * 993_700n) / 1_000_000n);

    // A route the fork cannot run is not a candidate.
    vi.mocked(deliveredOnChain).mockRejectedValue(new Error('VenueCallFailed'));
    expect((await settle(buy())).venue).toBe('uniswap-v3');
  });
});
