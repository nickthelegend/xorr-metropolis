/**
 * 1inch — an optional second venue next to Uniswap v3 (2026-09-23).
 *
 * It was the Base build's only venue, and it owned the token registry: this module threw at import without a 1inch key,
 * so nothing could start without a key for a venue that does not run on Robinhood Chain. The registry now lives in
 * `venues/tokens.ts` and Uniswap v3 (`venues/uniswap.ts`) settles every trade; 1inch is asked for a second quote where
 * `ONEINCH_ENABLED` says it may be (`evm/chains.ts`: never on Robinhood Chain, elsewhere only with a key), and its route
 * wins only when it delivers more (`executor/settle.ts`).
 *
 * Two endpoints, two jobs:
 *   /quote — what the user is shown BEFORE they commit. No allowance needed, no side effects.
 *   /swap  — the calldata the delegation contract forwards to the router when a trade executes.
 */
import 'dotenv/config';
import { getJson } from '../http/get.js';
import { CHAIN_KEY, ONEINCH_CHAIN_ID, ONEINCH_ENABLED } from '../evm/chains.js';
import { priceOf } from '../market/prices.js';
import { DEFAULT_SLIPPAGE_PCT, TOKENS, canonicalSymbol, routeLabel, type SwapCalldata, type SwapQuote } from './tokens.js';
import type { Address, Hex } from 'viem';

export type { SwapCalldata, SwapQuote } from './tokens.js';

const BASE = 'https://api.1inch.dev/swap/v6.0';

const API_KEY = process.env.ONEINCH_API_KEY;

/** Whether this deployment may ask 1inch at all. A call made without it fails in `authed`, naming the reason. */
export function oneinchConfigured(): boolean {
  return ONEINCH_ENABLED;
}

type QuoteResponse = {
  dstAmount: string;
  protocols?: { name: string }[][][];
  /** Present only when the request asked for it with `includeGas=true`. */
  gas?: number;
};

function scale(amount: number, decimals: number): bigint {
  return BigInt(Math.round(amount * 10 ** decimals));
}
function unscale(raw: string, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

function authed(url: string) {
  if (!API_KEY) throw new Error('ONEINCH_API_KEY is not set, so 1inch is not a venue on this deployment.');
  return getJson<QuoteResponse>(url, 15_000, 15_000, {
    Authorization: `Bearer ${API_KEY}`,
  });
}

/**
 * Any other 1inch API, with the same key, request lane and breaker as the swap API (PLAN.md 3.10–3.16).
 *
 * `path` starts at the API root — `/gas-price/v1.6/8453`, `/balance/v1.2/8453/balances/0x…` — so every call names
 * the product and the version it depends on.
 */
export function oneinchApi<T>(path: string, ttlMs = 15_000): Promise<T> {
  if (!API_KEY) return Promise.reject(new Error('ONEINCH_API_KEY is not set, so 1inch is not asked on this deployment.'));
  return getJson<T>(`https://api.1inch.dev${path}`, ttlMs, 15_000, { Authorization: `Bearer ${API_KEY}` });
}

/** Flatten 1inch's nested protocol matrix into the venue names a person would recognise. */
export function venuesFrom(protocols: QuoteResponse['protocols']): string[] {
  const names = new Set<string>();
  for (const path of protocols ?? []) {
    for (const hop of path) {
      for (const p of hop) {
        if (p?.name) names.add(prettyVenue(p.name));
      }
    }
  }
  return [...names];
}

/** "BASE_UNISWAP_V4" reads badly on a phone. */
export function prettyVenue(raw: string): string {
  return raw
    .replace(/^BASE_/, '')
    .split('_')
    .map((w) => (/^V\d$/i.test(w) ? w.toUpperCase() : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ');
}


export async function quote(params: {
  inSymbol: string;
  outSymbol: string;
  amount: number;
  slippagePct?: number;
  /**
   * Skip the price-impact cross-check, which is what makes this quote safe to call FROM a price.
   *
   * `priceImpact` prices both legs with `priceOf` to get a mid to compare against. A tokenized
   * equity has no feed, so `priceOf` derives its price from a quote — and that quote asked for its
   * impact, which priced the legs, which quoted again. The deployed executor climbed to a 2GB heap
   * and died with "Ineffective mark-compacts near heap limit" about fifty seconds after boot.
   *
   * The impact number is meaningless for that caller anyway: it is establishing what the price IS,
   * so there is no independent mid to be impacted against. Asking for it was the bug, not just the
   * recursion.
   */
  skipPriceImpact?: boolean;
}): Promise<SwapQuote> {
  /*
   * Canonicalise HERE, not at each call site.
   *
   * `canonicalSymbol` existed and was applied at some route boundaries and never at this one, so
   * every caller had to remember — and three shipped bugs in one week came from one that did not.
   * A raw `TOKENS[...]` lookup is case-sensitive and the lowercase `c` on a tokenized equity is
   * exactly what a caller loses.
   */
  const inSymbol = canonicalSymbol(params.inSymbol);
  const outSymbol = canonicalSymbol(params.outSymbol);
  const from = TOKENS[inSymbol];
  const to = TOKENS[outSymbol];
  if (!from || !to) throw new Error(`No route for ${params.inSymbol} -> ${params.outSymbol}`);

  const slippagePct = params.slippagePct ?? DEFAULT_SLIPPAGE_PCT;
  const raw = scale(params.amount, from.decimals);
  /*
   * The quote is restricted exactly as the fill is.
   *
   * It was not, and on a fork that made every quoted price a number the executor could not honour:
   * `/quote` picked the best route on real Base — for a tokenized equity, Elfomofi — while
   * `buildSwap` applied `AMM_ONLY` and got something else entirely. The app displayed one price,
   * attempted another, and reverted.
   *
   * A price is only worth showing if it is the price you would get, so both calls now ask the same
   * question. On a real network `AMM_ONLY` is empty and this is the unrestricted quote it always
   * was.
   */
  const res = await authed(
    `${BASE}/${ONEINCH_CHAIN_ID}/quote?src=${from.address}&dst=${to.address}&amount=${raw}` +
      // `includeGas` so a route can be compared NET of what it costs to send. An aggregator hop
      // through three pools is a materially more expensive transaction than a single book fill,
      // and on a small trade that difference can exceed the price difference it bought.
      `&includeProtocols=true&includeGas=true${AMM_ONLY}`,
  );

  const outAmount = unscale(res.dstAmount, to.decimals);
  const venues = venuesFrom(res.protocols);
  /*
   * The router's own gas estimate for this route, when it gave one.
   *
   * Undefined rather than a default: a route whose cost we did not get is a route we cannot
   * compare net of gas, and a stand-in number would decide that comparison silently.
   */
  const estimatedGas =
    typeof res.gas === 'number' && Number.isFinite(res.gas) && res.gas > 0 ? res.gas : undefined;

  return {
    priceImpactPct: params.skipPriceImpact
      ? null
      : await priceImpact(inSymbol, outSymbol, params.amount, outAmount),
    // The registry's spelling, not the caller's — so anything reading this back resolves.
    inSymbol,
    outSymbol,
    inAmount: params.amount,
    outAmount,
    // The floor the user is shown. 1inch applies the same bound when the swap executes.
    minimumOut: outAmount * (1 - slippagePct / 100),
    slippagePct,
    venues,
    estimatedGas,
    route: routeLabel(venues),
  };
}


/**
 * Price impact, measured rather than asserted.
 *
 * The swap screen has always had a "Price impact" row and the server has never returned the field,
 * so it read `undefined` and rendered **"NaN%"** — the client's type claimed a number the response
 * did not contain. A NaN on a trade ticket is worse than an empty row: it is a number-shaped thing
 * that is not a number.
 *
 * Impact is the gap between the rate this size actually gets and the rate the market is quoting at
 * mid, so both halves have to be real: the executed rate comes from the 1inch quote and the mid
 * from the same price feed every screen uses. Where either is unavailable — a tokenized equity has
 * no CoinGecko feed — the answer is `null` and the screen shows a dash. Returning 0 there would be
 * claiming a free trade.
 */
async function priceImpact(
  inSymbol: string,
  outSymbol: string,
  inAmount: number,
  outAmount: number,
): Promise<number | null> {
  if (!(inAmount > 0) || !(outAmount > 0)) return null;
  const [inUsd, outUsd] = await Promise.all([
    priceOf(inSymbol, 4_000).catch(() => 0),
    priceOf(outSymbol, 4_000).catch(() => 0),
  ]);
  if (!(inUsd > 0) || !(outUsd > 0)) return null;

  // What the trade should return at mid, in the output token, against what it actually returns.
  const atMid = (inAmount * inUsd) / outUsd;
  if (!(atMid > 0)) return null;
  const impact = ((atMid - outAmount) / atMid) * 100;
  // A tiny negative is the feed and the pool disagreeing by a hair, not a gift. Clamp to zero.
  return Number.isFinite(impact) ? Math.max(0, impact) : null;
}


/**
 * On a fork, ask 1inch for a plain AMM route.
 *
 * Its best route on Base normally includes a private market-maker hop, and those solvers verify
 * off-chain state that a local fork cannot reproduce — the router reverts with 0xacfdb444 before
 * touching a pool. Constraining to a single unsplit AMM path costs a few basis points and makes
 * fills genuinely executable against the forked pools. Same router, same pools, real execution;
 * only the route selection differs, so this is switched off on a real network.
 */
/**
 * On a fork, allowlist ordinary AMMs by name.
 *
 * `complexityLevel=0` constrains the route's SHAPE but not its participants, so 1inch still picked
 * a private market maker and the fill reverted before touching a pool — those solvers verify
 * off-chain state a local fork cannot reproduce. Naming the AMMs is the only reliable way to get a
 * route made entirely of contracts a fork can actually execute.
 *
 * Costs a few basis points versus the best available route. Same router, same pools, real
 * execution — only the venue selection differs, and it is off on a real network.
 */
const FORK_AMMS = [
  'BASE_UNISWAP_V2',
  'BASE_UNISWAP_V3',
  'BASE_UNISWAP_V4',
  'BASE_AERODROME',
  'BASE_AERODROME_V3',
  'BASE_AERODROME_SLIPSTREAM',
  'BASE_PANCAKESWAP_V2',
  'BASE_PANCAKESWAP_V3',
  'BASE_SUSHI_V2',
  'BASE_SUSHI_V3',
  'BASE_SOLIDLY_V3',
  'BASE_BALANCER_V2',
  'BASE_CURVE',
].join(',');

/*
 * `BASE_ELFOMOFI` is deliberately NOT here, and the reason is worth keeping.
 *
 * It is the venue that routes the tokenized equities, so adding it looks like the fix for equity
 * fills. It is not: with it in the list the revert simply changes from `TF` to `VenueCallFailed`,
 * because it is a solver whose off-chain state a local fork cannot reproduce — exactly the class
 * this allowlist exists to exclude.
 *
 * The real obstacle is one layer down. On real Base the equity tokens answer `totalSupply()` with a
 * real number despite carrying a single byte of code; on an anvil fork of the same block that call
 * REVERTS. Whatever serves them at node level is not something a fork reproduces, so no routing
 * choice can make an equity fill on a fork — the token itself is not functional there.
 *
 * Kept out, therefore, so the fork does not choose a route it definitely cannot execute in
 * preference to one it merely probably cannot.
 */

const AMM_ONLY =
  CHAIN_KEY === 'base-fork' || CHAIN_KEY === 'localnet'
    ? `&complexityLevel=0&mainRouteParts=1&parts=1&protocols=${FORK_AMMS}`
    : '';

/**
 * The router's own slippage on a fork: the most 1inch accepts — 50.01 is refused `SLIPPAGE_TOO_HIGH` (PLAN.md X77).
 *
 * The router refuses a fill that delivers less than `dstAmount` less this, and `dstAmount` is priced against live Base,
 * which a fork's pools drift away from — so on a fork the router refused trades for a price the fork never had. The
 * tolerance a trade was given still holds there: `settle.ts` measures what the route delivers on the fork and holds the
 * owner to that, less the tolerance, in the contract's own floor. On Base the router enforces the tolerance itself.
 */
export const FORK_ROUTER_SLIPPAGE_PCT = 50;
const ROUTER_DRIFTS = CHAIN_KEY === 'base-fork' || CHAIN_KEY === 'localnet' || CHAIN_KEY === 'arbitrum-fork';

/** Where a swap can actually land. Base mainnet, or a fork of it. */
const ONEINCH_CAN_SETTLE = CHAIN_KEY === 'base' || CHAIN_KEY === 'base-fork' || CHAIN_KEY === 'arbitrum' || CHAIN_KEY === 'arbitrum-fork';

/**
 * Build the calldata for a real swap.
 *
 * `from` is the address that holds the tokens at execution time — the delegation contract, because
 * it pulls the funds and calls the router inside one transaction.
 *
 * `receiver` is where the bought tokens land, and it must be the USER, not the contract. Without
 * it 1inch defaults the receiver to `from`, so every purchase would pile up inside XorrDelegation
 * and the app would be custodial in exactly the way it promises not to be. The contract should be
 * empty of user funds the moment the transaction ends.
 */
export async function buildSwap(params: {
  inSymbol: string;
  outSymbol: string;
  amount: number;
  /**
   * The exact input amount in the token's own units, when the caller has it.
   *
   * The router pulls precisely what the calldata says. Closing a whole position from `amount`
   * alone means scaling a float back to wei, which overshot a real WETH balance by 8 wei — the
   * delegation's `transferFrom` succeeded for the corrected amount and then the ROUTER reverted,
   * because the calldata was still asking for the eight it could not have. Both numbers have to
   * come from the same place, and that place is the chain.
   */
  amountRaw?: bigint;
  from: Address;
  receiver: Address;
  slippagePct?: number;
}): Promise<SwapCalldata> {
  // Quotes are a mainnet question and can be answered anywhere; a FILL cannot. On Base Sepolia
  // there is no 1inch router and none of these tokens exist, so calldata built here would be sent
  // to an address with no code and revert with nothing useful to show the user. Say what is
  // actually wrong instead, and say it before anything is signed.
  if (!ONEINCH_CAN_SETTLE) {
    throw new Error(`Cannot fill through 1inch on ${CHAIN_KEY}: it has no deployment there.`);
  }
  if (!API_KEY) throw new Error('ONEINCH_API_KEY is not set, so 1inch is not a venue on this deployment.');
  // Same rule as `quote`: resolve the casing at the venue boundary, not at every call site.
  const src = TOKENS[canonicalSymbol(params.inSymbol)];
  const dst = TOKENS[canonicalSymbol(params.outSymbol)];
  if (!src || !dst) throw new Error(`No route for ${params.inSymbol} -> ${params.outSymbol}`);

  const raw = params.amountRaw ?? scale(params.amount, src.decimals);
  const slippagePct = params.slippagePct ?? DEFAULT_SLIPPAGE_PCT;
  const res = await getJson<{ dstAmount?: string; tx: { to: Address; data: Hex; value: string } }>(
    `${BASE}/${ONEINCH_CHAIN_ID}/swap?src=${src.address}&dst=${dst.address}&amount=${raw}` +
      `&from=${params.from}&origin=${params.from}&receiver=${params.receiver}` +
      `&slippage=${ROUTER_DRIFTS ? FORK_ROUTER_SLIPPAGE_PCT : slippagePct}&disableEstimate=true${AMM_ONLY}`,
    15_000,
    15_000,
    { Authorization: `Bearer ${API_KEY}` },
  );

  // No amount, no floor — and the contract refuses a trade without one, so say it here, before
  // anything is signed, rather than as a revert afterwards.
  if (!res.dstAmount || !/^\d+$/.test(res.dstAmount)) {
    throw new Error(`1inch returned no dstAmount for ${params.inSymbol} -> ${params.outSymbol}`);
  }
  const minOut =
    (BigInt(res.dstAmount) * BigInt(Math.floor((1 - slippagePct / 100) * 1_000_000))) / 1_000_000n;
  if (minOut <= 0n) {
    throw new Error(`The ${params.inSymbol} -> ${params.outSymbol} route delivers nothing at this size`);
  }
  return { ...res.tx, minOut };
}
