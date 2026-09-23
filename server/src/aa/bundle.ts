/**
 * Getting a Kernel user operation on-chain (PLAN.md P6.2, 2026-09-23).
 *
 * Two routes, chosen by the environment:
 *
 *   BUNDLER_RPC set   → a real ERC-4337 bundler (ZeroDev's `https://rpc.zerodev.app/api/v3/<project>/chain/42161`, or any
 *                       v0.7 bundler). Gas comes from `eth_estimateUserOperationGas`; `PAYMASTER_RPC`, when also set, is
 *                       used as a ZeroDev paymaster so the account needs no ETH.
 *   otherwise         → self-bundling, and only on anvil: the operation is built and signed with the SDK exactly as a
 *                       bundler would receive it, then this process acts as the bundler and calls
 *                       `EntryPoint.handleOps([op], beneficiary)` from a funded EOA. A node that answers
 *                       `web3_clientVersion` as anything but anvil is refused, so this path never spends on a real chain.
 *
 * Self-bundling simulates first (`eth_call` of handleOps). A refusal — the EntryPoint's `FailedOp` / `FailedOpWithRevert`,
 * with Kernel's inner error decoded — comes back as `refusal`, and by default nothing is sent. With `submitRefused` the
 * transaction is sent anyway with a fixed gas limit, so the refusal is a mined, reverted transaction with a hash.
 */
import { createKernelAccountClient, createZeroDevPaymasterClient, KernelV3_1AccountAbi } from '@zerodev/sdk';
import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  decodeErrorResult,
  http,
  parseAbi,
  parseEventLogs,
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type LocalAccount,
  type PublicClient,
} from 'viem';
import {
  entryPoint07Abi,
  entryPoint07Address,
  getUserOperationHash,
  toPackedUserOperation,
  type UserOperation,
} from 'viem/account-abstraction';
import type { KernelAccount } from './kernel.js';

export type Call = { to: Address; data?: Hex; value?: bigint };

export type BundleResult = {
  route: 'self' | 'bundler';
  userOpHash: Hex;
  /** The handleOps transaction (self route) or the bundle's transaction (bundler route), when one was mined. */
  txHash?: Hex;
  /** The operation was included and its execution succeeded. */
  success: boolean;
  /** Why validation refused it (EntryPoint FailedOp / bundler estimate error), decoded. */
  refusal?: string;
  /** Validation passed but the call reverted: the EntryPoint's UserOperationRevertReason, decoded. */
  executionRevert?: string;
  actualGasCost?: bigint;
};

export type GasLimits = {
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
};

/** Generous fixed limits: enable mode installs three policies during validation, the expensive case. */
export const DEFAULT_GAS: GasLimits = {
  callGasLimit: 1_500_000n,
  verificationGasLimit: 2_000_000n,
  preVerificationGas: 100_000n,
};

/** Errors a refusal can carry inside FailedOpWithRevert: Kernel's own, plus plain revert strings and panics. */
const INNER_ERRORS: Abi = [
  ...KernelV3_1AccountAbi.filter((x) => x.type === 'error'),
  ...parseAbi([
    'error Error(string)',
    'error Panic(uint256)',
    // CallPolicy v0.0.5 (0x85770b90…): not verified on any explorer; names matched by selector, origin seen in traces.
    'error CallViolatesParamRule()', // 0x59d52e40
    'error CallViolatesTargetRule()', // 0x007e472e
    'error CallViolatesValueRule()', // 0x7b5812d4
  ]),
];

export async function isAnvil(client: PublicClient): Promise<boolean> {
  try {
    const v = await client.request({ method: 'web3_clientVersion' });
    return /^anvil\//i.test(String(v));
  } catch {
    return false;
  }
}

/** Human-readable name of an inner revert blob. */
export function decodeInner(data: Hex | undefined): string {
  if (!data || data === '0x') return 'empty revert';
  try {
    const d = decodeErrorResult({ abi: INNER_ERRORS, data });
    const args = ((d.args ?? []) as unknown[]).map((a) => String(a));
    return `${d.errorName}(${args.join(', ')})`;
  } catch {
    return `unknown error ${data.slice(0, 10)} (${data})`;
  }
}

/** The EntryPoint's refusal inside a viem error, decoded; falls back to the short message. */
export function describeRefusal(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const data = reverted?.data;
    const args = (data?.args ?? []) as unknown[];
    if (data?.errorName === 'FailedOp') return `FailedOp(${String(args[1])})`;
    if (data?.errorName === 'FailedOpWithRevert') return `FailedOpWithRevert(${String(args[1])}) → ${decodeInner(args[2] as Hex)}`;
    if (data?.errorName) return `${data.errorName}(${args.map(String).join(', ')})`;
    if (reverted?.raw) return decodeInner(reverted.raw);
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

export type SendParams = {
  client: PublicClient;
  chain: Chain;
  account: KernelAccount;
  calls: Call[];
  /** Self route: the EOA that pays for handleOps and receives the refund. Must hold ETH on the fork. */
  bundler?: LocalAccount;
  /** Self route: mine a refused operation anyway (fixed gas) to get a reverted transaction hash. */
  submitRefused?: boolean;
  gas?: Partial<GasLimits>;
};

/** Send one user operation for `account` by whichever route the environment allows. */
export async function sendUserOp(p: SendParams): Promise<BundleResult> {
  const bundlerRpc = process.env.BUNDLER_RPC;
  if (bundlerRpc) return viaBundler(p, bundlerRpc, process.env.PAYMASTER_RPC);
  if (!(await isAnvil(p.client))) {
    throw new Error('Self-bundling runs only on an anvil fork; set BUNDLER_RPC to use a real bundler on this chain');
  }
  if (!p.bundler) throw new Error('Self-bundling needs a funded bundler EOA');
  return selfBundle({ ...p, bundler: p.bundler });
}

/** Build and sign the operation exactly as a bundler would receive it (fixed gas, no paymaster). */
export async function buildSignedUserOp(
  p: Pick<SendParams, 'client' | 'account' | 'calls' | 'gas'>,
): Promise<UserOperation<'0.7'>> {
  const { client, account } = p;
  const code = await client.getCode({ address: account.address });
  const deployed = !!code && code !== '0x';
  const factoryArgs = deployed ? {} : await account.getFactoryArgs();
  const block = await client.getBlock();
  const baseFee = block.baseFeePerGas ?? (await client.getGasPrice());
  const op: UserOperation<'0.7'> = {
    sender: account.address,
    nonce: await account.getNonce(),
    ...factoryArgs,
    callData: await account.encodeCalls(p.calls.map((c) => ({ to: c.to, data: c.data ?? '0x', value: c.value ?? 0n }))),
    ...DEFAULT_GAS,
    ...p.gas,
    maxFeePerGas: baseFee * 2n + 1n,
    maxPriorityFeePerGas: 0n,
    signature: '0x',
  };
  op.signature = await account.signUserOperation({ ...op, chainId: client.chain?.id ?? (await client.getChainId()) });
  return op;
}

async function selfBundle(p: SendParams & { bundler: LocalAccount }): Promise<BundleResult> {
  const { client, chain, bundler } = p;
  const op = await buildSignedUserOp(p);
  const userOpHash = getUserOperationHash({
    chainId: chain.id,
    entryPointAddress: entryPoint07Address,
    entryPointVersion: '0.7',
    userOperation: op,
  });
  const args = [[toPackedUserOperation(op)], bundler.address] as const;

  let refusal: string | undefined;
  try {
    await client.simulateContract({
      address: entryPoint07Address,
      abi: entryPoint07Abi,
      functionName: 'handleOps',
      args,
      account: bundler.address,
    });
  } catch (err) {
    refusal = describeRefusal(err);
  }
  if (refusal && !p.submitRefused) return { route: 'self', userOpHash, success: false, refusal };

  const wallet = createWalletClient({ account: bundler, chain, transport: http(rpcOf(client)) });
  const txHash = await wallet.writeContract({
    address: entryPoint07Address,
    abi: entryPoint07Abi,
    functionName: 'handleOps',
    args,
    gas: op.callGasLimit + op.verificationGasLimit + op.preVerificationGas + 500_000n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    return { route: 'self', userOpHash, txHash, success: false, refusal: refusal ?? 'handleOps reverted' };
  }

  const logs = parseEventLogs({ abi: entryPoint07Abi, logs: receipt.logs });
  let success: boolean | undefined;
  let actualGasCost: bigint | undefined;
  let executionRevert: string | undefined;
  for (const l of logs) {
    if (l.eventName === 'UserOperationEvent' && l.args.userOpHash === userOpHash) {
      success = l.args.success;
      actualGasCost = l.args.actualGasCost;
    }
    if (l.eventName === 'UserOperationRevertReason' && l.args.userOpHash === userOpHash) {
      executionRevert = decodeInner(l.args.revertReason);
    }
  }
  if (success === undefined) return { route: 'self', userOpHash, txHash, success: false, refusal: 'no UserOperationEvent in the receipt' };
  return { route: 'self', userOpHash, txHash, success, actualGasCost, executionRevert };
}

async function viaBundler(p: SendParams, bundlerRpc: string, paymasterRpc?: string): Promise<BundleResult> {
  const kernelClient = createKernelAccountClient({
    account: p.account,
    chain: p.chain,
    client: p.client,
    bundlerTransport: http(bundlerRpc),
    paymaster: paymasterRpc ? createZeroDevPaymasterClient({ chain: p.chain, transport: http(paymasterRpc) }) : undefined,
  });
  let userOpHash: Hex;
  try {
    userOpHash = await kernelClient.sendUserOperation({
      calls: p.calls.map((c) => ({ to: c.to, data: c.data ?? '0x', value: c.value ?? 0n })),
    });
  } catch (err) {
    return { route: 'bundler', userOpHash: '0x', success: false, refusal: describeRefusal(err) };
  }
  const receipt = await kernelClient.waitForUserOperationReceipt({ hash: userOpHash });
  return {
    route: 'bundler',
    userOpHash,
    txHash: receipt.receipt.transactionHash,
    success: receipt.success,
    actualGasCost: receipt.actualGasCost,
    executionRevert: receipt.success ? undefined : receipt.reason,
  };
}

function rpcOf(client: PublicClient): string {
  const url = (client.transport as { url?: string }).url ?? client.chain?.rpcUrls.default.http[0];
  if (!url) throw new Error('The public client has no HTTP URL to send handleOps through');
  return url;
}
