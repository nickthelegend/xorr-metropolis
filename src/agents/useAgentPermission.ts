/**
 * Hiring and stopping one agent on the chain (individual agents, 2026-09-23).
 *
 * Hiring is two acts in this order: the OWNER's wallet signs `grantAgent(agentWallet, cap, end)` on `XorrDelegation`, and
 * only once the chain shows that permission is the agent hired on the executor (`POST /agents`). The other order would
 * leave an agent "hired" that the contract refuses, which reads as an agent that trades and does not.
 *
 * Stopping signs `revokeAgent(agentWallet)`: that agent alone stops, every other keeps its permission. Safety's kill
 * switch (`revoke()`) still stops every agent at once.
 *
 * Every signature goes out on the same path as the onboarding grant — `useGrantDelegation().sendTransaction`, which is
 * `sendAsUser` (`src/wallet/userSigning.ts`): the embedded wallet put on this build's chain, and on a fork build signing
 * only while the app broadcasts to the fork. Where a signature may go is checked first, exactly as the onboarding grant
 * checks it (`assertGrantDestination`), and what it did is read back from the chain before anything says it happened.
 */
import { useCallback, useState } from 'react';
import { isAddress, isAddressEqual, encodeFunctionData, type Address, type Hex } from 'viem';
import { api } from '@/data/api';
import { repos } from '@/data';
import { ApiError, errorText } from '@/data/apiError';
import { pinnedDelegation } from '@/chain';
import type { Agent } from '@/data/types';
import { useAuth } from '@/auth/useAuth';
import { useGrantDelegation } from '@/auth/useGrantDelegation';
import { chainAccess } from '@/wallet/chainAccess';
import { assertGrantDestination } from '@/wallet/delegationChain';
import { humanWalletError } from '@/wallet/walletError';
import {
  AGENT_DELEGATION_ABI,
  ERC20_ALLOWANCE_ABI,
  allowanceShortfall,
  capUnits,
  encodeGrantAgent,
  encodeRevokeAgent,
  type PermissionOffer,
} from './agentPermission';

/** How long a signed transaction waits for its receipt. The fork mines at once. */
const RECEIPT_TIMEOUT_MS = 60_000;

type DelegationParams = { contract: Address; venues: Address[]; token: Address };

/** An agent's persona id: what `/agents/:personaId/permission` and `POST /agents` take. */
export const personaIdOf = (agent: Pick<Agent, 'id' | 'personaId'>) => agent.personaId ?? agent.id;

/** What a finished hire or stop did: the transaction, and what the executor said afterwards if it refused. */
export type AgentTxResult = { txHash: Hex; after?: string };

/** The owner has no grant of their own on this contract, so no venue is allowed and an agent could not trade. */
export class NeedsOwnGrant extends Error {
  override name = 'NeedsOwnGrant';
}

/** One line for any failure here: the server's sentence, or the wallet's humanised. */
export function agentTxError(e: unknown): string {
  return e instanceof ApiError ? errorText(e) : humanWalletError(e);
}

export function fetchPermissionOffer(agent: Pick<Agent, 'id' | 'personaId'>): Promise<PermissionOffer> {
  return api.get<PermissionOffer>(`/agents/${encodeURIComponent(personaIdOf(agent))}/permission`);
}

/** Whether the owner's stop-all holds on `contract`. Undefined when the chain did not answer. */
export async function readStopped(contract: Address, owner: Address): Promise<boolean | undefined> {
  return chainAccess
    .readContract({ address: contract, abi: AGENT_DELEGATION_ABI, functionName: 'isStopped', args: [owner] })
    .catch(() => undefined);
}

async function landed(hash: Hex, what: string): Promise<void> {
  let status: 'success' | 'reverted';
  try {
    status = (await chainAccess.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS })).status;
  } catch {
    // Not "nothing was sent", which a timeout reads as elsewhere: this one was.
    throw new Error(`The ${what} was sent (${hash.slice(0, 10)}…) and the chain has not confirmed it yet.`);
  }
  if (status !== 'success') throw new Error(`The ${what} reverted on the chain, so nothing changed.`);
}

async function agentPolicy(contract: Address, owner: Address, delegate: Address) {
  const [dailyCap, expiresAt, revoked, stopped] = await chainAccess.readContract({
    address: contract,
    abi: AGENT_DELEGATION_ABI,
    functionName: 'agentPolicyOf',
    args: [owner, delegate],
  });
  return { dailyCap, expiresAt, revoked, stopped };
}

export function useAgentPermission() {
  const { address } = useAuth();
  const owner = address && isAddress(address, { strict: false }) ? (address as Address) : undefined;
  const { sendTransaction } = useGrantDelegation();
  /** The agent a signature is out for, by persona id. */
  const [busy, setBusy] = useState<string>();

  const hire = useCallback(
    async (agent: Agent, dailyCapUsd: number, days: number): Promise<AgentTxResult> => {
      const pid = personaIdOf(agent);
      setBusy(pid);
      try {
        if (!owner) throw new Error('No wallet yet. Finish sign-in first.');
        const [offer, params] = await Promise.all([
          fetchPermissionOffer(agent),
          api.get<DelegationParams>('/delegation/params'),
        ]);
        if (!isAddress(offer.delegate, { strict: false })) {
          throw new Error('The server did not name this agent’s wallet, so nothing was signed.');
        }
        const contract = offer.contract;
        if (!isAddressEqual(contract, params.contract)) {
          throw new Error('The server named two different contracts, so nothing was signed.');
        }
        // A contract on this chain, and the one this build pinned — before the first prompt.
        await assertGrantDestination(chainAccess, contract, pinnedDelegation);

        /*
         * An agent trades on the venues the owner's own grant allowed and pulls from the owner's one allowance. Without
         * the first, `grantAgent` would land and every trade after it revert `VenueNotAllowed` — an agent hired that
         * cannot trade. Said before anything is signed.
         */
        const [allowed, allowance] = await Promise.all([
          Promise.all(
            params.venues.map((venue) =>
              chainAccess.readContract({
                address: contract,
                abi: AGENT_DELEGATION_ABI,
                functionName: 'isVenueAllowed',
                args: [owner, venue],
              }),
            ),
          ),
          chainAccess.readContract({
            address: params.token,
            abi: ERC20_ALLOWANCE_ABI,
            functionName: 'allowance',
            args: [owner, contract],
          }),
        ]);
        if (!allowed.some(Boolean)) {
          throw new NeedsOwnGrant('Set your own trading limits first. Agents trade on the venues you allow there.');
        }
        const extra = allowanceShortfall(allowance, dailyCapUsd, days);
        if (extra > 0n) {
          const approval = await sendTransaction(
            params.token,
            encodeFunctionData({ abi: ERC20_ALLOWANCE_ABI, functionName: 'approve', args: [contract, allowance + extra] }),
          );
          await landed(approval, 'approval');
        }

        const txHash = await sendTransaction(contract, encodeGrantAgent(offer.delegate, dailyCapUsd, days, Date.now()));
        await landed(txHash, 'permission');
        const policy = await agentPolicy(contract, owner, offer.delegate);
        if (policy.dailyCap !== capUnits(dailyCapUsd) || policy.revoked || policy.stopped) {
          throw new Error('The permission landed, but the chain does not show it for this agent.');
        }

        // Then the executor's row. The permission already stands on the chain; a refusal here is said beside its hash.
        if (agent.hired) return { txHash };
        try {
          await repos.bot.hire(pid);
          return { txHash };
        } catch (e) {
          return { txHash, after: `Permission signed, but the hire did not save: ${errorText(e)}` };
        }
      } finally {
        setBusy(undefined);
      }
    },
    [owner, sendTransaction],
  );

  const stop = useCallback(
    async (agent: Agent, options: { fire?: boolean } = {}): Promise<AgentTxResult> => {
      const pid = personaIdOf(agent);
      setBusy(pid);
      try {
        if (!owner) throw new Error('No wallet yet. Finish sign-in first.');
        const delegate = agent.wallet;
        if (!delegate || !isAddress(delegate, { strict: false })) {
          throw new Error('This agent’s wallet is not known, so there is nothing to stop.');
        }
        // The build's own contract when it pinned one, so a stop does not wait on the server that holds the agent's key.
        const contract = pinnedDelegation ?? (await fetchPermissionOffer(agent)).contract;
        await assertGrantDestination(chainAccess, contract, pinnedDelegation);

        const txHash = await sendTransaction(contract, encodeRevokeAgent(delegate as Address));
        await landed(txHash, 'stop');
        if (!(await agentPolicy(contract, owner, delegate as Address)).revoked) {
          throw new Error('The stop landed, but the chain does not show this agent stopped.');
        }
        if (!options.fire || !agent.hired) return { txHash };
        try {
          await repos.bot.fire(agent.id);
          return { txHash };
        } catch (e) {
          return { txHash, after: `Stopped on-chain, but the roster did not update: ${errorText(e)}` };
        }
      } finally {
        setBusy(undefined);
      }
    },
    [owner, sendTransaction],
  );

  return { hire, stop, busy, owner };
}
