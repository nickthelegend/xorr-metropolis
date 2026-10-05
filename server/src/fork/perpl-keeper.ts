/**
 * Perpl on the Monad fork: a local keeper (2026-10-06).
 *
 * A fork of Monad mainnet carries Perpl's Exchange and every resting order, but not Perpl's keepers: nothing posts a
 * mark, so within a minute every market's price is stale and the Exchange refuses orders. This is that keeper, for the
 * fork only. Impersonating the Exchange's owner (anvil allows it; a real chain does not):
 *
 *   setup  `setIgnOracle(perp, true)` on every open market — the Chainlink Data Streams oracle Perpl checks the mark
 *          against cannot be updated on a fork (its reports are signed off-chain);
 *   push   `updateMarkPricePNSByOwner(perp, mark)` with Perpl's own live mark from its public API, every few seconds,
 *          kept inside the fork's own book (`markWithinBook`).
 *
 * So a fork order fills against Perpl's real book at Perpl's real price, through the real Exchange. With the keeper
 * running, `PERPL_FORK_KEEPER=1` tells the executor Perpl is tradable here (`perplHere`). The fork's AUSD comes from
 * `fundAusd` (Perpl's margin is Agora's AUSD).
 *
 *   npx tsx src/fork/perpl-keeper.ts            # set up, then push marks every PERPL_KEEPER_MS (default 5000)
 *   npx tsx src/fork/perpl-keeper.ts --once     # set up and push once
 */
import { pathToFileURL } from 'node:url';
import { createPublicClient, createWalletClient, encodeAbiParameters, encodeFunctionData, erc20Abi, http, keccak256, pad, parseAbi, toHex, type Address, type PublicClient } from 'viem';
import { anvil } from './anvil.js';
import { PERPL } from '../monad/perpl-chain.js';

const EXCHANGE = PERPL.monad.exchange;
const AUSD = PERPL.monad.collateral;
const API = PERPL.monad.api;

const KEEPER_ABI = parseAbi([
  'function owner() view returns (address)',
  'function setIgnOracle(uint256 perpId, bool ignOracle)',
  'function updateMarkPricePNSByOwner(uint256 perpId, uint32 markPricePNS)',
]);

type ContextMarket = { id: number; name: string; config?: { is_open?: boolean; price_decimals?: number }; state?: { mrk?: number } };

/** Perpl's open markets and their live marks, from its public API, in each market's own price units. */
export async function liveMarks(api = API): Promise<{ id: number; name: string; markPNS: number; price: number }[]> {
  const res = await fetch(`${api}/v1/pub/context`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Perpl's API answered HTTP ${res.status}`);
  const ctx = (await res.json()) as { markets?: ContextMarket[] };
  return (ctx.markets ?? [])
    .filter((m) => m.config?.is_open && typeof m.state?.mrk === 'number' && m.state.mrk > 0)
    .map((m) => ({ id: m.id, name: m.name, markPNS: m.state!.mrk!, price: m.state!.mrk! / 10 ** (m.config?.price_decimals ?? 0) }));
}

async function asOwner(rpc: string, pub: PublicClient) {
  const owner = await pub.readContract({ address: EXCHANGE, abi: KEEPER_ABI, functionName: 'owner' });
  await anvil(rpc, 'anvil_impersonateAccount', [owner]);
  await anvil(rpc, 'anvil_setBalance', [owner, '0x56BC75E2D63100000']); // 100 MON for the keeper's gas
  return { owner, wallet: createWalletClient({ account: owner, transport: http(rpc) }) };
}

/** Once per fork: stop each market checking the mark against an oracle no one can update here. */
export async function setupPerplOnFork(rpc: string): Promise<{ owner: Address; markets: number[] }> {
  const pub = createPublicClient({ transport: http(rpc) });
  const { owner, wallet } = await asOwner(rpc, pub);
  const marks = await liveMarks();
  for (const m of marks) {
    const hash = await wallet.sendTransaction({ chain: null, to: EXCHANGE, data: encodeFunctionData({ abi: KEEPER_ABI, functionName: 'setIgnOracle', args: [BigInt(m.id), true] }) });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') throw new Error(`setIgnOracle(${m.id}) reverted on the fork (${hash})`);
  }
  return { owner, markets: marks.map((m) => m.id) };
}

/**
 * Perpl's live mark, kept inside the fork's own book. The fork's resting orders stay where they were when it was taken;
 * a mark that walked away from them would put every executable price outside Perpl's tolerance (5% for MON) and mark
 * positions at prices no order here can trade at. So the live mark is used where it sits within the fork's best bid and
 * best ask, and the nearer of the two where it does not.
 */
export function markWithinBook(live: number, bestBid: number | null, bestAsk: number | null): number {
  if (bestBid !== null && live < bestBid) return bestBid;
  if (bestAsk !== null && live > bestAsk) return bestAsk;
  return live;
}

const BOOK_ABI = parseAbi([
  'function getPerpetualInfo(uint256 perpId) view returns ((string name,string symbol,uint256 priceDecimals,uint256 lotDecimals,bytes32 linkFeedId,uint256 priceTolPer100K,uint256 marginTol,uint256 marginTolDecimals,uint256 refPriceMaxAgeSec,uint256 positionBalanceCNS,uint256 insuranceBalanceCNS,uint256 markPNS,uint256 markTimestamp,uint256 lastPNS,uint256 lastTimestamp,uint256 oraclePNS,uint256 oracleTimestampSec,uint256 longOpenInterestLNS,uint256 shortOpenInterestLNS,uint256 fundingStartBlock,int256 fundingRatePct100k,uint256 absFundingClampPctPer100K,uint256 status,uint256 basePricePNS,uint256 maxBidPriceONS,uint256 minBidPriceONS,uint256 maxAskPriceONS,uint256 minAskPriceONS,uint256 numOrders,bool ignOracle) perpetualInfo)',
]);

/** One round: every open market's mark set to Perpl's live one, kept inside the fork's book (`markWithinBook`). */
export async function pushMarks(rpc: string): Promise<{ name: string; price: number }[]> {
  const pub = createPublicClient({ transport: http(rpc) });
  const { wallet } = await asOwner(rpc, pub);
  const marks = await liveMarks();
  const hashes: `0x${string}`[] = [];
  for (const m of marks) {
    const i = await pub.readContract({ address: EXCHANGE, abi: BOOK_ABI, functionName: 'getPerpetualInfo', args: [BigInt(m.id)] }).catch(() => null);
    const side = (ons: bigint) => (i && ons > 0n && ons < 2n ** 64n ? Number(i.basePricePNS + ons) : null);
    const markPNS = i ? Math.round(markWithinBook(m.markPNS, side(i.maxBidPriceONS), side(i.minAskPriceONS))) : m.markPNS;
    m.price = (m.price * markPNS) / m.markPNS;
    hashes.push(
      await wallet.sendTransaction({
        chain: null,
        to: EXCHANGE,
        data: encodeFunctionData({ abi: KEEPER_ABI, functionName: 'updateMarkPricePNSByOwner', args: [BigInt(m.id), markPNS] }),
      }),
    );
  }
  const receipts = await Promise.all(hashes.map((hash) => pub.waitForTransactionReceipt({ hash })));
  // A market already updated in this block refuses a second update (two pushers in the same second); that market's mark
  // is fresh either way. Only a round where nothing landed is a failure.
  const landed = receipts.filter((r) => r.status === 'success').length;
  if (landed === 0) throw new Error(`none of ${receipts.length} mark updates landed on the fork`);
  return marks.map(({ name, price }) => ({ name, price }));
}

/** OpenZeppelin v5's namespaced ERC-20 storage (ERC-7201 `openzeppelin.storage.ERC20`): balances are its first field. */
const OZ_ERC20_SLOT = '0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00';

/**
 * AUSD on the fork (fork only: a real chain refuses these RPCs). Agora's AUSD is upgradeable with OpenZeppelin's namespaced
 * storage, which a plain mapping probe does not reach, so the balance is written there first; failing that, Perpl's
 * Exchange — which holds millions of AUSD of margin — is impersonated and makes an ordinary transfer.
 */
export async function fundAusd(rpc: string, holder: Address, amount: bigint): Promise<void> {
  const pub = createPublicClient({ transport: http(rpc) });
  const balance = () => pub.readContract({ address: AUSD, abi: erc20Abi, functionName: 'balanceOf', args: [holder] });
  const before = await balance();
  const slot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [holder, OZ_ERC20_SLOT]));
  await anvil(rpc, 'anvil_setStorageAt', [AUSD, slot, pad(toHex(before + amount), { size: 32 })]);
  if ((await balance()) === before + amount) return;
  await anvil(rpc, 'anvil_setStorageAt', [AUSD, slot, pad(toHex(before), { size: 32 })]);
  await anvil(rpc, 'anvil_impersonateAccount', [EXCHANGE]);
  await anvil(rpc, 'anvil_setBalance', [EXCHANGE, '0x8AC7230489E80000']);
  const wallet = createWalletClient({ account: EXCHANGE, transport: http(rpc) });
  const hash = await wallet.writeContract({ chain: null, address: AUSD, abi: erc20Abi, functionName: 'transfer', args: [holder, amount] });
  const r = await pub.waitForTransactionReceipt({ hash });
  await anvil(rpc, 'anvil_stopImpersonatingAccount', [EXCHANGE]);
  if (r.status !== 'success') throw new Error(`AUSD could not be funded on the fork (${hash})`);
}

async function main() {
  const rpc = process.env.FORK_RPC ?? 'http://127.0.0.1:8547';
  const chainId = await createPublicClient({ transport: http(rpc) }).getChainId();
  if (chainId !== 143) throw new Error(`${rpc} is chain ${chainId}, not a fork of Monad mainnet (143)`);
  const { owner, markets } = await setupPerplOnFork(rpc);
  console.log(`perpl keeper: ${markets.length} markets set to ignore the oracle, as owner ${owner}`);
  const once = process.argv.includes('--once');
  const every = Number(process.env.PERPL_KEEPER_MS ?? 5000);
  for (;;) {
    try {
      const marks = await pushMarks(rpc);
      console.log(`perpl keeper: ${new Date().toISOString()} ${marks.map((m) => `${m.name} ${Number(m.price.toPrecision(6))}`).join(' · ')}`);
    } catch (e) {
      console.warn(`perpl keeper: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
      if (once) process.exit(1);
    }
    if (once) return;
    await new Promise((r) => setTimeout(r, every));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
