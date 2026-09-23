/**
 * Uniswap v3 — the venue every xorr trade settles through on Arbitrum One and Robinhood Chain (2026-09-23, ported from
 * the X Layer build's `venues/uniswap.ts`).
 *
 * Two jobs, with the signatures the 1inch client had so the executor's callers did not change:
 *
 *   `quote`     — what the person is shown before they commit. QuoterV2 `quoteExactInput`, read with `eth_call`.
 *   `buildSwap` — the calldata `XorrDelegation` forwards: SwapRouter02 `exactInput`, paying the OWNER (never the contract,
 *                 which must hold nothing between trades), with an output floor — the quote less the tolerance — that the
 *                 contract also enforces against the owner's own balance.
 *
 * **Best fee tier / path.** Every pair is quoted along its registry path (each token's hops to the settlement token,
 * joined, with a detour through the settlement token collapsed) AND directly at each of the four fee tiers; the one that
 * delivers the most is the route. A pool that does not exist makes its candidate revert, which just removes it.
 *
 * **Where a quote is read.** From the chain the executor settles on when it has Uniswap (a mainnet or a fork of it — a
 * fork's pools are the fork's own state, so the price quoted is the price a fill gets there). On a testnet, from the
 * mainnet it stands in for: prices are real there and nothing settles (`CAN_SETTLE`).
 *
 * **A fork without the quoter.** The hosted Robinhood Chain node serves a state snapshot that holds the router and the
 * pools but not QuoterV2 (measured 2026-09-23). QuoterV2 is stateless — its only state is two immutables in its code — so
 * when the settlement chain has no code at the quoter address, the quote is run with the mainnet quoter's bytecode placed
 * there by an `eth_call` state override: the canonical contract, against the fork's own pools, and nothing written.
 */
import { createPublicClient, encodeFunctionData, encodePacked, http, parseAbi, type Address, type Hex, type PublicClient } from 'viem';
import { CHAIN_KEY, IS_MONAD, IS_ROBINHOOD, UNISWAP, UNISWAP_QUOTE_CHAIN } from '../evm/chains.js';
import {
  CAN_SETTLE,
  DEFAULT_SLIPPAGE_PCT,
  SETTLEMENT_SYMBOL,
  TOKENS,
  canonicalSymbol,
  routeLabel,
  type SwapCalldata,
  type SwapQuote,
} from './tokens.js';

export type { SwapCalldata, SwapQuote } from './tokens.js';

export const VENUE_NAME = 'Uniswap v3';

export const FEE_TIERS = [100, 500, 3000, 10000] as const;

const QUOTER_ABI = parseAbi([
  'function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
]);

/** SwapRouter02's `exactInput` — no deadline in this router's struct; the contract's floor and the tx bound the trade. */
export const ROUTER_ABI = parseAbi([
  'struct ExactInputParams { bytes path; address recipient; uint256 amountIn; uint256 amountOutMinimum; }',
  'function exactInput(ExactInputParams params) payable returns (uint256 amountOut)',
]);

export type Route = { tokens: string[]; fees: number[] };

// ── clients ─────────────────────────────────────────────────────────────────────────────────────

let mainnetClient: PublicClient | undefined;
let settlementClient: PublicClient | undefined;

/** Tests (and nothing else) swap the client quotes are read from. */
export function setQuoteClientForTests(c: PublicClient | undefined): void {
  settlementClient = c;
  mainnetClient = c;
  quoterCode = undefined;
}

async function client(): Promise<{ c: PublicClient; quoter: Address }> {
  if (UNISWAP) {
    settlementClient ??= (await import('../evm/client.js')).publicClient as PublicClient;
    return { c: settlementClient, quoter: UNISWAP.quoter };
  }
  const q = UNISWAP_QUOTE_CHAIN!;
  mainnetClient ??= createPublicClient({ chain: q.chain, transport: http(q.rpc, { timeout: 10_000, retryCount: 2 }) }) as PublicClient;
  return { c: mainnetClient, quoter: q.uniswap.quoter };
}

/**
 * The quoter's code override, when the settlement chain has no code at the quoter address (see the file header).
 * `undefined` until asked; `null` when the chain has its own quoter and nothing needs overriding.
 */
let quoterCode: Promise<Hex | null> | undefined;
function quoterOverride(c: PublicClient, quoter: Address): Promise<Hex | null> {
  quoterCode ??= (async () => {
    const own = await c.getCode({ address: quoter }).catch(() => undefined);
    if (own && own !== '0x') return null;
    // The mainnet the chain is a copy of — the only place the canonical bytecode can come from.
    const rpc = IS_ROBINHOOD
      ? (process.env.ROBINHOOD_RPC ?? 'https://rpc.mainnet.chain.robinhood.com')
      : IS_MONAD
        ? (process.env.MONAD_RPC ?? 'https://rpc.monad.xyz')
        : (process.env.ARBITRUM_RPC ?? 'https://arb1.arbitrum.io/rpc');
    const code = await createPublicClient({ transport: http(rpc, { timeout: 10_000 }) }).getCode({ address: quoter });
    if (!code || code === '0x') throw new Error(`QuoterV2 ${quoter} has no code on ${CHAIN_KEY} or on its mainnet`);
    return code;
  })().catch((e) => {
    quoterCode = undefined;
    throw e;
  });
  return quoterCode;
}

// ── routes ──────────────────────────────────────────────────────────────────────────────────────

/** Tokens and fees from `from` to `to` along the registry's hops. Throws where either side has no route. */
export function routeBetween(from: string, to: string): Route {
  const a = TOKENS[from];
  const b = TOKENS[to];
  if (!a || !b) throw new Error(`No route for ${from} -> ${to}`);
  if (a.toSettlement === null) throw new Error(`No route for ${from} -> ${to}: ${from} has no Uniswap v3 pool with liquidity on ${CHAIN_KEY}`);
  if (b.toSettlement === null) throw new Error(`No route for ${from} -> ${to}: ${to} has no Uniswap v3 pool with liquidity on ${CHAIN_KEY}`);

  const tokens = [from, ...a.toSettlement.map((h) => h.via)];
  const fees = a.toSettlement.map((h) => h.fee);
  const back = [to, ...b.toSettlement.map((h) => h.via)].reverse();
  const backFees = b.toSettlement.map((h) => h.fee).reverse();
  tokens.push(...back.slice(1));
  fees.push(...backFees);

  // Collapse a detour that returns to where it came from: X → WETH → USDC → WETH → Y is X → WETH → Y.
  for (let i = 1; i + 1 < tokens.length; ) {
    if (tokens[i - 1] === tokens[i + 1]) {
      tokens.splice(i, 2);
      fees.splice(i - 1, 2);
      i = Math.max(1, i - 1);
    } else {
      i += 1;
    }
  }
  if (tokens.length < 2 || fees.length !== tokens.length - 1) throw new Error(`No route for ${from} -> ${to}`);
  if (tokens.length === 2 && tokens[0] === tokens[1]) throw new Error(`No route for ${from} -> ${to}: same token`);
  return { tokens, fees };
}

/**
 * Every path worth quoting for this pair: the registry's, and the pair directly at each fee tier. Deduplicated. Throws
 * only where there is no candidate at all.
 */
export function candidateRoutes(from: string, to: string): Route[] {
  if (from === to) throw new Error(`No route for ${from} -> ${to}: same token`);
  if (!TOKENS[from] || !TOKENS[to]) throw new Error(`No route for ${from} -> ${to}`);
  const out: Route[] = [];
  let registryError: unknown;
  try {
    out.push(routeBetween(from, to));
  } catch (e) {
    registryError = e;
  }
  // A direct pool is only tried between tokens the registry routes: a token marked unroutable is one with no pool worth
  // using, and trying its tiers would quote dust pools.
  if (TOKENS[from]!.toSettlement !== null && TOKENS[to]!.toSettlement !== null) {
    for (const fee of FEE_TIERS) out.push({ tokens: [from, to], fees: [fee] });
  }
  const seen = new Set<string>();
  const unique = out.filter((r) => {
    const k = `${r.tokens.join('>')}|${r.fees.join(',')}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length === 0) throw registryError instanceof Error ? registryError : new Error(`No route for ${from} -> ${to}`);
  return unique;
}

/** Uniswap's packed path: token, fee, token, fee, token… */
export function encodePath(route: Route): Hex {
  const types: ('address' | 'uint24')[] = [];
  const values: (Address | number)[] = [];
  route.tokens.forEach((sym, i) => {
    types.push('address');
    values.push(TOKENS[sym]!.address);
    if (i < route.fees.length) {
      types.push('uint24');
      values.push(route.fees[i]!);
    }
  });
  return encodePacked(types, values);
}

/**
 * A decimal amount into raw units, through its shortest decimal string: `amount * 10 ** 18` loses precision past 2^53,
 * and `toFixed(18)` prints the binary float — 0.1 as 0.100000000000000006 — six wei nobody asked for. `String(0.1)` is
 * "0.1". Digits past the token's decimals are cut, never rounded up.
 */
export function scale(amount: number, decimals: number): bigint {
  const text = /e/i.test(String(amount)) ? amount.toFixed(Math.min(decimals, 100)) : String(amount);
  const [whole, frac = ''] = text.split('.');
  return BigInt((whole === '-0' ? '0' : whole!) + frac.padEnd(decimals, '0').slice(0, decimals));
}
function unscale(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

async function quoteRaw(path: Hex, amountIn: bigint): Promise<{ amountOut: bigint; gasEstimate: bigint }> {
  const { c, quoter } = await client();
  const code = UNISWAP ? await quoterOverride(c, quoter) : null;
  const { result } = await c.simulateContract({
    address: quoter,
    abi: QUOTER_ABI,
    functionName: 'quoteExactInput',
    args: [path, amountIn],
    ...(code ? { stateOverride: [{ address: quoter, code }] } : {}),
  });
  return { amountOut: result[0], gasEstimate: result[3] };
}

/** One named route, quoted — for a caller that must price exactly the pool a fill will use (the stock guard). */
export async function quoteRoute(route: Route, amountIn: bigint): Promise<{ amountOut: bigint; gasEstimate: bigint }> {
  return quoteRaw(encodePath(route), amountIn);
}

export type BestRoute = { route: Route; path: Hex; amountOut: bigint; gasEstimate: bigint };

/**
 * The candidate that delivers the most for `amountIn`, quoted in parallel. Throws, naming the pair, when none quotes —
 * the first candidate's own error is kept, since it is usually the one that says why (no pool, no liquidity).
 */
export async function bestRoute(from: string, to: string, amountIn: bigint): Promise<BestRoute> {
  const routes = candidateRoutes(from, to);
  const results = await Promise.all(
    routes.map(async (route) => {
      const path = encodePath(route);
      try {
        const q = await quoteRaw(path, amountIn);
        return { route, path, ...q };
      } catch (e) {
        return { route, path, error: e };
      }
    }),
  );
  let best: BestRoute | undefined;
  for (const r of results) {
    if ('error' in r || r.amountOut <= 0n) continue;
    if (!best || r.amountOut > best.amountOut) best = { route: r.route, path: r.path, amountOut: r.amountOut, gasEstimate: r.gasEstimate };
  }
  if (!best) {
    const first = results.find((r) => 'error' in r) as { error?: unknown } | undefined;
    const why = first?.error instanceof Error ? first.error.message.split('\n')[0] : 'no pool delivered anything';
    throw new Error(`No liquidity for ${from} -> ${to} at this size on ${CHAIN_KEY} (${why})`);
  }
  return best;
}

/** "Uniswap v3 USDG→NVDA 0.05%", or the hops joined for a multi-hop path. */
export function describeRoute(route: Route): string {
  return route.tokens.length > 2 ? `${VENUE_NAME} via ${route.tokens.slice(1, -1).join(', ')}` : VENUE_NAME;
}

export async function quote(params: {
  inSymbol: string;
  outSymbol: string;
  amount: number;
  slippagePct?: number;
  /** Skip the price-impact cross-check — what makes this quote safe to call FROM a price (see `stocks.ts`). */
  skipPriceImpact?: boolean;
}): Promise<SwapQuote> {
  const inSymbol = canonicalSymbol(params.inSymbol);
  const outSymbol = canonicalSymbol(params.outSymbol);
  const from = TOKENS[inSymbol];
  const to = TOKENS[outSymbol];
  if (!from || !to) throw new Error(`No route for ${params.inSymbol} -> ${params.outSymbol}`);
  if (!(params.amount > 0)) throw new Error('A quote needs an amount above zero');

  const slippagePct = params.slippagePct ?? DEFAULT_SLIPPAGE_PCT;
  const best = await bestRoute(inSymbol, outSymbol, scale(params.amount, from.decimals));
  const outAmount = unscale(best.amountOut, to.decimals);
  const venues = [VENUE_NAME];

  return {
    priceImpactPct: params.skipPriceImpact ? null : await priceImpact(inSymbol, outSymbol, params.amount, outAmount),
    inSymbol,
    outSymbol,
    inAmount: params.amount,
    outAmount,
    minimumOut: outAmount * (1 - slippagePct / 100),
    slippagePct,
    venues,
    estimatedGas: best.gasEstimate > 0n ? Number(best.gasEstimate) : undefined,
    route: best.route.tokens.length > 2 ? describeRoute(best.route) : routeLabel(venues),
    path: best.route,
  };
}

/**
 * Price impact, measured rather than asserted: the gap between the rate this size gets and the market's mid from the
 * same feed every screen uses. Where either leg has no independent price the answer is `null` — returning 0 would claim
 * a free trade. The settlement token is a dollar by definition here.
 */
async function priceImpact(inSymbol: string, outSymbol: string, inAmount: number, outAmount: number): Promise<number | null> {
  if (!(inAmount > 0) || !(outAmount > 0)) return null;
  const { priceOf } = await import('../market/prices.js');
  const usd = (s: string) => (s === SETTLEMENT_SYMBOL ? Promise.resolve(1) : priceOf(s, 4_000).catch(() => 0));
  const [inUsd, outUsd] = await Promise.all([usd(inSymbol), usd(outSymbol)]);
  if (!(inUsd > 0) || !(outUsd > 0)) return null;
  const atMid = (inAmount * inUsd) / outUsd;
  if (!(atMid > 0)) return null;
  const impact = ((atMid - outAmount) / atMid) * 100;
  return Number.isFinite(impact) ? Math.max(0, impact) : null;
}

/** `amount` less `pct` percent, rounded down to a whole raw unit. */
export function lessPct(amount: bigint, pct: number): bigint {
  return (amount * BigInt(Math.floor((1 - pct / 100) * 1_000_000))) / 1_000_000n;
}

/**
 * The calldata for a real swap.
 *
 * `from` is the address holding the tokens when it executes — the delegation contract, which pulls the owner's funds and
 * calls the router in one transaction, having approved the router for exactly this amount. `receiver` is where the bought
 * tokens land, and it is the OWNER: the router pays `recipient`, so nothing piles up in the contract.
 */
export async function buildSwap(params: {
  inSymbol: string;
  outSymbol: string;
  amount: number;
  /** The exact input in the token's own units, when the caller has it from the chain — a sale of a whole balance. */
  amountRaw?: bigint;
  from: Address;
  receiver: Address;
  slippagePct?: number;
}): Promise<SwapCalldata & { route: Route; quotedOut: bigint }> {
  if (!CAN_SETTLE || !UNISWAP) {
    throw new Error(
      `Cannot fill on ${CHAIN_KEY}: this build does not settle through Uniswap there. Prices are real (quoted against ` +
        'its mainnet); settlement needs its mainnet or a fork of it.',
    );
  }
  const inSymbol = canonicalSymbol(params.inSymbol);
  const outSymbol = canonicalSymbol(params.outSymbol);
  const src = TOKENS[inSymbol];
  const dst = TOKENS[outSymbol];
  if (!src || !dst) throw new Error(`No route for ${params.inSymbol} -> ${params.outSymbol}`);

  const amountIn = params.amountRaw ?? scale(params.amount, src.decimals);
  if (amountIn <= 0n) throw new Error('A swap needs an amount above zero');
  const slippagePct = params.slippagePct ?? DEFAULT_SLIPPAGE_PCT;

  const best = await bestRoute(inSymbol, outSymbol, amountIn);
  const minOut = lessPct(best.amountOut, slippagePct);
  if (minOut <= 0n) throw new Error(`The ${inSymbol} -> ${outSymbol} route delivers nothing at this size`);

  const data = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'exactInput',
    args: [{ path: best.path, recipient: params.receiver, amountIn, amountOutMinimum: minOut }],
  });
  return { to: UNISWAP.router, data, value: '0', minOut, route: best.route, quotedOut: best.amountOut };
}
