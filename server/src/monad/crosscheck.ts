/**
 * One asset priced three independent ways on Monad, and how far apart they are (PLAN.md P2.2, 2026-09-24).
 *
 *   - **Uniswap v3** — what $100 of USDC actually buys through QuoterV2 on the pool a fill would use, with the pool's fee
 *     taken back out so it compares with a mid (the fee is a cost, not a price disagreement).
 *   - **Kuru** — the mid of the on-chain order book's best bid and ask.
 *   - **Chainlink** — the aggregated feed.
 *
 * Every source is read from Monad mainnet (`mainnet.ts`). The result names each source's number and the widest gap
 * between any two, in basis points; the risk gate and the council read the gap and the reasons, never a blended price.
 * A source that did not answer is listed with its error, and the gap is taken over the sources that did.
 */
import { parseAbi, type PublicClient } from 'viem';
import { readFeed, type FeedReading } from './chainlink.js';
import { readBook, type KuruBook } from './kuru.js';
import { monadMainnet } from './mainnet.js';

const QUOTER_V2 = '0x661e93cca42afacb172121ef892830ca3b70f08d';
const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
const WMON = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';
/** The WMON/USDC pool fills go through: 0.3%, the deep one (`venues/tokens.ts`). */
const MON_POOL_FEE = 3000;
const PROBE_USDC = 100;

const QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);

export type Source<T> = { ok: true; price: number; detail: T } | { ok: false; error: string };

export type MonCrosscheck = {
  symbol: 'MON';
  uniswap: Source<{ pool: string; feeBps: number; probeUsd: number }>;
  kuru: Source<KuruBook>;
  chainlink: Source<FeedReading>;
  /** The widest gap between any two sources that answered, in bps of the lower; null with fewer than two. */
  maxGapBps: number | null;
  readAt: string;
};

async function settle<T>(p: Promise<{ price: number; detail: T }>): Promise<Source<T>> {
  try {
    const r = await p;
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.split('\n')[0]! : String(e) };
  }
}

export function maxGapBps(prices: number[]): number | null {
  if (prices.length < 2) return null;
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return lo > 0 ? ((hi - lo) / lo) * 10_000 : null;
}

async function uniswapMon(client: PublicClient) {
  const amountIn = BigInt(PROBE_USDC) * 10n ** 6n;
  const { result } = await client.simulateContract({
    address: QUOTER_V2,
    abi: QUOTER_ABI,
    functionName: 'quoteExactInputSingle',
    args: [{ tokenIn: USDC, tokenOut: WMON, amountIn, fee: MON_POOL_FEE, sqrtPriceLimitX96: 0n }],
  });
  const monOut = Number(result[0]) / 1e18;
  if (!(monOut > 0)) throw new Error('QuoterV2 answered no MON for $100');
  // What was paid for the MON, less the pool's fee: the price the pool itself quotes.
  const price = (PROBE_USDC * (1 - MON_POOL_FEE / 1_000_000)) / monOut;
  return { price, detail: { pool: `WMON/USDC ${MON_POOL_FEE / 10_000}%`, feeBps: MON_POOL_FEE / 100, probeUsd: PROBE_USDC } };
}

/** MON priced by Uniswap v3, Kuru and Chainlink on Monad mainnet, and the widest gap between them. */
export async function crosscheckMon(client: PublicClient = monadMainnet()): Promise<MonCrosscheck> {
  const [uniswap, kuru, chainlink] = await Promise.all([
    settle(uniswapMon(client)),
    settle(
      readBook('MON/USDC', client).then((b) => {
        if (b.mid === null) throw new Error('the Kuru MON/USDC book has an empty side');
        return { price: b.mid, detail: b };
      }),
    ),
    settle(
      readFeed('MON', { client }).then((f) => {
        if (f.stale) throw new Error(`Chainlink MON/USD is ${f.ageSec}s old`);
        return { price: f.price, detail: f };
      }),
    ),
  ]);
  const prices = [uniswap, kuru, chainlink].flatMap((s) => (s.ok ? [s.price] : []));
  return { symbol: 'MON', uniswap, kuru, chainlink, maxGapBps: maxGapBps(prices), readAt: new Date().toISOString() };
}
