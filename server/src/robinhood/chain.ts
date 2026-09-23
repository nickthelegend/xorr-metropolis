/**
 * On-chain reads on Robinhood Chain (4663): ERC-8056 `uiMultiplier()`, Chainlink per-token feeds,
 * the Uniswap v3 USDG pool per Stock Token, and QuoterV2 quotes.
 *
 * Read-only; nothing here signs. The RPC is the public one unless `ROBINHOOD_RPC` says otherwise —
 * it rate-limits, so reads that fan out (the catalog's pool scan) go through Multicall3 and viem's
 * transport retries 429s with backoff.
 */
import { createPublicClient, http, type Address, type PublicClient, getAddress, parseAbi } from 'viem';
import { robinhood } from 'viem/chains';
import { z } from 'zod';
import { fetchJson, TtlCache } from './http.js';

export const ROBINHOOD_RPC = process.env.ROBINHOOD_RPC || 'https://rpc.mainnet.chain.robinhood.com';

/** viem's own definition (id 4663, Blockscout, Multicall3 at the canonical address), with our RPC. */
export const robinhoodChain = {
  ...robinhood,
  rpcUrls: { default: { http: [ROBINHOOD_RPC] } },
} as const;

export const RH = {
  USDG: getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'),
  USDG_DECIMALS: 6,
  WETH: getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'),
  UNISWAP_V3_FACTORY: getAddress('0x1f7d7550b1b028f7571e69a784071f0205fd2efa'),
  QUOTER_V2: getAddress('0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7'),
  STOCK_DECIMALS: 18,
} as const;

/**
 * Calldata bytes per Multicall3 request. viem's default (1 KiB) splits the catalog's ~800-call pool
 * scan into dozens of parallel requests, which the public RPC answers with 429s; ~8 KiB keeps it to a
 * handful.
 */
export const MULTICALL_BATCH_BYTES = 8_192;

export const FEE_TIERS = [100, 500, 3000, 10000] as const;

/** Minimum USDG a pool must hold to count as funded. Env `ROBINHOOD_MIN_POOL_USDG` (whole USDG). */
export const minPoolUsdg = () => Number(process.env.ROBINHOOD_MIN_POOL_USDG ?? 1_000);

export const FEED_DIRECTORY_URL =
  process.env.ROBINHOOD_FEED_DIRECTORY ?? 'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json';

let client: PublicClient | undefined;
export function robinhoodClient(): PublicClient {
  client ??= createPublicClient({
    chain: robinhoodChain,
    transport: http(ROBINHOOD_RPC, { timeout: 10_000, retryCount: 4, retryDelay: 300 }),
    batch: { multicall: { wait: 16 } },
  }) as PublicClient;
  return client;
}

/** Tests (and nothing else) swap the client for a stub. */
export function setRobinhoodClient(c: PublicClient | undefined): void {
  client = c;
  clearChainCaches();
}

export const stockTokenAbi = parseAbi([
  'function uiMultiplier() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);
export const aggregatorV3Abi = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
]);
export const factoryAbi = parseAbi(['function getPool(address,address,uint24) view returns (address)']);
export const quoterV2Abi = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);

const multiplierCache = new TtlCache<bigint>(60_000);
const feedDirCache = new TtlCache<Map<string, FeedInfo>>(3_600_000);
const poolCache = new TtlCache<UsdgPool | null>(60_000);
const priceCache = new TtlCache<RoundData>(15_000);

export function clearChainCaches(): void {
  multiplierCache.clear();
  feedDirCache.clear();
  poolCache.clear();
  priceCache.clear();
}

const ZERO = '0x0000000000000000000000000000000000000000';
const WAD = 10n ** 18n;

// ---------------------------------------------------------------------------------------------
// ERC-8056

/** `uiMultiplier()` as a 1e18-scaled bigint: shares per token. */
export function uiMultiplier(token: Address): Promise<bigint> {
  return multiplierCache.get(token.toLowerCase(), () =>
    robinhoodClient().readContract({ address: token, abi: stockTokenAbi, functionName: 'uiMultiplier' }),
  );
}

/** ERC-8056 holdings: raw balance and the share-equivalent `balance × uiMultiplier / 1e18`. */
export async function sharesOf(token: Address, holder: Address) {
  const [balance, multiplier] = await Promise.all([
    robinhoodClient().readContract({ address: token, abi: stockTokenAbi, functionName: 'balanceOf', args: [holder] }),
    uiMultiplier(token),
  ]);
  const shares = (balance * multiplier) / WAD;
  return { balance, multiplier, shares, sharesDisplay: Number(shares) / 1e18 };
}

// ---------------------------------------------------------------------------------------------
// Chainlink

const feedEntrySchema = z
  .object({
    name: z.string(),
    proxyAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).nullable().optional(),
    heartbeat: z.number().nullable().optional(),
    decimals: z.number().nullable().optional(),
  })
  .loose();
export const feedDirectorySchema = z.array(feedEntrySchema);

export type FeedInfo = { symbol: string; name: string; proxy: Address; heartbeatSec: number; decimals: number };

/**
 * Stock Token feeds are named "Robinhood NVDA / USD" (a few "Robinhood DELL-USD"). Only names with
 * the `Robinhood` prefix count: the directory also lists crypto feeds ("GLD / USD" is a DEX-state
 * price on crypto hours, not the ETF) and a bare ticker match would pick those up.
 */
const FEED_NAME = /^Robinhood\s+([A-Z0-9.]+)\s*(?:\/|-)\s*USD$/i;

export function mapFeedsBySymbol(entries: z.infer<typeof feedDirectorySchema>): Map<string, FeedInfo> {
  const out = new Map<string, FeedInfo>();
  for (const e of entries) {
    const m = FEED_NAME.exec(e.name.trim());
    if (!m?.[1] || !e.proxyAddress) continue;
    const symbol = m[1].toUpperCase();
    out.set(symbol, {
      symbol,
      name: e.name,
      proxy: getAddress(e.proxyAddress),
      heartbeatSec: e.heartbeat ?? 86_400,
      decimals: e.decimals ?? 8,
    });
  }
  return out;
}

/** Chainlink's published feed list for Robinhood Chain mainnet, keyed by token symbol. */
export function feedDirectory(): Promise<Map<string, FeedInfo>> {
  return feedDirCache.get('dir', async () =>
    mapFeedsBySymbol(feedDirectorySchema.parse(await fetchJson(FEED_DIRECTORY_URL, { timeoutMs: 10_000 }))),
  );
}

export async function feedFor(symbol: string): Promise<FeedInfo | undefined> {
  return (await feedDirectory()).get(symbol.toUpperCase());
}

type RoundData = { roundId: bigint; answer: bigint; updatedAt: bigint };

export type ChainlinkPrice = {
  symbol: string;
  /** USD per TOKEN (the feed includes the ERC-8056 multiplier). */
  price: number;
  answer: bigint;
  decimals: number;
  updatedAt: Date;
  ageSec: number;
  /** Age exceeds the feed's heartbeat (or `ROBINHOOD_FEED_MAX_AGE_S` when set). */
  stale: boolean;
  maxAgeSec: number;
  feed: Address;
  roundId: bigint;
};

export function isStale(updatedAtSec: number, nowMs: number, maxAgeSec: number): boolean {
  return nowMs / 1000 - updatedAtSec > maxAgeSec;
}

export async function chainlinkPrice(symbol: string, now: Date = new Date()): Promise<ChainlinkPrice> {
  const feed = await feedFor(symbol);
  if (!feed) throw new Error(`No Chainlink feed for ${symbol} on Robinhood Chain (directory: ${FEED_DIRECTORY_URL})`);
  const r = await priceCache.get(feed.proxy, async () => {
    const [roundId, answer, , updatedAt] = await robinhoodClient().readContract({
      address: feed.proxy,
      abi: aggregatorV3Abi,
      functionName: 'latestRoundData',
    });
    return { roundId, answer, updatedAt };
  });
  if (r.answer <= 0n) throw new Error(`Chainlink ${feed.name} answered ${r.answer}`);
  const maxAgeSec = Number(process.env.ROBINHOOD_FEED_MAX_AGE_S ?? feed.heartbeatSec);
  const updated = Number(r.updatedAt);
  return {
    symbol: feed.symbol,
    price: Number(r.answer) / 10 ** feed.decimals,
    answer: r.answer,
    decimals: feed.decimals,
    updatedAt: new Date(updated * 1000),
    ageSec: Math.max(0, Math.round(now.getTime() / 1000 - updated)),
    stale: isStale(updated, now.getTime(), maxAgeSec),
    maxAgeSec,
    feed: feed.proxy,
    roundId: r.roundId,
  };
}

// ---------------------------------------------------------------------------------------------
// Uniswap v3

export type UsdgPool = { pool: Address; fee: number; usdgBalance: bigint; usdg: number };

/** Among the candidate pools, the funded one with the most USDG (null when none is funded). */
export function pickFundedPool(candidates: UsdgPool[], minUsdg = minPoolUsdg()): UsdgPool | null {
  const funded = candidates.filter((c) => c.usdg >= minUsdg).sort((a, b) => (b.usdgBalance > a.usdgBalance ? 1 : -1));
  return funded[0] ?? null;
}

/**
 * Every token's USDG pools across the fee tiers, in two multicall rounds (getPool, then balances).
 * Returns, per token (lower-cased), all existing pools — funded or not.
 */
export async function scanUsdgPools(tokens: Address[]): Promise<Map<string, UsdgPool[]>> {
  const c = robinhoodClient();
  const pairs = tokens.flatMap((token) => FEE_TIERS.map((fee) => ({ token, fee })));
  const pools = await c.multicall({
    allowFailure: true,
    batchSize: MULTICALL_BATCH_BYTES,
    contracts: pairs.map(({ token, fee }) => ({
      address: RH.UNISWAP_V3_FACTORY,
      abi: factoryAbi,
      functionName: 'getPool' as const,
      args: [token, RH.USDG, fee] as const,
    })),
  });
  const existing = pairs
    .map((p, i) => ({ ...p, pool: pools[i]?.status === 'success' ? (pools[i]!.result as Address) : undefined }))
    .filter((p): p is typeof p & { pool: Address } => !!p.pool && p.pool !== ZERO);
  const balances = await c.multicall({
    allowFailure: true,
    batchSize: MULTICALL_BATCH_BYTES,
    contracts: existing.map((p) => ({
      address: RH.USDG,
      abi: stockTokenAbi,
      functionName: 'balanceOf' as const,
      args: [p.pool] as const,
    })),
  });
  const out = new Map<string, UsdgPool[]>(tokens.map((t) => [t.toLowerCase(), []]));
  existing.forEach((p, i) => {
    const b = balances[i];
    if (b?.status !== 'success') return;
    const usdgBalance = b.result as bigint;
    out.get(p.token.toLowerCase())!.push({
      pool: getAddress(p.pool),
      fee: p.fee,
      usdgBalance,
      usdg: Number(usdgBalance) / 10 ** RH.USDG_DECIMALS,
    });
  });
  return out;
}

/** The funded USDG pool with the largest USDG balance for a Stock Token, or null. */
export function poolForUsdg(token: Address): Promise<UsdgPool | null> {
  return poolCache.get(token.toLowerCase(), async () =>
    pickFundedPool((await scanUsdgPools([token])).get(token.toLowerCase()) ?? []),
  );
}

export type SwapQuote = {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  fee: number;
  pool: Address;
  gasEstimate: bigint;
  /** USDG per token implied by this quote (fee and price impact included). */
  impliedPrice: number;
};

async function quoteExactInputSingle(tokenIn: Address, tokenOut: Address, amountIn: bigint, fee: number) {
  const { result } = await robinhoodClient().simulateContract({
    address: RH.QUOTER_V2,
    abi: quoterV2Abi,
    functionName: 'quoteExactInputSingle',
    args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
  });
  const [amountOut, , , gasEstimate] = result;
  return { amountOut, gasEstimate };
}

export const usdgUnits = (usdg: number) => BigInt(Math.round(usdg * 10 ** RH.USDG_DECIMALS));
export const tokenUnits = (tokens: number) => BigInt(Math.round(tokens * 1e9)) * 10n ** 9n;

/** Quote spending `usdg` (whole USDG, e.g. 50) on `token` in its best funded pool. */
export async function quoteUsdgToToken(token: Address, usdg: number, pool?: UsdgPool): Promise<SwapQuote> {
  const p = pool ?? (await poolForUsdg(token));
  if (!p) throw new Error(`No funded USDG pool for ${token}`);
  const amountIn = usdgUnits(usdg);
  const { amountOut, gasEstimate } = await quoteExactInputSingle(RH.USDG, token, amountIn, p.fee);
  const tokens = Number(amountOut) / 1e18;
  return {
    tokenIn: RH.USDG,
    tokenOut: token,
    amountIn,
    amountOut,
    fee: p.fee,
    pool: p.pool,
    gasEstimate,
    impliedPrice: tokens > 0 ? usdg / tokens : Number.POSITIVE_INFINITY,
  };
}

/** Quote selling `tokens` (whole tokens, may be fractional) of `token` for USDG. */
export async function quoteTokenToUsdg(token: Address, tokens: number, pool?: UsdgPool): Promise<SwapQuote> {
  const p = pool ?? (await poolForUsdg(token));
  if (!p) throw new Error(`No funded USDG pool for ${token}`);
  const amountIn = tokenUnits(tokens);
  const { amountOut, gasEstimate } = await quoteExactInputSingle(token, RH.USDG, amountIn, p.fee);
  const usdg = Number(amountOut) / 10 ** RH.USDG_DECIMALS;
  return {
    tokenIn: token,
    tokenOut: RH.USDG,
    amountIn,
    amountOut,
    fee: p.fee,
    pool: p.pool,
    gasEstimate,
    impliedPrice: Number(amountIn) / 1e18 > 0 ? usdg / (Number(amountIn) / 1e18) : 0,
  };
}

/** |a − b| / b in basis points. */
export function deviationBps(implied: number, reference: number): number {
  return (Math.abs(implied - reference) / reference) * 10_000;
}
