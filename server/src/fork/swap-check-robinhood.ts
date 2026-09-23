/**
 * A real Stock Token round trip on a Robinhood Chain fork, and the fork's faucet reserve funded — the last warm-up step
 * before `infra/robinhood-fork` dumps the chain (2026-09-23).
 *
 * A fresh key is given USDG (fork-only reserve, storage write), buys $50 of each warmed Stock Token through Uniswap's
 * SwapRouter02 and sells it back. That loads the token-transfer paths the product's own trades take, and proves on the
 * fork that the pools fill. Every hash is printed.
 *
 * Run: FORK_RPC=http://127.0.0.1:8561 npx tsx src/fork/swap-check-robinhood.ts
 */
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http, maxUint256, parseAbi, parseUnits, toHex, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { robinhood } from 'viem/chains';
import { FORK_USDC_RESERVE, anvil, dealErc20 } from './anvil.js';
import { WARM_STOCKS } from './warm-robinhood-list.js';

const RPC = process.env.FORK_RPC ?? 'http://127.0.0.1:8545';
const chain = { ...robinhood, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const USDG: Address = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const ROUTER: Address = '0xcaf681a66d020601342297493863e78c959e5cb2';
const FEE: Record<string, number> = { NVDA: 500, TSLA: 3000, AAPL: 500, SPY: 500 };
const routerAbi = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)',
]);

async function main() {
  // The faucet reserve: what fork claims and bootstraps pay USDG from.
  await dealErc20({ rpc: RPC, token: USDG, holder: FORK_USDC_RESERVE, amount: parseUnits('10000000', 6) });
  console.log(`reserve ${FORK_USDC_RESERVE} holds 10,000,000 USDG on the fork`);

  const me = privateKeyToAccount(generatePrivateKey());
  await anvil(RPC, 'anvil_setBalance', [me.address, toHex(10n ** 18n)]);
  await dealErc20({ rpc: RPC, token: USDG, holder: me.address, amount: parseUnits('1000', 6) });
  const w = createWalletClient({ account: me, chain, transport: http(RPC) });
  const wait = (hash: `0x${string}`) => pub.waitForTransactionReceipt({ hash });
  await wait(await w.writeContract({ address: USDG, abi: erc20Abi, functionName: 'approve', args: [ROUTER, maxUint256] }));
  for (const s of WARM_STOCKS) {
    const fee = FEE[s.symbol]!;
    const buy = await w.writeContract({
      address: ROUTER,
      abi: routerAbi,
      functionName: 'exactInputSingle',
      args: [{ tokenIn: USDG, tokenOut: s.token, fee, recipient: me.address, amountIn: parseUnits('50', 6), amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }],
    });
    const r1 = await wait(buy);
    const got = await pub.readContract({ address: s.token, abi: erc20Abi, functionName: 'balanceOf', args: [me.address] });
    await wait(await w.writeContract({ address: s.token, abi: erc20Abi, functionName: 'approve', args: [ROUTER, maxUint256] }));
    const sell = await w.writeContract({
      address: ROUTER,
      abi: routerAbi,
      functionName: 'exactInputSingle',
      args: [{ tokenIn: s.token, tokenOut: USDG, fee, recipient: me.address, amountIn: got, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }],
    });
    const r2 = await wait(sell);
    console.log(`  ${s.symbol}: bought ${formatUnits(got, 18)} for 50 USDG (${r1.status}, ${buy}); sold back (${r2.status}, ${sell})`);
  }
  const left = await pub.readContract({ address: USDG, abi: erc20Abi, functionName: 'balanceOf', args: [me.address] });
  console.log(`USDG after four round trips: ${formatUnits(left, 6)} of 1000`);
}

await main();
