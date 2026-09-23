/**
 * The tokens this executor trades, per chain, how each reaches the settlement token, and the rules every amount follows
 * (2026-09-23, ported from the X Layer build's `venues/tokens.ts`).
 *
 * This lived inside the 1inch client (`venues/oneinch.ts`) with Base addresses, and that module refused to load without a
 * 1inch key — so an Arbitrum executor quoted Base tokens against Arbitrum's 1inch and its breaker tripped at warm-up. The
 * registry is its own module now, keyed by the chain the executor settles on, and the venue that uses it is
 * `venues/uniswap.ts` (1inch is an optional second quote, `executor/settle.ts`).
 *
 *   - **Arbitrum One** (and its fork; Arbitrum Sepolia quotes against it): Circle USDC settles; WETH, WBTC, ARB and GMX
 *     route through Uniswap v3 pools read on 2026-09-23 (WETH/USDC 0.05% ≈ $21M USDC; WBTC/USDC 0.05% ≈ $4.3M; ARB/WETH
 *     0.05% ≈ 4.3M ARB; GMX/WETH 1% ≈ 278K GMX). Paxos USDG is held and shown: no v3 pool pairs it on Arbitrum.
 *   - **Robinhood Chain** (and its fork): Paxos USDG settles. The Stock Tokens are not listed here — they come from
 *     Robinhood's live catalog (`robinhood/catalog.ts`), narrowed to what has code on the node, and are added at runtime
 *     by `venues/rh-stocks.ts` through `registerToken`.
 *   - **Monad** (and its fork; Monad testnet quotes against it): Circle USDC settles. Uniswap v3 on chain 143, quoted
 *     through QuoterV2 on 2026-09-24: WMON/USDC 0.3% is deep ($10,000 → 412,238 WMON, ~$0.0243 a MON, no measurable
 *     impact); WETH/USDC 0.3% (~$7K USDC a side: $50 fills at ~$2,676, $1,000 moves it ~1.3%); WBTC/USDC 0.3% (~$1.7K
 *     USDC: a demo-sized fill, and the slippage ceiling refuses anything the pool cannot carry); USDT0/USDC 0.01% (~$30K
 *     USDC). Agora's AUSD is held and shown: its Uniswap pools hold dollars, not a market.
 *   - **Base** keys keep their old registry so the Base build still reads: USDC, WETH, cbBTC and the Ondo equities (which
 *     route only through 1inch — no v3 pool — so their `toSettlement` is null here).
 */
import type { Address } from 'viem';
import { CHAIN_KEY, IS_ARBITRUM, IS_MONAD, IS_ROBINHOOD, QUOTE_ADDRESSES, SETTLEMENT_SYMBOL, UNISWAP } from '../evm/chains.js';
import { STOCKS } from './stocks.js';

export { SETTLEMENT_SYMBOL };

/**
 * One hop of a route toward the settlement token: the next token and the Uniswap v3 fee tier of the pool between them
 * (hundredths of a basis point: 100 = 0.01%, 500 = 0.05%, 3000 = 0.3%, 10000 = 1%).
 */
export type Hop = { via: string; fee: number };

export type TokenInfo = {
  address: Address;
  decimals: number;
  /**
   * The pools from this token to the settlement token, in order. `[]` is the settlement token itself; `null` means no
   * Uniswap v3 pool with real liquidity reaches it, so the token is held and shown but Uniswap does not trade it (1inch
   * may, where it is enabled).
   */
  toSettlement: Hop[] | null;
  /** `cash` is the settlement token; `stock` a tokenized equity; everything else is crypto. */
  kind: 'cash' | 'crypto' | 'stock';
  /** A readable name, where the registry has one (the Stock Tokens carry Robinhood's). */
  name?: string;
};

const ARBITRUM_TOKENS: Record<string, TokenInfo> = {
  /** 1inch's sentinel for native ETH. Never swapped as such: the delegation moves WETH (`executor/swap.ts`). */
  ETH: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18, toSettlement: null, kind: 'crypto' },
  USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, toSettlement: [], kind: 'cash' },
  /** Paxos Global Dollar on Arbitrum One. No Uniswap v3 pool pairs it (factory read 2026-09-23), so held, not routed. */
  USDG: { address: '0x004B506865409877C9fA29bfb1ebA929984B9bbC', decimals: 6, toSettlement: null, kind: 'crypto' },
  WETH: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18, toSettlement: [{ via: 'USDC', fee: 500 }], kind: 'crypto' },
  WBTC: { address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8, toSettlement: [{ via: 'USDC', fee: 500 }], kind: 'crypto' },
  ARB: {
    address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
    decimals: 18,
    toSettlement: [
      { via: 'WETH', fee: 500 },
      { via: 'USDC', fee: 500 },
    ],
    kind: 'crypto',
  },
  GMX: {
    address: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a',
    decimals: 18,
    toSettlement: [
      { via: 'WETH', fee: 10000 },
      { via: 'USDC', fee: 500 },
    ],
    kind: 'crypto',
  },
};

const ROBINHOOD_TOKENS: Record<string, TokenInfo> = {
  USDG: { address: QUOTE_ADDRESSES.usdcBase, decimals: 6, toSettlement: [], kind: 'cash' },
  /** Held and shown. The product trades Stock Tokens against USDG; no WETH route is part of it. */
  WETH: { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', decimals: 18, toSettlement: null, kind: 'crypto' },
};

const MONAD_TOKENS: Record<string, TokenInfo> = {
  /**
   * The native-token sentinel, kept under the key `ETH` because every reader filters native gas out by that name
   * (`evm/balances.ts`). On Monad it is MON. Never swapped as such: the delegation moves WMON.
   */
  ETH: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18, toSettlement: null, kind: 'crypto', name: 'MON' },
  USDC: { address: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', decimals: 6, toSettlement: [], kind: 'cash' },
  WMON: { address: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', decimals: 18, toSettlement: [{ via: 'USDC', fee: 3000 }], kind: 'crypto', name: 'Wrapped MON' },
  WETH: { address: '0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242', decimals: 18, toSettlement: [{ via: 'USDC', fee: 3000 }], kind: 'crypto' },
  WBTC: { address: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c', decimals: 8, toSettlement: [{ via: 'USDC', fee: 3000 }], kind: 'crypto' },
  USDT0: { address: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', decimals: 6, toSettlement: [{ via: 'USDC', fee: 100 }], kind: 'crypto' },
  /** Agora's AUSD. Held and shown; no Uniswap pool on Monad holds more than a few dollars of it (2026-09-24). */
  AUSD: { address: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a', decimals: 6, toSettlement: null, kind: 'crypto', name: 'Agora USD' },
};

/**
 * Monad testnet: Agora's testnet AUSD settles. No spot venue is wired on this testnet (Uniswap's published testnet
 * addresses have no code; Kuru's testnet is its V2 router), so the registry holds the dollar and WMON, and trading here is
 * Perpl's perps (`monad/perpl-desk.ts`).
 */
const MONAD_TESTNET_TOKENS: Record<string, TokenInfo> = {
  AUSD: { address: '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC', decimals: 6, toSettlement: [], kind: 'cash', name: 'Agora USD' },
  WMON: { address: '0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541', decimals: 18, toSettlement: null, kind: 'crypto', name: 'Wrapped MON' },
};

const BASE_TOKENS: Record<string, TokenInfo> = {
  ETH: { address: QUOTE_ADDRESSES.nativeEth, decimals: 18, toSettlement: null, kind: 'crypto' },
  WETH: { address: QUOTE_ADDRESSES.wethBase, decimals: 18, toSettlement: [{ via: 'USDC', fee: 500 }], kind: 'crypto' },
  USDC: { address: QUOTE_ADDRESSES.usdcBase, decimals: 6, toSettlement: [], kind: 'cash' },
  CBBTC: { address: QUOTE_ADDRESSES.cbbtcBase, decimals: 8, toSettlement: [{ via: 'USDC', fee: 500 }], kind: 'crypto' },
  ...Object.fromEntries(
    Object.values(STOCKS).map((s) => [s.symbol, { address: s.address, decimals: s.decimals, toSettlement: null, kind: 'stock' as const, name: s.name }]),
  ),
};

/**
 * The registry for the chain this executor settles on. MAINNET addresses on a testnet key, because a testnet quotes
 * against its mainnet (`evm/chains.ts` `UNISWAP_QUOTE_CHAIN`) and settles nothing.
 *
 * Mutable on purpose, and only through `registerToken`: the Stock Tokens on Robinhood Chain are a live catalog.
 */
export const TOKENS: Record<string, TokenInfo> = {
  ...(IS_ARBITRUM
    ? ARBITRUM_TOKENS
    : IS_ROBINHOOD
      ? ROBINHOOD_TOKENS
      : CHAIN_KEY === 'monad-testnet'
        ? MONAD_TESTNET_TOKENS
        : IS_MONAD
          ? MONAD_TOKENS
          : BASE_TOKENS),
};

/**
 * A symbol as the registry spells it, from however the caller spelled it.
 *
 * THE RULE, in one place, so nobody re-derives it:
 *   1. Crypto symbols are uppercase — `USDC`, `WETH`, `WBTC`.
 *   2. Base's Ondo equities carry a lowercase `c` — `NVDAc`. Robinhood's Stock Tokens are the bare ticker — `NVDA`.
 *   3. **No boundary may uppercase a caller's symbol.** Resolve through `canonicalSymbol` instead.
 *
 * One alias: on Robinhood Chain `USDC` names the settlement role and resolves to `USDG` (and to `AUSD` on Monad testnet). The strategy planners and the
 * app were written when the settlement token was always USDC, and on this chain the token in that role is USDG.
 */
const CANONICAL = new Map<string, string>();
function reindex(): void {
  CANONICAL.clear();
  for (const k of Object.keys(TOKENS)) CANONICAL.set(k.toUpperCase(), k);
  if ((IS_ROBINHOOD || CHAIN_KEY === 'monad-testnet') && !CANONICAL.has('USDC')) CANONICAL.set('USDC', SETTLEMENT_SYMBOL);
}
reindex();

export function canonicalSymbol(raw: string): string {
  return CANONICAL.get(raw.trim().toUpperCase()) ?? raw.trim();
}

/** Add (or refresh) one token. A symbol already registered under another address is refused, never overwritten. */
export function registerToken(symbol: string, info: TokenInfo): void {
  const existing = TOKENS[symbol];
  if (existing && existing.address.toLowerCase() !== info.address.toLowerCase()) {
    throw new Error(`${symbol} is already registered at ${existing.address}; refusing to re-point it at ${info.address}`);
  }
  TOKENS[symbol] = info;
  reindex();
}

/** True for the settlement token, however it was spelled — `USDC` included on Robinhood Chain. */
export function isSettlement(symbol: string): boolean {
  return canonicalSymbol(symbol) === SETTLEMENT_SYMBOL;
}

/** Tokens a Uniswap trade can be made in: the ones with a route to the settlement token. */
export function isRoutable(symbol: string): boolean {
  return (TOKENS[canonicalSymbol(symbol)]?.toSettlement ?? null) !== null;
}

export type SwapQuote = {
  inSymbol: string;
  outSymbol: string;
  inAmount: number;
  outAmount: number;
  minimumOut: number;
  slippagePct: number;
  /** The venues the route goes through — the order ticket's Route row. */
  venues: string[];
  /** How far the executed rate sits below the mid, as a percentage — or null when it cannot be measured, which is not zero. */
  priceImpactPct: number | null;
  route: string;
  /** The venue's gas estimate for this route, when it gave one. Undefined is not zero. */
  estimatedGas?: number;
  /** The Uniswap path taken, token by token, and each pool's fee — present on a Uniswap quote. */
  path?: { tokens: string[]; fees: number[] };
};

export type SwapCalldata = {
  to: Address;
  data: `0x${string}`;
  value: string;
  /**
   * The least this route may deliver, in raw OUT units. `XorrDelegation` holds the owner's balance to it across the call
   * (PLAN.md 1.4), so it is derived from the venue's own answer rather than estimated a second time.
   */
  minOut: bigint;
};

/** "Max slippage 0.30%". */
export const DEFAULT_SLIPPAGE_PCT = 0.3;

/**
 * How much slippage each kind of trade accepts, and why they differ. A scheduled buy can wait; a stop-loss cannot, since
 * the market moving is why it fired; a panic exit can wait least of all. These are ceilings, not targets.
 */
export const SLIPPAGE = {
  scheduled: DEFAULT_SLIPPAGE_PCT,
  stop: 1,
  panic: 2,
} as const;

const IMPACT_MARGIN = 1.5;
const MAX_SLIPPAGE_PCT = 3;

/**
 * The urgency ceiling, widened by what the quote itself says this trade will cost on this pool, capped — beyond the cap
 * the trade should fail and say why rather than pay for its own market impact. Rounded UP to two decimals (after settling
 * binary noise, so a clean 1.2 stays 1.2): 1inch refuses a slippage with more decimals than that.
 */
export function slippageFor(base: number, priceImpactPct: number | null): number {
  if (priceImpactPct === null || !Number.isFinite(priceImpactPct) || priceImpactPct <= 0) return base;
  const widened = Math.min(Math.max(base, priceImpactPct * IMPACT_MARGIN), MAX_SLIPPAGE_PCT);
  return Math.ceil(Number((widened * 100).toFixed(6))) / 100;
}

/** Where a swap can actually land: a chain whose Uniswap v3 this build settles through (a mainnet or its fork). */
export const CAN_SETTLE = UNISWAP !== null;

/** "Direct", one venue by name, or "Best of N venues". */
export function routeLabel(venues: string[]): string {
  if (venues.length === 0) return 'Direct';
  if (venues.length === 1) return venues[0]!;
  return `Best of ${venues.length} venues`;
}

/** For messages: the chain key, so a refusal names where it happened. */
export const REGISTRY_CHAIN = CHAIN_KEY;

/**
 * The registry as complete as this chain makes it: on Robinhood Chain, the Stock Tokens loaded from the live catalog
 * and narrowed to this node (`venues/rh-stocks.ts`); elsewhere nothing to do. Every path that looks a symbol up before
 * trading awaits this first. A catalog that cannot be read leaves the registry as it was — the settlement token and any
 * stock loaded earlier — and the lookup that follows says what is missing.
 */
export async function ensureRegistry(): Promise<void> {
  if (!IS_ROBINHOOD) return;
  const { robinhoodStocks } = await import('./rh-stocks.js');
  await robinhoodStocks().catch(() => undefined);
}
