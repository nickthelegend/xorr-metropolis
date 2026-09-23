/**
 * THE FORK KEEPER — anvil forks of Arbitrum One only (PLAN.md P2.6, G13; 2026-09-23).
 *
 * GMX market orders are two-step: an order is created, then one of GMX's ORDER_KEEPERs executes it with prices signed
 * by Chainlink Data Streams. No GMX keeper watches a private fork, and no one can produce those signatures for one,
 * so on a fork an order would sit 'pending' forever. This stands in for the keeper, the way GMX's own
 * `forked-env-example` does:
 *
 *   1. It refuses anything that is not anvil forking chain 42161 (`web3_clientVersion`, `eth_chainId`).
 *   2. It writes `ForkOracleProvider` (./ForkOracleProvider.sol) over the oracle provider GMX's DataStore names for each
 *      token the order needs (`ORACLE_PROVIDER_FOR_TOKEN`; 0x7BA7Ae61… for WETH/USDC/BTC/USDG on 2026-09-23) with
 *      `anvil_setCode`. The replacement returns the prices it is given without verifying a signature. It speaks the
 *      LIVE provider interface (seven-field `ValidatedPrice` with rawMin/rawMax, plus `shouldCheckRefPrice`), read from
 *      the verified Oracle source on 2026-09-23 — GMX's own example mock still has the older five-field struct, and
 *      the live Oracle reverts with empty data decoding it.
 *   3. It seeds those prices with GMX's REAL current prices — `/signed_prices/latest` (min/max "Full"), falling back
 *      to `/prices/tickers` — so an order executes at the price it would have got on Arbitrum at that moment.
 *   4. Where the fork's copy of a Chainlink reference feed is older than GMX's heartbeat (a long-lived fork drifts
 *      past it; GMX then refuses with `ChainlinkPriceFeedNotUpdated`), it writes `ForkChainlinkFeed` over the feed and
 *      sets it to the same live price. A fresh feed is left alone.
 *   5. It impersonates a registered ORDER_KEEPER (checked with `RoleStore.hasRole`) and calls
 *      `OrderHandler.executeOrder(key, {tokens, providers, data})`.
 *
 * Everything it returns is labelled `fork keeper`. None of this can touch a real chain: step 1 throws first, and
 * `anvil_*` methods do not exist anywhere else.
 */
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { arbitrum } from 'viem/chains';
import { anvil, topUpNative } from '../../fork/anvil.js';
import { fetchRawTickers, fetchSignedPrices, priceToUsd, type FetchLike } from './api.js';
import { dataStoreAbi, orderHandlerAbi, readerAbi, roleStoreAbi } from './abis.js';
import { GMX, KEYS, TOKENS, keys, marketByToken, tokenByAddress } from './constants.js';
import { forkChainlinkFeedRuntime, forkOracleProviderRuntime } from './fork-bytecode.js';
import { gmxEventsIn, gmxRevertName } from './orders.js';

export const FORK_KEEPER_LABEL = 'fork keeper (anvil only): GMX oracle provider replaced, live GMX prices, impersonated ORDER_KEEPER';

/** Seen holding ORDER_KEEPER on Arbitrum One on 2026-09-23. Checked again on every run. */
export const KNOWN_ORDER_KEEPER: Address = '0xE47b36382DC50b90bCF6176Ddb159C4b9333A7AB';

const forkOracleAbi = [
  {
    type: 'function',
    name: 'setPrices',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokens', type: 'address[]' },
      { name: 'minPrices', type: 'uint256[]' },
      { name: 'maxPrices', type: 'uint256[]' },
    ],
    outputs: [],
  },
] as const;

const forkFeedAbi = [
  { type: 'function', name: 'setAnswer', stateMutability: 'nonpayable', inputs: [{ name: 'answer', type: 'int256' }, { name: 'decimals_', type: 'uint8' }], outputs: [] },
] as const;

const chainlinkAbi = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }],
  },
] as const;

export class NotAForkError extends Error {
  constructor(detail: string) {
    super(`The fork keeper runs on an anvil fork of Arbitrum One only. ${detail}`);
    this.name = 'NotAForkError';
  }
}

/** Throws unless `rpc` is anvil forking chain 42161. */
export async function assertArbitrumAnvilFork(rpc: string): Promise<void> {
  let node: string;
  try {
    node = String(await anvil(rpc, 'web3_clientVersion', []));
  } catch (e) {
    throw new NotAForkError(`${rpc} did not answer web3_clientVersion (${e instanceof Error ? e.message : String(e)}).`);
  }
  if (!/^anvil\//i.test(node)) throw new NotAForkError(`${rpc} answers as "${node}", not anvil.`);
  const id = Number(await anvil(rpc, 'eth_chainId', []));
  if (id !== arbitrum.id) throw new NotAForkError(`${rpc} is chain ${id}, not a fork of Arbitrum One (${arbitrum.id}).`);
}

export type KeeperPrice = { token: Address; symbol: string; min: bigint; max: bigint; usd: number; source: string };

/** GMX's live price for each token: signed prices first (what real keepers execute with), tickers as the fallback. */
export async function livePrices(tokens: Address[], opts: { fetchImpl?: FetchLike } = {}): Promise<KeeperPrice[]> {
  const out: KeeperPrice[] = [];
  let signed: Awaited<ReturnType<typeof fetchSignedPrices>> = [];
  try {
    signed = await fetchSignedPrices(opts);
  } catch {
    // Fall through to tickers, which say so in `source`.
  }
  let tickers: Awaited<ReturnType<typeof fetchRawTickers>> | undefined;
  for (const token of tokens) {
    const meta = tokenByAddress(token);
    if (!meta) throw new Error(`The fork keeper has no decimals for ${token}; add it to venues/gmx/constants.ts.`);
    const s = signed.find((p) => p.tokenAddress.toLowerCase() === token.toLowerCase() && p.isValid !== false);
    if (s?.minPriceFull && s.maxPriceFull) {
      const min = BigInt(s.minPriceFull);
      const max = BigInt(s.maxPriceFull);
      out.push({ token, symbol: meta.symbol, min, max, usd: priceToUsd((min + max) / 2n, meta.decimals), source: 'GMX /signed_prices/latest' });
      continue;
    }
    tickers ??= await fetchRawTickers(opts);
    const t = tickers.find((p) => p.tokenAddress.toLowerCase() === token.toLowerCase());
    if (!t) throw new Error(`GMX prices ${token} (${meta.symbol}) in neither /signed_prices/latest nor /prices/tickers.`);
    const min = BigInt(t.minPrice);
    const max = BigInt(t.maxPrice);
    out.push({ token, symbol: meta.symbol, min, max, usd: priceToUsd((min + max) / 2n, meta.decimals), source: 'GMX /prices/tickers' });
  }
  return out;
}

/** An ORDER_KEEPER the RoleStore confirms: the known one if it still holds the role, else the first member. */
export async function findOrderKeeper(client: Pick<PublicClient, 'readContract'>, preferred: Address = KNOWN_ORDER_KEEPER): Promise<Address> {
  const has = await client.readContract({ address: GMX.roleStore, abi: roleStoreAbi, functionName: 'hasRole', args: [preferred, KEYS.ORDER_KEEPER] });
  if (has) return preferred;
  const members = await client.readContract({ address: GMX.roleStore, abi: roleStoreAbi, functionName: 'getRoleMembers', args: [KEYS.ORDER_KEEPER, 0n, 1n] });
  if (!members[0]) throw new Error('RoleStore lists no ORDER_KEEPER.');
  return members[0];
}

export type ForkExecution = {
  label: typeof FORK_KEEPER_LABEL;
  key: Hex;
  keeper: Address;
  providers: Address[];
  prices: KeeperPrice[];
  /** Chainlink reference feeds that were stale on the fork and were replaced with the live price. */
  refreshedFeeds: { token: Address; symbol: string; feed: Address; ageSeconds: bigint; heartbeat: bigint; tx: Hex }[];
  setPricesTx: Hex;
  executeTx: Hex;
  /** What GMX said happened in the execute transaction. */
  outcome: 'executed' | 'cancelled' | 'frozen' | 'none';
};

/**
 * Execute a pending GMX order on an anvil fork, as a keeper would, at GMX's live prices. FORK ONLY.
 */
export async function forkExecuteOrder(p: { rpc: string; key: Hex; keeper?: Address; fetchImpl?: FetchLike }): Promise<ForkExecution> {
  await assertArbitrumAnvilFork(p.rpc);
  const chain = { ...arbitrum, rpcUrls: { default: { http: [p.rpc] } } };
  const pub = createPublicClient({ chain, transport: http(p.rpc) });
  const wallet = createWalletClient({ chain, transport: http(p.rpc) });
  const receipt = (hash: Hex) => pub.waitForTransactionReceipt({ hash, timeout: 300_000, pollingInterval: 500 });

  const order = await pub.readContract({ address: GMX.reader, abi: readerAbi, functionName: 'getOrder', args: [GMX.dataStore, p.key] });
  if (order.addresses.account === zeroAddress) throw new Error(`No stored GMX order ${p.key}: it was already executed or cancelled, or never existed.`);
  if (order.addresses.swapPath.length > 0) throw new Error('The fork keeper prices single-market orders only; this order has a swap path.');
  const market = marketByToken(order.addresses.market);
  if (!market) throw new Error(`Market ${order.addresses.market} is not one xorr trades (venues/gmx/constants.ts).`);
  const tokens = [...new Set([TOKENS[market.index].address, TOKENS[market.long].address, TOKENS[market.short].address])] as Address[];

  const keeper = await findOrderKeeper(pub, p.keeper);
  const prices = await livePrices(tokens, { fetchImpl: p.fetchImpl });

  // The provider GMX insists on for each token; replace its code once.
  const providers: Address[] = [];
  for (const token of tokens) {
    const provider = await pub.readContract({
      address: GMX.dataStore,
      abi: dataStoreAbi,
      functionName: 'getAddress',
      args: [keys.oracleProviderForToken(GMX.oracle, token)],
    });
    if (provider === zeroAddress) throw new Error(`GMX's DataStore names no oracle provider for ${token}.`);
    const enabled = await pub.readContract({ address: GMX.dataStore, abi: dataStoreAbi, functionName: 'getBool', args: [keys.isOracleProviderEnabled(provider)] });
    if (!enabled) throw new Error(`Oracle provider ${provider} for ${token} is not enabled in GMX's DataStore.`);
    providers.push(provider);
    const code = await pub.getCode({ address: provider });
    if (code?.toLowerCase() !== forkOracleProviderRuntime.toLowerCase()) {
      await anvil(p.rpc, 'anvil_setCode', [provider, forkOracleProviderRuntime]);
    }
  }

  await anvil(p.rpc, 'anvil_impersonateAccount', [keeper]);
  try {
    await topUpNative(p.rpc, keeper, 10n ** 18n);

    // Reference feeds GMX checks every price against.
    const refreshedFeeds: ForkExecution['refreshedFeeds'] = [];
    const now = (await pub.getBlock()).timestamp;
    for (const price of prices) {
      const feed = await pub.readContract({ address: GMX.dataStore, abi: dataStoreAbi, functionName: 'getAddress', args: [keys.priceFeed(price.token)] });
      if (feed === zeroAddress) continue;
      const heartbeat = await pub.readContract({
        address: GMX.dataStore,
        abi: dataStoreAbi,
        functionName: 'getUint',
        args: [keys.priceFeedHeartbeatDuration(price.token)],
      });
      const round = await pub.readContract({ address: feed, abi: chainlinkAbi, functionName: 'latestRoundData' });
      const age = now > round[3] ? now - round[3] : 0n;
      // Leave a margin: the execute transaction lands a few seconds after this read.
      if (age + 600n <= heartbeat) continue;
      const decimals = await pub.readContract({ address: feed, abi: chainlinkAbi, functionName: 'decimals' });
      const meta = tokenByAddress(price.token)!;
      // Raw GMX price is USD per smallest unit × 1e30; a feed answers USD per whole token × 10^decimals.
      const answer = (((price.min + price.max) / 2n) * 10n ** BigInt(meta.decimals) * 10n ** BigInt(decimals)) / 10n ** 30n;
      await anvil(p.rpc, 'anvil_setCode', [feed, forkChainlinkFeedRuntime]);
      const tx = await wallet.sendTransaction({
        account: keeper,
        to: feed,
        data: encodeFunctionData({ abi: forkFeedAbi, functionName: 'setAnswer', args: [answer, decimals] }),
      });
      await receipt(tx);
      refreshedFeeds.push({ token: price.token, symbol: price.symbol, feed, ageSeconds: age, heartbeat, tx });
    }

    // Seed the replaced provider(s) with the live prices.
    const byProvider = new Map<Address, KeeperPrice[]>();
    prices.forEach((price, i) => byProvider.set(providers[i]!, [...(byProvider.get(providers[i]!) ?? []), price]));
    let setPricesTx: Hex = '0x';
    for (const [provider, list] of byProvider) {
      setPricesTx = await wallet.sendTransaction({
        account: keeper,
        to: provider,
        data: encodeFunctionData({
          abi: forkOracleAbi,
          functionName: 'setPrices',
          args: [list.map((x) => x.token), list.map((x) => x.min), list.map((x) => x.max)],
        }),
      });
      await receipt(setPricesTx);
    }

    const oracleParams = { tokens, providers, data: tokens.map(() => '0x' as Hex) };
    try {
      await pub.simulateContract({ account: keeper, address: GMX.orderHandler, abi: orderHandlerAbi, functionName: 'executeOrder', args: [p.key, oracleParams] });
    } catch (e) {
      const name = gmxRevertName(e);
      throw new Error(`executeOrder would revert${name ? ` with ${name}` : ''}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
    const executeTx = await wallet.sendTransaction({
      account: keeper,
      to: GMX.orderHandler,
      data: encodeFunctionData({ abi: orderHandlerAbi, functionName: 'executeOrder', args: [p.key, oracleParams] }),
      gas: 12_000_000n,
    });
    const r = await receipt(executeTx);
    if (r.status !== 'success') throw new Error(`executeOrder ${executeTx} reverted on the fork.`);
    const events = gmxEventsIn(r).filter((e) => e.topic1?.toLowerCase() === p.key.toLowerCase());
    const outcome = events.some((e) => e.eventName === 'OrderExecuted')
      ? 'executed'
      : events.some((e) => e.eventName === 'OrderCancelled')
        ? 'cancelled'
        : events.some((e) => e.eventName === 'OrderFrozen')
          ? 'frozen'
          : 'none';
    return { label: FORK_KEEPER_LABEL, key: p.key, keeper, providers: [...new Set(providers)], prices, refreshedFeeds, setPricesTx, executeTx, outcome };
  } finally {
    await anvil(p.rpc, 'anvil_stopImpersonatingAccount', [keeper]).catch(() => undefined);
  }
}
