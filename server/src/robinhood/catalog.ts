/**
 * The tradable Stock Token catalog: Robinhood's live asset list, narrowed to what xorr can actually
 * buy with USDG on Robinhood Chain — ACTIVE, deployed on 4663, and with a funded USDG Uniswap v3
 * pool. Each entry carries both multipliers (API vs on-chain `uiMultiplier()`), its Chainlink feed
 * and pool, and any pending multiplier change or open corporate action as a notice.
 */
import { getAddress, type Address } from 'viem';
import {
  deploymentOn,
  describeCorporateAction,
  fetchAssets,
  fetchCorporateActions,
  isActive,
  openCorporateActions,
  pendingMultiplierOf,
  toWad,
  type RobinhoodAsset,
  type TradingCapabilities,
} from './api.js';
import { MULTICALL_BATCH_BYTES, feedDirectory, pickFundedPool, robinhoodClient, scanUsdgPools, stockTokenAbi, type UsdgPool } from './chain.js';
import { TtlCache } from './http.js';

export type CatalogEntry = {
  symbol: string;
  name: string;
  address: Address;
  logoUrl?: string;
  /** `currentMultiplier` from `/rhj/assets`, as the API's decimal string. */
  multiplier: string;
  /** `uiMultiplier()` read on-chain, 1e18-scaled; undefined if the read failed. */
  onchainMultiplier?: bigint;
  /** API and chain disagree by more than 1e-9 (e.g. mid corporate action). */
  multiplierMismatch: boolean;
  chainlinkFeed?: Address;
  pool: { address: Address; fee: number; usdg: number };
  tradingCapabilities: TradingCapabilities;
  pendingMultiplier?: { multiplier: string; effectiveTime?: string; notice: string };
  corporateActions: string[];
};

const cache = new TtlCache<CatalogEntry[]>(60_000);
export const clearCatalogCache = () => cache.clear();

/** Pure assembly step, separate from the reads so it can be tested against fixtures. */
export function buildCatalog(input: {
  assets: RobinhoodAsset[];
  pools: Map<string, UsdgPool[]>;
  feeds: Map<string, { proxy: Address }>;
  multipliers: Map<string, bigint | undefined>;
  corporateActions?: Parameters<typeof openCorporateActions>[0];
  minPoolUsdg?: number;
}): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const a of input.assets) {
    const dep = deploymentOn(a);
    if (!isActive(a) || !dep) continue;
    const address = getAddress(dep.contractAddress);
    const pool = pickFundedPool(input.pools.get(address.toLowerCase()) ?? [], input.minPoolUsdg);
    if (!pool) continue;
    const onchain = input.multipliers.get(address.toLowerCase());
    const apiWad = toWad(a.currentMultiplier);
    const diff = onchain === undefined ? 0n : onchain > apiWad ? onchain - apiWad : apiWad - onchain;
    const pending = pendingMultiplierOf(a);
    out.push({
      symbol: a.tokenSymbol,
      name: a.tokenName,
      address,
      logoUrl: a.logoUrl,
      multiplier: a.currentMultiplier,
      onchainMultiplier: onchain,
      multiplierMismatch: diff > 10n ** 9n,
      chainlinkFeed: input.feeds.get(a.tokenSymbol.toUpperCase())?.proxy,
      pool: { address: pool.pool, fee: pool.fee, usdg: pool.usdg },
      tradingCapabilities: a.tradingCapabilities,
      pendingMultiplier: pending && {
        ...pending,
        notice:
          `${a.tokenSymbol} multiplier changes ${a.currentMultiplier} → ${pending.multiplier}` +
          (pending.effectiveTime ? ` at ${pending.effectiveTime}` : '') +
          ' (corporate action; each token will represent a different number of shares).',
      },
      corporateActions: openCorporateActions(input.corporateActions ?? [], a.tokenSymbol).map(describeCorporateAction),
    });
  }
  return out.sort((x, y) => y.pool.usdg - x.pool.usdg);
}

/** The live catalog (cached 60s, the assets endpoint's cache time). */
export function stockCatalog(): Promise<CatalogEntry[]> {
  return cache.get('catalog', async () => {
    const [assets, feeds, corporateActions] = await Promise.all([
      fetchAssets(),
      feedDirectory(),
      fetchCorporateActions().catch(() => []), // notices are advisory; never block the catalog
    ]);
    const tokens = assets
      .filter(isActive)
      .map((a) => deploymentOn(a))
      .filter((d) => !!d)
      .map((d) => getAddress(d.contractAddress));
    const pools = await scanUsdgPools(tokens);
    const withPool = tokens.filter((t) => pickFundedPool(pools.get(t.toLowerCase()) ?? []));
    const reads = await robinhoodClient().multicall({
      allowFailure: true,
    batchSize: MULTICALL_BATCH_BYTES,
      contracts: withPool.map((t) => ({ address: t, abi: stockTokenAbi, functionName: 'uiMultiplier' as const })),
    });
    const multipliers = new Map<string, bigint | undefined>(
      withPool.map((t, i) => [t.toLowerCase(), reads[i]?.status === 'success' ? (reads[i]!.result as bigint) : undefined]),
    );
    return buildCatalog({ assets, pools, feeds, multipliers, corporateActions });
  });
}

export async function catalogEntry(symbol: string): Promise<CatalogEntry | undefined> {
  const s = symbol.toUpperCase();
  return (await stockCatalog()).find((e) => e.symbol.toUpperCase() === s);
}
