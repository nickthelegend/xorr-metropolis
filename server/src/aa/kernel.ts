/**
 * ZeroDev Kernel v3 accounts with an agent session key (PLAN.md P6.1, 2026-09-23).
 *
 * Each user gets a Kernel v3.1 account on EntryPoint v0.7. Its sudo (root) validator is the ECDSA validator owned by the
 * user's EOA — the Privy wallet in the app, a generated key in proofs. The agent never holds that key. What it holds is a
 * *permission validator*: an ECDSA signer (the agent's session key) wrapped in three policies —
 *
 *   CallPolicy v0.0.5   only two calls, each argument pinned:
 *                         USDC.approve(spender == SwapRouter02, amount <= perTradeCap)
 *                         SwapRouter02.exactInputSingle({tokenIn ∈ {USDC, WETH}, tokenOut ∈ {USDC, WETH},
 *                                                        recipient == this Kernel account, amountIn <= perTradeCap})
 *                       no native value on either.
 *   RateLimitPolicy     at most `tradesPerDay` user operations per 86 400 s.
 *   TimestampPolicy     validUntil = expiresAt.
 *
 * The owner grants the permission by signing Kernel's `Enable` typed data (sudo validator) over that exact validator —
 * `grantSessionKey` returns the result serialized (`serializePermissionAccount`), with no private key inside. The backend
 * keeps that string and the agent's key; `agentAccount` joins them back into an account whose first user operation
 * installs the permission on-chain (Kernel's enable mode) and whose later ones use it.
 *
 * Addresses (all verified on Arbitrum One and Sepolia): EntryPoint v0.7 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
 * Kernel 0.3.1 factory 0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419; CallPolicy v0.0.5 0x85770b902D1e503D5f5141d9eaC16d0d08eEaDd2;
 * RateLimit 0xf63d4139B25c836334edD76641356c6b74C86873; Timestamp 0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F;
 * ECDSA signer 0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF. The SDK's defaults are these same addresses; they are pinned
 * here so an SDK upgrade cannot move them silently.
 */
import { createKernelAccount, KernelV3_1AccountAbi, type CreateKernelAccountReturnType } from '@zerodev/sdk';
import { getEntryPoint, KERNEL_V3_1 } from '@zerodev/sdk/constants';
import type { Signer } from '@zerodev/sdk/types';
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import {
  deserializePermissionAccount,
  serializePermissionAccount,
  toPermissionValidator,
  type Policy,
} from '@zerodev/permissions';
import {
  CallPolicyVersion,
  ParamCondition,
  toCallPolicy,
  toRateLimitPolicy,
  toTimestampPolicy,
} from '@zerodev/permissions/policies';
import { toECDSASigner, toEmptyECDSASigner } from '@zerodev/permissions/signers';
import {
  concatHex,
  encodeFunctionData,
  erc20Abi,
  pad,
  parseAbi,
  toFunctionSelector,
  toHex,
  type Address,
  type Hex,
  type LocalAccount,
  type PublicClient,
} from 'viem';

export const ENTRY_POINT = getEntryPoint('0.7');
export const KERNEL_VERSION = KERNEL_V3_1;

export const AA_ADDRESSES = {
  entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  kernelFactory: '0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419',
  callPolicy: '0x85770b902D1e503D5f5141d9eaC16d0d08eEaDd2',
  rateLimitPolicy: '0xf63d4139B25c836334edD76641356c6b74C86873',
  timestampPolicy: '0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F',
  ecdsaSigner: '0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF',
} as const satisfies Record<string, Address>;

/** Arbitrum One tokens and the Uniswap v3 router the agent may touch. */
export const ARB = {
  USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  SwapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  QuoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
} as const satisfies Record<string, Address>;

export const swapRouter02Abi = parseAbi([
  'struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }',
  'function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)',
]);

const EXACT_INPUT_SINGLE = toFunctionSelector(swapRouter02Abi[0]);
const APPROVE = toFunctionSelector('function approve(address,uint256)');

export type KernelAccount = CreateKernelAccountReturnType<'0.7'>;

/** What the owner lets the agent do. Amounts are USDC base units (6 dp); `expiresAt` is unix seconds. */
export type SessionGrant = {
  sessionKeyAddress: Address;
  perTradeCapUsdc: bigint;
  tradesPerDay: number;
  expiresAt: number;
};

const DAY = 86_400;
const word = (v: Address | bigint): Hex => pad(typeof v === 'bigint' ? toHex(v) : v, { size: 32 });

/** The sudo validator: the owner's EOA through ZeroDev's ECDSA validator. `owner` may be a viem account or wallet. */
export async function ownerValidator(client: PublicClient, owner: Signer) {
  return signerToEcdsaValidator(client, { signer: owner, entryPoint: ENTRY_POINT, kernelVersion: KERNEL_VERSION });
}

/**
 * The owner's own Kernel account (sudo mode): deploys it, signs the enable of a permission, uninstalls it. The address is
 * counterfactual — the same before and after deployment — and depends only on the owner and `index`.
 */
export async function ownerKernelAccount(client: PublicClient, owner: Signer, index = 0n): Promise<KernelAccount> {
  return createKernelAccount(client, {
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
    plugins: { sudo: await ownerValidator(client, owner) },
    index,
    useMetaFactory: false,
  });
}

/** The Kernel address an owner gets at `index`, deployed or not. */
export async function kernelAddressFor(client: PublicClient, owner: Signer, index = 0n): Promise<Address> {
  return (await ownerKernelAccount(client, owner, index)).address;
}

/**
 * The three policies of an agent's permission. The recipient rule pins swaps to the Kernel account itself, so the agent
 * can move value only between USDC and WETH inside the user's own account.
 *
 * Note on units: CallPolicy compares raw words, so `amountIn <= perTradeCapUsdc` is in the tokenIn's own base units. For a
 * USDC→WETH buy that is the USDC cap; for a WETH→USDC sell it is the same integer read as WETH wei (20e6 wei = 2e-11
 * WETH), which in practice lets the agent buy but not sell. A sell cap in WETH needs a second router selector
 * (e.g. exactInput) with its own rule, since CallPolicy keys one rule set per (target, selector).
 */
export function agentPolicies(grant: SessionGrant, kernelAddress: Address): Policy[] {
  if (grant.perTradeCapUsdc <= 0n) throw new Error('perTradeCapUsdc must be positive');
  if (!Number.isInteger(grant.tradesPerDay) || grant.tradesPerDay < 1) throw new Error('tradesPerDay must be a positive integer');
  if (grant.expiresAt <= Math.floor(Date.now() / 1000) - DAY) throw new Error('expiresAt is already in the past');
  const pair = [word(ARB.USDC), word(ARB.WETH)];
  return [
    toCallPolicy({
      policyVersion: CallPolicyVersion.V0_0_5,
      policyAddress: AA_ADDRESSES.callPolicy,
      permissions: [
        {
          target: ARB.USDC,
          selector: APPROVE,
          valueLimit: 0n,
          rules: [
            { condition: ParamCondition.EQUAL, offset: 0, params: [word(ARB.SwapRouter02)] },
            { condition: ParamCondition.LESS_THAN_OR_EQUAL, offset: 32, params: [word(grant.perTradeCapUsdc)] },
          ],
        },
        {
          target: ARB.SwapRouter02,
          selector: EXACT_INPUT_SINGLE,
          valueLimit: 0n,
          // ExactInputSingleParams is a static tuple, so its fields sit inline: tokenIn @0, tokenOut @32, fee @64,
          // recipient @96, amountIn @128, amountOutMinimum @160, sqrtPriceLimitX96 @192.
          rules: [
            { condition: ParamCondition.ONE_OF, offset: 0, params: pair },
            { condition: ParamCondition.ONE_OF, offset: 32, params: pair },
            { condition: ParamCondition.EQUAL, offset: 96, params: [word(kernelAddress)] },
            { condition: ParamCondition.LESS_THAN_OR_EQUAL, offset: 128, params: [word(grant.perTradeCapUsdc)] },
          ],
        },
      ],
    }),
    toRateLimitPolicy({ policyAddress: AA_ADDRESSES.rateLimitPolicy, interval: DAY, count: grant.tradesPerDay }),
    toTimestampPolicy({ policyAddress: AA_ADDRESSES.timestampPolicy, validAfter: 0, validUntil: grant.expiresAt }),
  ];
}

/**
 * The permission validator for a grant. Owner-side it is built from the session key's *address* only
 * (`toEmptyECDSASigner`); agent-side `agentAccount` rebuilds it with the real key from the serialized form.
 */
export async function permissionValidatorFor(client: PublicClient, grant: SessionGrant, kernelAddress: Address) {
  return toPermissionValidator(client, {
    signer: toEmptyECDSASigner(grant.sessionKeyAddress, AA_ADDRESSES.ecdsaSigner),
    policies: agentPolicies(grant, kernelAddress),
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
  });
}

export type Granted = {
  kernelAddress: Address;
  /** `serializePermissionAccount` output: policies, account init code and the owner's enable signature. No key. */
  approval: string;
  /** The permission id (bytes4) Kernel stores the validator under. */
  permissionId: Hex;
  /** Kernel's validation id for it: 0x02 ‖ permissionId, right-padded to bytes21. */
  validationId: Hex;
};

/**
 * Owner-side: sign the enable of the agent's permission and serialize it for the backend. The owner signs one EIP-712
 * `Enable` message (Kernel v3 typed data bound to the account, chain, validator, selector and the account's current
 * validation nonce). Nothing is sent on-chain here; the agent's first user operation carries the signature.
 */
export async function grantSessionKey(client: PublicClient, owner: Signer, grant: SessionGrant, index = 0n): Promise<Granted> {
  const sudo = await ownerValidator(client, owner);
  const kernelAddress = await kernelAddressFor(client, owner, index);
  const regular = await permissionValidatorFor(client, grant, kernelAddress);
  const account = await createKernelAccount(client, {
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
    plugins: { sudo, regular },
    index,
    address: kernelAddress,
    useMetaFactory: false,
  });
  const approval = await serializePermissionAccount(account);
  const permissionId = regular.getIdentifier();
  return { kernelAddress, approval, permissionId, validationId: validationIdOf(permissionId) };
}

export function validationIdOf(permissionId: Hex): Hex {
  return concatHex(['0x02', pad(permissionId, { size: 20, dir: 'right' })]);
}

/** Agent-side: the serialized approval plus the session key → a Kernel account that signs with the permission. */
export async function agentAccount(client: PublicClient, approval: string, sessionKey: LocalAccount): Promise<KernelAccount> {
  const signer = await toECDSASigner({ signer: sessionKey, signerContractAddress: AA_ADDRESSES.ecdsaSigner });
  return deserializePermissionAccount(client, ENTRY_POINT, KERNEL_VERSION, approval, signer);
}

/** The permission plugin inside an approval, rebuilt without the session key (for uninstalling it). */
export async function permissionFromApproval(client: PublicClient, approval: string, sessionKeyAddress: Address) {
  const account = await deserializePermissionAccount(
    client,
    ENTRY_POINT,
    KERNEL_VERSION,
    approval,
    toEmptyECDSASigner(sessionKeyAddress, AA_ADDRESSES.ecdsaSigner),
  );
  const plugin = account.kernelPluginManager.regularValidator;
  if (!plugin) throw new Error('The approval carries no permission validator');
  return { kernelAddress: account.address, plugin };
}

/** On-chain state of a permission on a Kernel account. */
export async function permissionState(client: PublicClient, kernelAddress: Address, permissionId: Hex) {
  const at = { address: kernelAddress, abi: KernelV3_1AccountAbi } as const;
  const [config, currentNonce, validNonceFrom, validation] = await Promise.all([
    client.readContract({ ...at, functionName: 'permissionConfig', args: [permissionId] }),
    client.readContract({ ...at, functionName: 'currentNonce' }),
    client.readContract({ ...at, functionName: 'validNonceFrom' }),
    client.readContract({ ...at, functionName: 'validationConfig', args: [validationIdOf(permissionId)] }),
  ]);
  return {
    installed: config.signer.toLowerCase() === AA_ADDRESSES.ecdsaSigner.toLowerCase(),
    signer: config.signer,
    validationNonce: validation.nonce,
    hook: validation.hook,
    currentNonce,
    validNonceFrom,
  };
}

/** The two calls of one capped buy: approve exactly `amountIn` to the router, then swap USDC→WETH into `recipient`. */
export function buyWethCalls(p: { amountIn: bigint; recipient: Address; fee?: number; amountOutMinimum?: bigint }) {
  return [
    {
      to: ARB.USDC as Address,
      value: 0n,
      data: encodeApprove(ARB.SwapRouter02, p.amountIn),
    },
    {
      to: ARB.SwapRouter02 as Address,
      value: 0n,
      data: encodeExactInputSingle({
        tokenIn: ARB.USDC,
        tokenOut: ARB.WETH,
        fee: p.fee ?? 500,
        recipient: p.recipient,
        amountIn: p.amountIn,
        amountOutMinimum: p.amountOutMinimum ?? 0n,
      }),
    },
  ];
}

function encodeApprove(spender: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] });
}

function encodeExactInputSingle(p: {
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  recipient: Address;
  amountIn: bigint;
  amountOutMinimum: bigint;
}): Hex {
  return encodeFunctionData({
    abi: swapRouter02Abi,
    functionName: 'exactInputSingle',
    args: [{ ...p, sqrtPriceLimitX96: 0n }],
  });
}
