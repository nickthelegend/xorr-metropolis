/**
 * The owner takes the agent's permission away (PLAN.md P6.3, 2026-09-23).
 *
 * One user operation, signed by the owner's sudo validator, calling the Kernel account itself:
 *
 *   uninstallValidation(0x02‖permissionId, deinitData, 0x)
 *     Clears the permission's signer and policies (each policy's and the signer's `onUninstall` gets its slice of
 *     `deinitData`, which is the same bytes[] the enable installed). Measured on an Arbitrum fork (prove-zerodev.ts):
 *       - a default-mode op signed by the session key is then refused — Kernel reads signer = address(0) and the
 *         validation reverts (EntryPoint "AA23 reverted", empty revert data);
 *       - replaying the owner's Enable signature from the approval the backend still holds is refused with Kernel's
 *         InvalidNonce(): the validation id keeps the nonce it was installed at, so it cannot be enabled again at it.
 *
 *   invalidateNonce(currentNonce + 1)   — only with `invalidateNonce: true`
 *     Raises Kernel's validation nonce. Needed to cancel a grant the agent has NOT used yet (its Enable signature is
 *     still valid at the current nonce). It is blunt: every non-root validator enabled below the new nonce stops
 *     validating too, i.e. every other agent on this account must be granted again.
 *
 * The SDK's `uninstallPlugin` sends the same uninstall; this module adds the replay-proof check, the bundling route
 * (self or BUNDLER_RPC) and the optional nonce bump.
 */
import { KernelV3_1AccountAbi } from '@zerodev/sdk';
import type { Signer } from '@zerodev/sdk/types';
import { encodeFunctionData, type Address, type Chain, type Hex, type LocalAccount, type PublicClient } from 'viem';
import { sendUserOp, type BundleResult, type Call } from './bundle.js';
import { ownerKernelAccount, permissionFromApproval, validationIdOf } from './kernel.js';

export type RevokeParams = {
  client: PublicClient;
  chain: Chain;
  owner: Signer;
  /** The serialized approval the grant produced (the backend's copy). */
  approval: string;
  sessionKeyAddress: Address;
  index?: bigint;
  /** Self-bundling only: the funded EOA that submits handleOps. */
  bundler?: LocalAccount;
  /** Also call invalidateNonce: kills every enable signature not yet used AND every non-root validator enabled so far. */
  invalidateNonce?: boolean;
};

/** The owner calls that revoke a permission, for callers that bundle them with other owner calls. */
export async function revokeCalls(p: Omit<RevokeParams, 'owner' | 'chain' | 'bundler' | 'index'>): Promise<{ kernelAddress: Address; permissionId: Hex; calls: Call[] }> {
  const { kernelAddress, plugin } = await permissionFromApproval(p.client, p.approval, p.sessionKeyAddress);
  const permissionId = plugin.getIdentifier();
  const deinitData = await plugin.getEnableData(kernelAddress);
  const currentNonce = await p.client.readContract({ address: kernelAddress, abi: KernelV3_1AccountAbi, functionName: 'currentNonce' });
  return {
    kernelAddress,
    permissionId,
    calls: [
      {
        to: kernelAddress,
        data: encodeFunctionData({
          abi: KernelV3_1AccountAbi,
          functionName: 'uninstallValidation',
          args: [validationIdOf(permissionId), deinitData, '0x'],
        }),
      },
      ...(p.invalidateNonce
        ? [
            {
              to: kernelAddress,
              data: encodeFunctionData({ abi: KernelV3_1AccountAbi, functionName: 'invalidateNonce', args: [currentNonce + 1] }),
            },
          ]
        : []),
    ],
  };
}

/** Owner-signed revoke: uninstall the permission (and optionally bump the nonce), in one user operation. */
export async function revokePermission(p: RevokeParams): Promise<BundleResult & { permissionId: Hex }> {
  const { kernelAddress, permissionId, calls } = await revokeCalls(p);
  const owner = await ownerKernelAccount(p.client, p.owner, p.index ?? 0n);
  if (owner.address.toLowerCase() !== kernelAddress.toLowerCase()) {
    throw new Error(`The approval is for ${kernelAddress}, but this owner's Kernel account is ${owner.address}`);
  }
  const result = await sendUserOp({ client: p.client, chain: p.chain, account: owner, calls, bundler: p.bundler });
  return { ...result, permissionId };
}
