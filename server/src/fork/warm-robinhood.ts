/**
 * Pre-load a fresh Robinhood Chain fork with every piece of chain state the product reads, inside the public RPC's
 * ~10-minute historical-state window (measured 2026-09-23: ~6,100 blocks), so the fork can then be dumped and served
 * without an upstream (`infra/robinhood-fork`).
 *
 * The public RPC is not an archive node: a fork pinned at block N can lazily load an account or storage slot only while N
 * is still within the window. Everything a trade touches is therefore loaded now — token metadata, ERC-8056 multipliers,
 * each stock's Chainlink feed, and each Stock Token/USDG pool quoted in both directions across the sizes a demo uses, which
 * walks the same ticks and bitmap words a swap of that size crosses. Nothing is written by this script; it only reads.
 *
 * Run: FORK_RPC=http://127.0.0.1:8561 npx tsx src/fork/warm-robinhood.ts
 */
import { createPublicClient, http, parseAbi, parseUnits, type Address } from 'viem';
import { robinhood } from 'viem/chains';

const RPC = process.env.FORK_RPC ?? 'http://127.0.0.1:8545';
const client = createPublicClient({ chain: { ...robinhood, rpcUrls: { default: { http: [RPC] } } }, transport: http(RPC, { timeout: 60_000 }) });

const USDG: Address = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const WETH: Address = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const FACTORY: Address = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa';
const QUOTER: Address = '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7';
const ROUTER: Address = '0xcaf681a66d020601342297493863e78c959e5cb2';
const FEES = [100, 500, 3000, 10000] as const;

import { WARM_STOCKS } from './warm-robinhood-list.js';
export { WARM_STOCKS };

const erc20 = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function uiMultiplier() view returns (uint256)',
]);
const feedAbi = parseAbi([
  'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
]);
const factoryAbi = parseAbi(['function getPool(address,address,uint24) view returns (address)']);
const quoterAbi = parseAbi([
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
]);

async function quote(tokenIn: Address, tokenOut: Address, fee: number, amountIn: bigint): Promise<bigint | null> {
  try {
    const { result } = await client.simulateContract({
      address: QUOTER,
      abi: quoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
    });
    return result[0];
  } catch {
    return null;
  }
}

async function main() {
  const block = await client.getBlock();
  console.log(`warming ${RPC} at block ${block.number} (${new Date(Number(block.timestamp) * 1000).toISOString()})`);
  for (const t of [USDG, WETH]) {
    await Promise.all([
      client.readContract({ address: t, abi: erc20, functionName: 'symbol' }),
      client.readContract({ address: t, abi: erc20, functionName: 'decimals' }),
      client.readContract({ address: t, abi: erc20, functionName: 'totalSupply' }),
    ]);
  }
  await client.getCode({ address: ROUTER });
  /*
   * One quote per direction per funded pool, at the largest size a demo trades: a swap crosses a superset of the ticks
   * any smaller swap in the same direction crosses, so the largest buy and the matching sell load every tick and bitmap
   * word a smaller trade needs. All pools at once — the fork fetches in parallel, and the window is minutes.
   */
  const MAX_USDG = parseUnits('50000', 6);
  await Promise.all(
    WARM_STOCKS.map(async (s) => {
      const [sym, mult] = await Promise.all([
        client.readContract({ address: s.token, abi: erc20, functionName: 'symbol' }),
        client.readContract({ address: s.token, abi: erc20, functionName: 'uiMultiplier' }),
        client.readContract({ address: s.token, abi: erc20, functionName: 'decimals' }),
        client.readContract({ address: s.token, abi: erc20, functionName: 'totalSupply' }),
      ]);
      const [round, desc] = await Promise.all([
        client.readContract({ address: s.feed, abi: feedAbi, functionName: 'latestRoundData' }),
        client.readContract({ address: s.feed, abi: feedAbi, functionName: 'description' }),
        client.readContract({ address: s.feed, abi: feedAbi, functionName: 'decimals' }),
      ]);
      const loaded = await Promise.all(
        FEES.map(async (fee) => {
          const pool = await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'getPool', args: [s.token, USDG, fee] });
          if (/^0x0+$/.test(pool)) return 0;
          const usdgHeld = await client.readContract({ address: USDG, abi: erc20, functionName: 'balanceOf', args: [pool] });
          await client.readContract({ address: s.token, abi: erc20, functionName: 'balanceOf', args: [pool] });
          if (usdgHeld < parseUnits('100', 6)) return 0; // an empty pool is never routed to
          const out = await quote(USDG, s.token, fee, MAX_USDG);
          const back = out && out > 0n ? await quote(s.token, USDG, fee, out) : null;
          return (out !== null ? 1 : 0) + (back !== null ? 1 : 0);
        }),
      );
      console.log(
        `  ${sym}: multiplier ${Number(mult) / 1e18}, ${desc} ${Number(round[1]) / 1e8} @ ${new Date(Number(round[3]) * 1000).toISOString()}, ${loaded.reduce((a, b) => a + b, 0)} quotes`,
      );
    }),
  );
  for (const feed of ['0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9', '0x61B7e5650328764B076A108EFF5fa7282a1B9aD2'] as const) {
    await client.readContract({ address: feed, abi: feedAbi, functionName: 'latestRoundData' });
  }
  console.log('warm');
}

await main();
