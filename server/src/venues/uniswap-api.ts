/**
 * Uniswap's Trading API — quote, then calldata — for Arbitrum One (42161) and Robinhood Chain (4663) (PLAN.md P1.5/P2.2).
 *
 * The on-chain v3 venue (`uniswap.ts`: QuoterV2 + SwapRouter02) needs no key and is what the executor settles through
 * today. This client is the API path the owner asked for: one integration that routes across Uniswap v2/v3/v4 on both
 * chains. It is dark until `UNISWAP_API_KEY` exists (developers.uniswap.org/dashboard) — checked 2026-09-23: without a
 * key `/quote` answers `401 Unauthenticated api key`, and no key exists in this repo's environment.
 *
 * Two constraints shape how the executor may use it:
 *   - The swapper is `XorrDelegation` (it holds the owner's tokens only for the length of `spend()`), a contract that cannot
 *     sign a Permit2 message. So quotes ask for `x-permit2-disabled: true`, which returns calldata for Uniswap's proxy that
 *     takes a plain ERC-20 approval — the approval `spend()` already gives, for exactly the amount, reset after.
 *   - Only AMM routing (`protocols: V2,V3,V4`): a UniswapX order is filled later by a third party, which `spend()`'s
 *     same-transaction output check cannot see.
 * Arbitrum Sepolia (421614) is not a chain the API supports.
 *
 * Shapes follow the published OpenAPI spec (trade-api.gateway.uniswap.org/v1/api.json).
 */
import type { Address, Hex } from 'viem';

export const UNISWAP_API = process.env.UNISWAP_API_URL ?? 'https://trade-api.gateway.uniswap.org/v1';
export const UNIVERSAL_ROUTER_VERSION = '2.1.2';
export const SUPPORTED_CHAINS = [42161, 4663] as const;

export function uniswapApiConfigured(): boolean {
  return !!process.env.UNISWAP_API_KEY;
}

export class UniswapApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'UniswapApiError';
  }
}

export type ClassicQuote = {
  routing: 'CLASSIC';
  requestId: string;
  quote: {
    input: { amount: string; token: Address };
    output: { amount: string; token: Address; recipient?: Address; minimumAmount?: string };
    swapper: Address;
    chainId: number;
    slippage: number;
    tradeType: 'EXACT_INPUT' | 'EXACT_OUTPUT';
    gasFeeUSD?: string;
    priceImpact?: number;
    routeString?: string;
    quoteId?: string;
    blockNumber?: string;
  };
  permitData: null;
};

async function call<T>(path: string, body: unknown): Promise<T> {
  const key = process.env.UNISWAP_API_KEY;
  if (!key) throw new UniswapApiError(0, 'no_key', 'UNISWAP_API_KEY is not set; the Trading API is not used on this executor.');
  const res = await fetch(`${UNISWAP_API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-api-key': key,
      'x-universal-router-version': UNIVERSAL_ROUTER_VERSION,
      'x-permit2-disabled': 'true',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { errorCode?: string; detail?: string } & T;
  if (!res.ok) throw new UniswapApiError(res.status, json.errorCode ?? 'error', json.detail ?? `${res.status} from ${path}`);
  return json;
}

/** An exact-input AMM quote for `swapper`, with the slippage `spend()` will hold the output to. */
export async function apiQuote(p: {
  chainId: (typeof SUPPORTED_CHAINS)[number];
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  swapper: Address;
  slippagePct: number;
}): Promise<ClassicQuote> {
  const q = await call<ClassicQuote | { routing: string }>('/quote', {
    type: 'EXACT_INPUT',
    amount: p.amountIn.toString(),
    tokenInChainId: p.chainId,
    tokenOutChainId: p.chainId,
    tokenIn: p.tokenIn,
    tokenOut: p.tokenOut,
    swapper: p.swapper,
    slippageTolerance: p.slippagePct,
    routingPreference: 'BEST_PRICE',
    protocols: ['V2', 'V3', 'V4'],
  });
  if (q.routing !== 'CLASSIC') throw new UniswapApiError(200, 'not_classic', `The API routed this as ${q.routing}; only AMM routes settle inside spend().`);
  return q as ClassicQuote;
}

/** The transaction for a quote: `to` is the router the delegation must allowlist, `data` what `spend()` forwards. */
export async function apiSwap(quote: ClassicQuote): Promise<{ to: Address; data: Hex; value: bigint }> {
  const r = await call<{ swap: { to: Address; data: Hex; value?: string } }>('/swap', { quote: quote.quote, simulateTransaction: false });
  if (!r.swap?.data || r.swap.data === '0x') throw new UniswapApiError(200, 'empty_calldata', 'The API returned an empty swap.');
  return { to: r.swap.to, data: r.swap.data, value: BigInt(r.swap.value ?? '0') };
}
