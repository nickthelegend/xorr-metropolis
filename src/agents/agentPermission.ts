/**
 * Individual agents (2026-09-23): each agent is its own wallet, and the owner gives each one its own permission.
 *
 * `XorrDelegation.grantAgent(delegate, dailyCap, expiresAt)` names one agent's wallet with its own cap and end date, under
 * the venues the owner's onboarding grant already allowed; `revokeAgent(delegate)` stops that agent alone; `revoke()`
 * (Safety's kill switch) still stops every agent at once. The executor holds each agent's key and names its address
 * (`GET /agents/:personaId/permission`); the OWNER's wallet signs, never the executor.
 *
 * Everything shown about a permission comes from the executor's `permission` row, which it read off the chain. Nothing
 * here computes a cap, a remainder or a date the server did not give.
 */
import { activeChain } from '@/chain';
import { encodeFunctionData, parseUnits, type Address, type Hex } from 'viem';
import { day, money, quantity, shortAddress } from '@/format';

/** The entries of `XorrDelegation` the app signs or reads for an agent (server/src/evm/delegation.ts `DELEGATION_ABI`). */
export const AGENT_DELEGATION_ABI = [
  {
    type: 'function',
    name: 'grantAgent',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'delegate', type: 'address' },
      { name: 'dailyCap', type: 'uint256' },
      { name: 'expiresAt', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revokeAgent',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'delegate', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'agentPolicyOf',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'delegate', type: 'address' },
    ],
    outputs: [
      { name: 'dailyCap', type: 'uint256' },
      { name: 'expiresAt', type: 'uint64' },
      { name: 'revoked', type: 'bool' },
      { name: 'stopped', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'isStopped',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isVenueAllowed',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'venue', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/** The two ERC-20 entries a hire may need: the settlement token's allowance to the contract, and raising it. */
export const ERC20_ALLOWANCE_ABI = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/** USDG and USDC both carry 6 decimals; the cap is a dollar figure. */
export const CAP_DECIMALS = 6;

/** One agent's permission, as the executor read it off the chain (`GET /agents` → `permission`). */
export type AgentPermission = {
  dailyCapUsd: number;
  remainingTodayUsd: number;
  spentTodayUsd: number;
  /** Epoch ms. */
  expiresAt: number;
  /** The agent's own revoke, or the owner's stop-all. */
  revoked: boolean;
};

/** `GET /agents/:personaId/permission`: what the owner signs to hire an agent. */
export type PermissionOffer = {
  agentId: string;
  /** The agent's own wallet: the `delegate` of `grantAgent`. */
  delegate: Address;
  contract: Address;
  function: string;
  suggestedDailyCapUsd: number;
  suggestedDays: number;
  current: AgentPermission | null;
};

/** The daily caps an owner can pick for one agent. Small on purpose: an agent is one voice among several. */
export const AGENT_CAPS = [25, 50, 100, 200, 500, 1000, 2500] as const;
/** How long an agent's permission lasts, in days. */
export const AGENT_DAYS = [1, 3, 7, 30] as const;

/** The step nearest `wanted`, so a server's suggestion lands on the stepper. */
export function nearestStep<T extends number>(steps: readonly T[], wanted: number | undefined, fallback: T): T {
  if (wanted === undefined || !Number.isFinite(wanted)) return fallback;
  return steps.reduce((best, s) => (Math.abs(s - wanted) < Math.abs(best - wanted) ? s : best), steps[0]!);
}

/** The next step up or down from `current`, held at the ends. */
export function stepFrom<T extends number>(steps: readonly T[], current: T, dir: 1 | -1): T {
  const i = steps.indexOf(current);
  const next = Math.min(steps.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir));
  return steps[next]!;
}

/** The cap in the settlement token's units. Parsed from the digits, never multiplied as a float. */
export function capUnits(dailyCapUsd: number): bigint {
  return parseUnits(String(Math.round(dailyCapUsd * 100) / 100), CAP_DECIMALS);
}

/** The end date `days` from `nowMs`, in the contract's seconds. */
export function expiryFrom(nowMs: number, days: number): bigint {
  return BigInt(Math.floor(nowMs / 1000) + Math.round(days * 86_400));
}

export function encodeGrantAgent(delegate: Address, dailyCapUsd: number, days: number, nowMs: number): Hex {
  return encodeFunctionData({
    abi: AGENT_DELEGATION_ABI,
    functionName: 'grantAgent',
    args: [delegate, capUnits(dailyCapUsd), expiryFrom(nowMs, days)],
  });
}

export function encodeRevokeAgent(delegate: Address): Hex {
  return encodeFunctionData({ abi: AGENT_DELEGATION_ABI, functionName: 'revokeAgent', args: [delegate] });
}

/**
 * How much more settlement-token allowance a hire needs, or 0n.
 *
 * The contract pulls from the owner's wallet at the moment of each trade, against ONE allowance every agent and the desk
 * share. The onboarding grant approved the desk's cap for a month; an agent's own cap for its whole term is added on top
 * when what is left would not cover it, so a hired agent's first trade does not fail at `transferFrom`.
 */
export function allowanceShortfall(current: bigint, dailyCapUsd: number, days: number): bigint {
  const need = capUnits(dailyCapUsd) * BigInt(Math.max(1, Math.ceil(days)));
  return current >= need ? 0n : need;
}

/** Where one agent's permission stands, from the executor's row. */
export type PermissionState = 'live' | 'needs' | 'stopped' | 'ended' | 'unknown';

export function permissionState(
  agent: { permission?: AgentPermission | null; permissionError?: string },
  nowMs: number,
): PermissionState {
  // An executor that could not read the chain, or one too old to say: not "no permission".
  if (agent.permissionError || agent.permission === undefined) return 'unknown';
  const p = agent.permission;
  if (p === null) return 'needs';
  if (p.revoked) return 'stopped';
  if (p.expiresAt <= nowMs) return 'ended';
  return 'live';
}

/** One line: what this agent may spend, from the executor's row. Never a figure the row did not carry. */
export function permissionLine(
  agent: { permission?: AgentPermission | null; permissionError?: string },
  nowMs: number,
): string {
  const state = permissionState(agent, nowMs);
  const p = agent.permission;
  if (state === 'unknown') return 'Permission unreadable right now';
  if (state === 'needs' || !p) return 'Needs your permission';
  if (state === 'stopped') return 'Stopped';
  if (state === 'ended') return `Ended ${day(p.expiresAt, nowMs)}`;
  return `${money(p.dailyCapUsd, { fractionDigits: 0 })}/day · ${money(p.remainingTodayUsd)} left today · ends ${day(p.expiresAt, nowMs)}`;
}

/** The agent's gas, or null when the executor did not read it. */
export function gasLine(gasEth: string | null | undefined): string | null {
  if (gasEth === null || gasEth === undefined || gasEth.trim() === '') return null;
  const n = Number(gasEth);
  if (!Number.isFinite(n)) return null;
  // In the chain's own gas token: an agent's wallet on Monad holds MON, and "0.0000 ETH" named a coin it never holds.
  return `${quantity(n, n > 0 && n < 0.0001 ? 8 : 4)} ${activeChain.nativeCurrency.symbol}`;
}

/** "0x5cF6…cC34". */
export function walletShort(wallet: string | null | undefined): string {
  return shortAddress(wallet);
}

/** The persona id behind a council round an agent convened (`agent:<personaId>`), else undefined. */
export function convenedAgentId(convenedBy: string): string | undefined {
  return convenedBy.startsWith('agent:') ? convenedBy.slice('agent:'.length) : undefined;
}

/** Who a round came from, in words: "you asked", an agent's name, or the tag as stored when nothing names it. */
export function convenedByLabel(
  convenedBy: string,
  agents: readonly { personaId?: string; id: string; name: string }[] | undefined,
): string {
  if (convenedBy === 'user') return 'you asked';
  const id = convenedAgentId(convenedBy);
  if (!id) return convenedBy;
  const agent = agents?.find((a) => a.personaId === id || a.id === id);
  return agent ? agent.name : id;
}

/** The wallet that signed an executed agent round: that agent's own address, when the roster named it. */
export function roundSigner(
  convenedBy: string,
  agents: readonly { personaId?: string; id: string; wallet?: string }[] | undefined,
): string | undefined {
  const id = convenedAgentId(convenedBy);
  if (!id) return undefined;
  return agents?.find((a) => a.personaId === id || a.id === id)?.wallet;
}
