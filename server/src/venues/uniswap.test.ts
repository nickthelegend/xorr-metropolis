/**
 * Uniswap v3, with the quoter stood in for (2026-09-23): the paths it considers, the one it picks, and the calldata it
 * builds — SwapRouter02 `exactInput` along the winning path, paying the OWNER, with a floor of the quote less the
 * tolerance. Loaded as an Arbitrum One fork executor would load it, so the registry is Arbitrum's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeAbiParameters, decodeFunctionData, type Hex, type PublicClient } from 'viem';

vi.mock('../db/index.js', () => ({ query: vi.fn(async () => []) }));

const OWNER = '0x95A0b368588713011a15f4b1041423f31B08e615';
const DELEGATION = '0x649b0005b07e43a2ea3a30a458ea1d9cce420f53';
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const ARB = '0x912CE59144191C1204E64559FE8253a0e49E6548';
const GMX = '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a';

/** Uniswap's packed path back into tokens and fees. */
function decodePath(path: Hex): { tokens: string[]; fees: number[] } {
  const hex = path.slice(2);
  const tokens: string[] = [];
  const fees: number[] = [];
  let i = 0;
  while (i < hex.length) {
    tokens.push(`0x${hex.slice(i, i + 40)}`.toLowerCase());
    i += 40;
    if (i < hex.length) {
      fees.push(parseInt(hex.slice(i, i + 6), 16));
      i += 6;
    }
  }
  return { tokens, fees };
}

/** A quoter that answers per path: `answers[key]` (tokens joined by `>` then `|` fees) or reverts. */
function quoter(answers: Record<string, bigint>) {
  const calls: string[] = [];
  const client = {
    getCode: vi.fn(async () => '0x6080' as Hex),
    simulateContract: vi.fn(async (args: { args: [Hex, bigint] }) => {
      const { tokens, fees } = decodePath(args.args[0]);
      const key = `${tokens.join('>')}|${fees.join(',')}`;
      calls.push(key);
      const out = answers[key];
      if (out === undefined) throw new Error(`no pool for ${key}`);
      return { result: [out, [], [], 120_000n] };
    }),
  };
  return { client: client as unknown as PublicClient, calls };
}
const k = (tokens: string[], fees: number[]) => `${tokens.map((t) => t.toLowerCase()).join('>')}|${fees.join(',')}`;

async function load() {
  vi.resetModules();
  vi.stubEnv('XORR_CHAIN', 'arbitrum-fork');
  vi.stubEnv('ONEINCH_API_KEY', '');
  return import('./uniswap.js');
}

beforeEach(() => vi.unstubAllEnvs());
afterEach(() => vi.unstubAllEnvs());

describe('the paths considered', () => {
  it('joins each side’s hops to USDC and collapses a detour that comes straight back', async () => {
    const { routeBetween } = await load();
    expect(routeBetween('USDC', 'WETH')).toEqual({ tokens: ['USDC', 'WETH'], fees: [500] });
    expect(routeBetween('USDC', 'ARB')).toEqual({ tokens: ['USDC', 'WETH', 'ARB'], fees: [500, 500] });
    // ARB → WETH → USDC → WETH → GMX is ARB → WETH → GMX.
    expect(routeBetween('ARB', 'GMX')).toEqual({ tokens: ['ARB', 'WETH', 'GMX'], fees: [500, 10000] });
    expect(routeBetween('WETH', 'USDC')).toEqual({ tokens: ['WETH', 'USDC'], fees: [500] });
  });

  it('adds the pair directly at every fee tier, once each', async () => {
    const { candidateRoutes } = await load();
    const keys = candidateRoutes('USDC', 'WETH').map((r) => `${r.tokens.join('>')}|${r.fees.join(',')}`);
    expect(keys).toEqual(['USDC>WETH|500', 'USDC>WETH|100', 'USDC>WETH|3000', 'USDC>WETH|10000']);
  });

  it('refuses a token no Uniswap pool reaches (USDG on Arbitrum), naming it', async () => {
    const { candidateRoutes, routeBetween } = await load();
    expect(() => routeBetween('USDC', 'USDG')).toThrow('USDG has no Uniswap v3 pool with liquidity on arbitrum-fork');
    expect(() => candidateRoutes('USDC', 'USDG')).toThrow('USDG has no Uniswap v3 pool');
    expect(() => candidateRoutes('USDC', 'USDC')).toThrow('same token');
  });
});

describe('the route chosen', () => {
  it('is the candidate that delivers the most; a pool that reverts is simply not one', async () => {
    const u = await load();
    const q = quoter({
      [k([USDC, WETH, ARB], [500, 500])]: 60_000_000_000_000_000_000n,
      [k([USDC, ARB], [3000])]: 61_000_000_000_000_000_000n,
      [k([USDC, ARB], [500])]: 59_000_000_000_000_000_000n,
    });
    u.setQuoteClientForTests(q.client);
    const best = await u.bestRoute('USDC', 'ARB', 20_000_000n);
    expect(best.route).toEqual({ tokens: ['USDC', 'ARB'], fees: [3000] });
    expect(best.amountOut).toBe(61_000_000_000_000_000_000n);
    // Every candidate was asked: the registry path and the four direct tiers.
    expect(q.calls).toHaveLength(5);
  });

  it('says which pair has no liquidity when nothing quotes', async () => {
    const u = await load();
    u.setQuoteClientForTests(quoter({}).client);
    await expect(u.bestRoute('USDC', 'WETH', 1_000_000n)).rejects.toThrow(/No liquidity for USDC -> WETH at this size on arbitrum-fork/);
  });

  it('says the chain did not answer — never "no liquidity" — when every quote timed out, after asking once more', async () => {
    const u = await load();
    const q = quoter({});
    q.client.simulateContract = vi.fn(async () => {
      throw new Error('The request took too long to respond.');
    }) as unknown as PublicClient['simulateContract'];
    u.setQuoteClientForTests(q.client);
    const err = await u.bestRoute('USDC', 'WETH', 1_000_000n).catch((e: Error) => e);
    expect(String(err)).toMatch(/Could not price USDC -> WETH on arbitrum-fork: the chain did not answer in time, twice/);
    expect(String(err)).not.toMatch(/No liquidity/);
    // Every candidate asked twice: the first pass and the one retry.
    const perPass = vi.mocked(q.client.simulateContract).mock.calls.length / 2;
    expect(Number.isInteger(perPass) && perPass > 0).toBe(true);
  });

  it('prices from the retry when the one route with a pool timed out the first time', async () => {
    const u = await load();
    const pool = k([USDC, WETH], [500]);
    const q = quoter({ [pool]: 7_000_000_000_000_000n });
    const real = q.client.simulateContract as unknown as (a: { args: [Hex, bigint] }) => Promise<unknown>;
    let slowOnce = true;
    q.client.simulateContract = vi.fn(async (args: { args: [Hex, bigint] }) => {
      const { tokens, fees } = decodePath(args.args[0]);
      if (slowOnce && `${tokens.join('>')}|${fees.join(',')}` === pool) {
        slowOnce = false;
        throw new Error('The request took too long to respond.');
      }
      return real(args);
    }) as unknown as PublicClient['simulateContract'];
    u.setQuoteClientForTests(q.client);
    const best = await u.bestRoute('USDC', 'WETH', 1_000_000n);
    expect(best.amountOut).toBe(7_000_000_000_000_000n);
    expect(best.route).toEqual({ tokens: ['USDC', 'WETH'], fees: [500] });
  });

  it('quotes in whole units, the path it took, and no invented impact when asked for none', async () => {
    const u = await load();
    u.setQuoteClientForTests(quoter({ [k([USDC, WETH], [500])]: 7_265_805_651_930_385n }).client);
    const q = await u.quote({ inSymbol: 'usdc', outSymbol: 'weth', amount: 20, skipPriceImpact: true });
    expect(q).toMatchObject({
      inSymbol: 'USDC',
      outSymbol: 'WETH',
      inAmount: 20,
      outAmount: 0.007265805651930385,
      venues: ['Uniswap v3'],
      priceImpactPct: null,
      estimatedGas: 120_000,
      path: { tokens: ['USDC', 'WETH'], fees: [500] },
    });
  });
});

describe('the swap built', () => {
  it('is SwapRouter02 exactInput along the winning path, paying the owner, floored at the quote less the tolerance', async () => {
    const u = await load();
    u.setQuoteClientForTests(
      quoter({
        [k([USDC, WETH], [500])]: 10_000_000_000_000_000n,
        [k([USDC, WETH], [3000])]: 9_900_000_000_000_000n,
      }).client,
    );
    const s = await u.buildSwap({ inSymbol: 'USDC', outSymbol: 'WETH', amount: 20, from: DELEGATION, receiver: OWNER, slippagePct: 0.5 });
    expect(s.to).toBe('0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45');
    expect(s.minOut).toBe(9_950_000_000_000_000n);
    const call = decodeFunctionData({ abi: u.ROUTER_ABI, data: s.data });
    expect(call.functionName).toBe('exactInput');
    const [params] = call.args as readonly [{ path: Hex; recipient: string; amountIn: bigint; amountOutMinimum: bigint }];
    expect(params.recipient).toBe(OWNER);
    expect(params.amountIn).toBe(20_000_000n);
    expect(params.amountOutMinimum).toBe(9_950_000_000_000_000n);
    expect(decodePath(params.path)).toEqual({ tokens: [USDC.toLowerCase(), WETH.toLowerCase()], fees: [500] });
  });

  it('sends the exact raw amount it is handed — a whole balance — not a float of it', async () => {
    const u = await load();
    u.setQuoteClientForTests(quoter({ [k([GMX, WETH, USDC], [10000, 500])]: 30_000_000n }).client);
    const s = await u.buildSwap({
      inSymbol: 'GMX',
      outSymbol: 'USDC',
      amount: 1.2345678901234567,
      amountRaw: 1_234_567_890_123_456_789n,
      from: DELEGATION,
      receiver: OWNER,
    });
    const [params] = decodeFunctionData({ abi: u.ROUTER_ABI, data: s.data }).args as readonly [{ amountIn: bigint }];
    expect(params.amountIn).toBe(1_234_567_890_123_456_789n);
  });

  it('refuses a route that would deliver nothing once the tolerance is taken', async () => {
    const u = await load();
    u.setQuoteClientForTests(quoter({ [k([USDC, WETH], [500])]: 1n }).client);
    await expect(u.buildSwap({ inSymbol: 'USDC', outSymbol: 'WETH', amount: 1, from: DELEGATION, receiver: OWNER })).rejects.toThrow(
      'delivers nothing',
    );
  });

  it('scales decimals through a string, not a float', async () => {
    const { scale } = await load();
    expect(scale(0.1, 18)).toBe(100_000_000_000_000_000n);
    expect(scale(50, 6)).toBe(50_000_000n);
    expect(decodeAbiParameters([{ type: 'uint256' }], `0x${scale(1, 18).toString(16).padStart(64, '0')}`)[0]).toBe(10n ** 18n);
  });
});
