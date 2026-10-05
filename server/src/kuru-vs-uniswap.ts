/**
 * Why route through Kuru: what a MON sale delivers on Kuru's book against Uniswap's best pool, at sizes people trade, on
 * Monad mainnet now. Read-only — every number is an `eth_call`, nothing is signed or sent.
 *
 * Kuru: `placeAndExecuteMarketSell` on the MON/USDC book, called with the MON attached from an address whose balance is
 * set by a state override (the book is native-MON, so no token approval is needed to ask it). Its return is the USDC the
 * sale would deliver. Uniswap: QuoterV2 `quoteExactInput` for WMON → USDC through each fee tier; the best one counts.
 *
 *   npx tsx src/kuru-vs-uniswap.ts            (MONAD_RPC overrides the public endpoint)
 */
import { createPublicClient, encodePacked, formatUnits, http, parseAbi, parseEther, type Address } from 'viem';
import { KURU_MONAD, readBook } from './monad/kuru.js';
import { MONAD_MAINNET_RPC } from './monad/mainnet.js';

const WMON: Address = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';
const USDC: Address = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
const QUOTER: Address = '0x661e93cca42afacb172121ef892830ca3b70f08d';
const BOOK = KURU_MONAD.markets['MON/USDC'] as Address;
/** Any address; the override gives it the MON a sale needs. */
const ASKER: Address = '0x000000000000000000000000000000000000dEaD';
const SIZES_USD = [10, 100, 1_000, 5_000, 20_000];
const FEES = [500, 3000, 10000] as const;

const BOOK_ABI = parseAbi([
  'function placeAndExecuteMarketSell(uint96 size, uint256 minAmountOut, bool isMargin, bool isFillOrKill) payable returns (uint256)',
  'function getMarketParams() view returns (uint32 pricePrecision, uint96 sizePrecision, address baseAsset, uint256 baseAssetDecimals, address quoteAsset, uint256 quoteAssetDecimals, uint32 tickSize, uint96 minSize, uint96 maxSize, uint256 takerFeeBps, uint256 makerFeeBps)',
]);
const QUOTER_ABI = parseAbi([
  'function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
]);

const client = createPublicClient({ transport: http(MONAD_MAINNET_RPC, { timeout: 20_000 }) });

async function kuruSell(monWei: bigint, sizePrecision: bigint): Promise<bigint | null> {
  const size = (monWei * sizePrecision) / 10n ** 18n;
  const value = (size * 10n ** 18n) / sizePrecision;
  try {
    const { result } = await client.simulateContract({
      address: BOOK,
      abi: BOOK_ABI,
      functionName: 'placeAndExecuteMarketSell',
      args: [size, 0n, false, false],
      value,
      account: ASKER,
      stateOverride: [{ address: ASKER, balance: value * 2n }],
    });
    return result;
  } catch {
    return null;
  }
}

async function uniswapSell(monWei: bigint): Promise<{ out: bigint; fee: number } | null> {
  const quotes = await Promise.all(
    FEES.map(async (fee) => {
      try {
        const { result } = await client.simulateContract({
          address: QUOTER,
          abi: QUOTER_ABI,
          functionName: 'quoteExactInput',
          args: [encodePacked(['address', 'uint24', 'address'], [WMON, fee, USDC]), monWei],
        });
        return { out: result[0], fee };
      } catch {
        return null;
      }
    }),
  );
  return quotes.filter((q) => q !== null).sort((a, b) => (b!.out > a!.out ? 1 : -1))[0] ?? null;
}

async function main() {
  const [book, params, block] = await Promise.all([readBook('MON/USDC', client as never), client.readContract({ address: BOOK, abi: BOOK_ABI, functionName: 'getMarketParams' }), client.getBlockNumber()]);
  const mid = book.bid !== null && book.ask !== null ? (book.bid + book.ask) / 2 : (book.bid ?? book.ask);
  if (!mid) throw new Error('Kuru MON/USDC has no resting orders on either side.');
  const sizePrecision = BigInt(params[1]);
  const usd = (raw: bigint) => Number(formatUnits(raw, 6));
  console.log(`Kuru vs Uniswap, selling MON for USDC on Monad mainnet (chain 143), block ${block}, ${new Date().toISOString()}`);
  console.log(`Kuru MON/USDC ${BOOK}: bid $${book.bid} / ask $${book.ask}; taker fee ${params[9]} bps. Uniswap QuoterV2 ${QUOTER}, fee tiers ${FEES.join(', ')}.`);
  console.log('');
  console.log('size        MON          Kuru delivers   Uniswap delivers (tier)   Kuru vs Uniswap');
  let kuruWins = 0;
  let compared = 0;
  for (const s of SIZES_USD) {
    const mon = s / mid;
    const wei = parseEther(mon.toFixed(6));
    const [k, u] = await Promise.all([kuruSell(wei, sizePrecision), uniswapSell(wei)]);
    const kTxt = k === null ? 'no fill' : `$${usd(k).toFixed(2)}`;
    const uTxt = u === null ? 'no route' : `$${usd(u.out).toFixed(2)} (${u.fee / 10_000}%)`;
    let diff = '—';
    if (k !== null && u !== null && u.out > 0n) {
      compared += 1;
      const bps = ((usd(k) - usd(u.out)) / usd(u.out)) * 10_000;
      if (bps > 0) kuruWins += 1;
      diff = `${bps >= 0 ? '+' : ''}${bps.toFixed(1)} bps`;
    }
    console.log(`$${String(s).padEnd(10)} ${mon.toFixed(1).padEnd(12)} ${kTxt.padEnd(15)} ${uTxt.padEnd(25)} ${diff}`);
  }
  console.log('');
  console.log(`Kuru delivered more at ${kuruWins} of ${compared} sizes compared.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
