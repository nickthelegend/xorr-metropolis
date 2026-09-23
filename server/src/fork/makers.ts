/**
 * Fork funding helpers: the real USDC holder the fork faucet pays from, and a 1inch limit-order maker (PLAN.md 3.15).
 *
 * The Aqua book and SwapVM program makers that lived here are gone (2026-09-23): those books existed only on Base, and
 * the contracts were removed from this repo (PLAN.md P0.3).
 */
import { randomBytes } from 'node:crypto';
import { bytesToBigInt, createPublicClient, createWalletClient, erc20Abi, http, parseUnits, type Address, type Hex } from 'viem';
import { base } from 'viem/chains';
import { IS_ARBITRUM, IS_ROBINHOOD } from '../evm/chains.js';
import { FORK_USDC_RESERVE } from './anvil.js';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import {
  LOP_ROUTER,
  buildMakerTraits,
  hashLimitOrder,
  limitOrderTypedData,
  type LimitOrder,
} from '../venues/limit-orders.js';

export const USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const WETH: Address = '0x4200000000000000000000000000000000000006';
/**
 * Aave v3's aUSDC reserve on Base — a real contract holding tens of millions of real USDC.
 *
 * Exported for the executor's fork faucet (`evm/faucet.ts`), which funds a new wallet from the same holder.
 */
/**
 * The holder the fork faucet pays the settlement token from.
 *
 * Aave v3's aUSDC reserve: Base's, or Arbitrum One's (aArbUSDCn, ~20M native USDC) on an Arbitrum key. On a Robinhood
 * Chain key it is the fork-only reserve `FORK_USDC_RESERVE` (`fork/anvil.ts`), which holds 10,000,000 USDG on the hosted
 * node (written by `fork/swap-check-robinhood.ts`): the snapshot node has no upstream, so no real USDG holder's balance
 * is guaranteed to be loaded there, and taking USDG out of a Stock Token pool would move the prices the demo trades at.
 */
export const WHALE: Address = IS_ROBINHOOD
  ? FORK_USDC_RESERVE
  : IS_ARBITRUM
    ? '0x724dc807b04555b71ed48a6896b6F41593b8C637'
    : '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB';
const MAX = (1n << 256n) - 1n;

const WETH_DEPOSIT_ABI = [{ type: 'function', name: 'deposit', inputs: [], outputs: [], stateMutability: 'payable' }] as const;

const ORDER_COMPONENTS = [
  { name: 'maker', type: 'address' },
  { name: 'traits', type: 'uint256' },
  { name: 'data', type: 'bytes' },
] as const;

function forkClients(rpc: string) {
  const chain = { ...base, rpcUrls: { default: { http: [rpc] }, public: { http: [rpc] } } };
  return { chain, pub: createPublicClient({ chain, transport: http(rpc), cacheTime: 0 }) };
}

/** One JSON-RPC call, cheats included. No retries, so a call that moves value is never sent twice. */
export async function anvil(rpc: string, method: string, params: unknown[]): Promise<unknown> {
  const r = (await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }).then((x) => x.json())) as { result?: unknown; error?: { message: string } };
  if (r.error) throw new Error(`${method}: ${r.error.message}`);
  return r.result;
}

/**
 * A fresh maker for 1inch limit orders (PLAN.md 3.15): gas, `weth` wrapped from its own ETH, and the 1inch router
 * allowed to take exactly that much.
 *
 * A limit order is filled by the router pulling the maker's tokens straight from the maker's wallet, so the allowance
 * goes to the router rather than to Aqua. It is exactly what the maker means to sell: an order beyond it reads as
 * unfunded in the list instead of letting the router take more than was offered.
 */
export async function newLimitOrderMaker(opts: { rpc: string; weth: bigint }): Promise<{
  maker: Address;
  account: PrivateKeyAccount;
  pub: ReturnType<typeof forkClients>['pub'];
  wrapTx: Hex;
  approveTx: Hex;
}> {
  if (!(opts.weth > 0n)) throw new Error('a limit-order maker needs some WETH to sell');
  const { chain, pub } = forkClients(opts.rpc);
  const account = privateKeyToAccount(generatePrivateKey());
  await anvil(opts.rpc, 'anvil_setBalance', [account.address, `0x${(opts.weth + parseUnits('10', 18)).toString(16)}`]);
  const wallet = createWalletClient({ account, chain, transport: http(opts.rpc) });

  const wrapTx = await wallet.writeContract({ address: WETH, abi: WETH_DEPOSIT_ABI, functionName: 'deposit', value: opts.weth });
  await pub.waitForTransactionReceipt({ hash: wrapTx });
  const approveTx = await wallet.writeContract({ address: WETH, abi: erc20Abi, functionName: 'approve', args: [LOP_ROUTER, opts.weth] });
  if ((await pub.waitForTransactionReceipt({ hash: approveTx })).status !== 'success') {
    throw new Error(`approving the 1inch router reverted: ${approveTx}`);
  }
  return { maker: account.address, account, pub, wrapTx, approveTx };
}

/**
 * Sign a WETH → USDC limit order (PLAN.md 3.15): `makingAmount` of WETH for `takingAmount` of USDC, paid to the maker,
 * takeable by anyone until `expiration` (unix seconds), under `nonce`.
 *
 * All or nothing (`NO_PARTIAL_FILLS`). A take through the permission is whole by construction — `spend()` pulls exactly
 * the taking amount and holds the owner to the whole making amount — so an order someone else could part-fill first
 * would sit in the list at a size nobody here can take. A whole order also spends one nonce bit, which is a single read
 * to say whether it is still open and a single call for its maker to cancel it.
 */
export async function signLimitOrder(opts: {
  account: PrivateKeyAccount;
  chainId: number;
  makingAmount: bigint;
  takingAmount: bigint;
  expiration: bigint;
  nonce: bigint;
}): Promise<{ order: LimitOrder; signature: Hex; hash: Hex }> {
  const order: LimitOrder = {
    // With no extension the router reads nothing from the salt; it only keeps otherwise identical orders apart.
    salt: bytesToBigInt(randomBytes(12)),
    maker: opts.account.address,
    receiver: opts.account.address,
    makerAsset: WETH,
    takerAsset: USDC,
    makingAmount: opts.makingAmount,
    takingAmount: opts.takingAmount,
    makerTraits: buildMakerTraits({ expiration: opts.expiration, nonce: opts.nonce, noPartialFills: true }),
  };
  const signature = await opts.account.signTypedData(limitOrderTypedData(order, opts.chainId));
  return { order, signature, hash: hashLimitOrder(order, opts.chainId) };
}

/** The body `POST /limit-orders` takes. Every uint256 is a decimal string: JSON has no integer that wide. */
export function limitOrderBody(order: LimitOrder, signature: Hex) {
  return {
    order: {
      salt: order.salt.toString(),
      maker: order.maker,
      receiver: order.receiver,
      makerAsset: order.makerAsset,
      takerAsset: order.takerAsset,
      makingAmount: order.makingAmount.toString(),
      takingAmount: order.takingAmount.toString(),
      makerTraits: order.makerTraits.toString(),
    },
    signature,
  };
}
