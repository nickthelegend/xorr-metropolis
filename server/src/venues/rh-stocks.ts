/**
 * Robinhood Chain Stock Tokens as this executor trades them (PLAN.md P1.6, 2026-09-23).
 *
 * The catalog is Robinhood's live one (`robinhood/catalog.ts`: ACTIVE, deployed on 4663, with a funded USDG Uniswap v3
 * pool), narrowed to the tokens **whose token contract and pool both have code on the node this executor settles on**.
 * On Robinhood Chain itself that is all of them. On the hosted `robinhood-fork` node — a snapshot of real state at block
 * 70254193 served without an upstream — only NVDA, TSLA, AAPL and SPY were captured; the other catalog tokens read as
 * empty accounts there, so they are not offered as tradable (a buy would revert on a token with no code).
 *
 * Each tradable token is registered into the venue registry (`venues/tokens.ts`) with its one hop to USDG at its pool's
 * fee tier, and into `RUNTIME_STOCKS` so `isStock` knows it. A token, once registered, stays registered for the life of
 * the process: someone holding it must always be able to sell it, even if a later catalog read drops it.
 *
 * ERC-8056: a Stock Token balance is in TOKENS; the shares it represents are `balance × uiMultiplier() / 1e18`, read on
 * the settlement chain (`sharesOf`). Chainlink's feed for each token is multiplier-inclusive — USD per TOKEN — and so is
 * every pool price here, so values are `tokens × price` and shares are for display.
 */
import { erc20Abi, formatUnits, getAddress, parseAbi, type Address } from 'viem';
import { CHAIN_KEY, IS_ROBINHOOD } from '../evm/chains.js';
import { stockCatalog, type CatalogEntry } from '../robinhood/catalog.js';
import { RUNTIME_STOCKS } from './stocks.js';
import { TOKENS, registerToken } from './tokens.js';

export type RhStock = CatalogEntry & {
  decimals: 18;
  /** Present on this node: the token and its pool both have code here. */
  onNode: true;
};

const uiMultiplierAbi = parseAbi(['function uiMultiplier() view returns (uint256)']);

/** Whether the settlement chain needs its code checked: a fork may hold only part of the chain's state. */
const CHECK_CODE = CHAIN_KEY === 'robinhood-fork';

const REFRESH_MS = 10 * 60_000;
let loaded: RhStock[] = [];
let loadedAt = 0;
let inflight: Promise<RhStock[]> | undefined;

/** Tests (and nothing else) reset what was loaded. */
export function resetRobinhoodStocksForTests(): void {
  loaded = [];
  loadedAt = 0;
  inflight = undefined;
}

async function withCode(addresses: Address[]): Promise<Set<string>> {
  const { publicClient } = await import('../evm/client.js');
  const out = new Set<string>();
  const queue = [...new Set(addresses.map((a) => a.toLowerCase()))];
  // Sixteen at a time: a node behind a proxy answers a hundred parallel reads with timeouts.
  const workers = Array.from({ length: 16 }, async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      const code = await publicClient.getCode({ address: a as Address }).catch(() => undefined);
      if (code && code !== '0x') out.add(a);
    }
  });
  await Promise.all(workers);
  return out;
}

/** The pure narrowing step: catalog entries whose token and pool are both in `present` (lower-cased addresses). */
export function presentOnNode(catalog: CatalogEntry[], present: Set<string>): RhStock[] {
  return catalog
    .filter((e) => present.has(e.address.toLowerCase()) && present.has(e.pool.address.toLowerCase()))
    .map((e) => ({ ...e, decimals: 18 as const, onNode: true as const }));
}

function register(stocks: RhStock[]): void {
  for (const s of stocks) {
    try {
      registerToken(s.symbol, {
        address: getAddress(s.address),
        decimals: 18,
        toSettlement: [{ via: 'USDG', fee: s.pool.fee }],
        kind: 'stock',
        name: s.name,
      });
      RUNTIME_STOCKS.set(s.symbol, { symbol: s.symbol, name: s.name, address: getAddress(s.address), decimals: 18 });
    } catch {
      // A catalog symbol that collides with a crypto symbol already in the registry is not offered as a stock.
    }
  }
}

/**
 * The tradable Stock Tokens on this node, loaded on first use and refreshed every ten minutes. Empty off Robinhood
 * Chain. A failed refresh keeps the last good list; a failed FIRST load throws, so a caller can say why.
 */
export function robinhoodStocks(): Promise<RhStock[]> {
  if (!IS_ROBINHOOD || CHAIN_KEY === 'robinhood-testnet') return Promise.resolve([]);
  if (loadedAt > 0 && Date.now() - loadedAt < REFRESH_MS) return Promise.resolve(loaded);
  inflight ??= (async () => {
    try {
      const catalog = await stockCatalog();
      const present = CHECK_CODE
        ? await withCode(catalog.flatMap((e) => [e.address, e.pool.address]))
        : new Set(catalog.flatMap((e) => [e.address.toLowerCase(), e.pool.address.toLowerCase()]));
      const stocks = presentOnNode(catalog, present);
      register(stocks);
      loaded = stocks;
      loadedAt = Date.now();
      return stocks;
    } catch (e) {
      if (loadedAt > 0) return loaded;
      throw e;
    } finally {
      inflight = undefined;
    }
  })();
  return inflight;
}

/** One loaded Stock Token, by symbol (case-insensitive), after `robinhoodStocks()` has run. */
export function rhStock(symbol: string): RhStock | undefined {
  const want = symbol.trim().toUpperCase();
  return loaded.find((s) => s.symbol.toUpperCase() === want);
}

/** Load the list if it is not, then look one up. */
export async function rhStockAsync(symbol: string): Promise<RhStock | undefined> {
  await robinhoodStocks();
  return rhStock(symbol);
}

/** True when `symbol` is a Robinhood Stock Token in the registry (loaded). */
export function isRhStock(symbol: string): boolean {
  return IS_ROBINHOOD && TOKENS[symbol]?.kind === 'stock';
}

/**
 * ERC-8056 holdings of one Stock Token on the settlement chain: the raw token balance, the multiplier, and the shares it
 * represents (`balance × uiMultiplier / 1e18`).
 */
export async function sharesOf(
  token: Address,
  holder: Address,
): Promise<{ balance: bigint; tokens: number; multiplier: bigint; shares: number }> {
  const { publicClient } = await import('../evm/client.js');
  const [balance, multiplier] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [holder] }),
    uiMultiplierOf(token),
  ]);
  const shares = (balance * multiplier) / 10n ** 18n;
  return { balance, tokens: Number(formatUnits(balance, 18)), multiplier, shares: Number(formatUnits(shares, 18)) };
}

const multipliers = new Map<string, { at: number; value: bigint }>();

/** `uiMultiplier()` on the settlement chain, 1e18-scaled, cached a minute. */
export async function uiMultiplierOf(token: Address): Promise<bigint> {
  const hit = multipliers.get(token.toLowerCase());
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const { publicClient } = await import('../evm/client.js');
  const value = await publicClient.readContract({ address: token, abi: uiMultiplierAbi, functionName: 'uiMultiplier' });
  multipliers.set(token.toLowerCase(), { at: Date.now(), value });
  return value;
}

/** Shares per token as a decimal (1.000775… for NVDA on 2026-09-23). */
export async function multiplierOf(symbol: string): Promise<number | null> {
  const t = TOKENS[symbol];
  if (!t || t.kind !== 'stock') return null;
  return uiMultiplierOf(t.address).then(
    (m) => Number(formatUnits(m, 18)),
    () => null,
  );
}
