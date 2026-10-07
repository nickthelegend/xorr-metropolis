/**
 * Individual agents: each agent is its own wallet (2026-09-23).
 *
 * Every agent — the four personas and any custom agent — signs with its own key (`agentPrivateKey`, derived from the
 * executor's master key), so it has its own address, holds its own gas, and is granted by the owner on `XorrDelegation`
 * with its own cap and end date (`grantAgent`). A trade an agent places is signed by that agent: the chain's `Spent`
 * event names it, its own daily tally is charged, and revoking it stops it alone. The owner's own orders — a buy from
 * the ticket — are signed by the master key, the "desk", under the owner's onboarding grant.
 *
 * Which key signs is the acting agent: `withAgent(id, fn)` runs `fn` as that agent (AsyncLocalStorage), and the signing
 * chokepoint (`evm/delegation.ts`) and the permission reads use `actingAccount()` — so the order, settlement and guard
 * code in between did not have to learn about agents, and cannot sign as the wrong one.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createWalletClient, formatEther, http, parseEther, type Address, type PrivateKeyAccount, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chain, rpcUrl, CHAIN_KEY, IS_MONAD } from './chains.js';
import { reserveLedger, valueSpendCheck } from '../monad/reserve.js';
import { moneyOn } from './money.js';
import { agentPrivateKey, delegateAccount, publicClient, walletClient } from './client.js';
import { anvil } from '../fork/anvil.js';

type Acting = { agentId: string; account: PrivateKeyAccount; wallet: WalletClient };

const accounts = new Map<string, Acting>();
const store = new AsyncLocalStorage<Acting>();

/** One agent's own account and wallet client, made once. */
export function agentActor(agentId: string): Acting {
  let a = accounts.get(agentId);
  if (!a) {
    const account = privateKeyToAccount(agentPrivateKey(agentId));
    a = { agentId, account, wallet: createWalletClient({ account, chain, transport: http(rpcUrl) }) };
    accounts.set(agentId, a);
  }
  return a;
}

/** The address an owner grants to hire `agentId`. */
export function agentAddress(agentId: string): Address {
  return agentActor(agentId).account.address;
}

/** Run `fn` as `agentId`: every signature and permission read inside it is that agent's. */
export function withAgent<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
  return store.run(agentActor(agentId), fn);
}

/** Which agent is acting, or undefined for the desk (the owner's own orders). */
export function actingAgentId(): string | undefined {
  return store.getStore()?.agentId;
}

/** The account that signs right now: the acting agent's, else the desk's. */
export function actingAccount(): PrivateKeyAccount {
  return store.getStore()?.account ?? delegateAccount;
}

export function actingWalletClient(): WalletClient {
  return store.getStore()?.wallet ?? walletClient;
}

/** The ETH an agent keeps for gas, and the floor below which it is topped up. */
/*
 * On Monad a sender must hold the whole gas LIMIT × price before a transaction runs (the limit is what is billed): a Perpl
 * open declares ~395k gas at ~112 gwei max fee on testnet (0.044 MON held up front, less spent), so the floor is one open.
 */
export const AGENT_GAS_FLOOR = parseEther(CHAIN_KEY === 'monad-testnet' ? '0.045' : '0.005');
const AGENT_GAS_TARGET = parseEther(CHAIN_KEY === 'monad-testnet' ? '0.06' : '0.02');

/**
 * Keep an agent's wallet able to pay for its own transactions.
 *
 * On a fork the balance is set (a copy of a chain has no faucet; the value is test money). On a test network the desk
 * sends it from its own ETH, as an ordinary transfer with a hash. On a real-money chain nothing is sent automatically.
 */
export async function ensureAgentGas(agentId: string): Promise<{ address: Address; balanceEth: string; toppedUp: string | null }> {
  const address = agentAddress(agentId);
  const before = await publicClient.getBalance({ address });
  if (before >= AGENT_GAS_FLOOR) return { address, balanceEth: formatEther(before), toppedUp: null };
  const money = moneyOn(CHAIN_KEY);
  if (money === 'copy') {
    await anvil(rpcUrl, 'anvil_setBalance', [address, `0x${AGENT_GAS_TARGET.toString(16)}`]);
    return { address, balanceEth: formatEther(AGENT_GAS_TARGET), toppedUp: 'fork balance set' };
  }
  if (money === 'test') {
    const value = AGENT_GAS_TARGET - before;
    // On Monad a transfer that would take the desk under its 10 MON reserve reverts and still pays gas: refuse it first.
    if (IS_MONAD) {
      const [balance, code] = await Promise.all([publicClient.getBalance({ address: delegateAccount.address }), publicClient.getCode({ address: delegateAccount.address })]);
      const check = valueSpendCheck({
        balanceWei: balance,
        valueWei: value,
        delegated: (code ?? '0x').toLowerCase().startsWith('0xef0100'),
        sentWithinWindow: reserveLedger.recent(delegateAccount.address, Date.now()),
      });
      if (!check.ok) throw new Error(`The desk cannot top up this agent's gas: ${check.reason}.`);
    }
    const hash = await walletClient.sendTransaction({ account: delegateAccount, chain, to: address, value });
    await publicClient.waitForTransactionReceipt({ hash });
    return { address, balanceEth: formatEther(AGENT_GAS_TARGET), toppedUp: hash };
  }
  return { address, balanceEth: formatEther(before), toppedUp: null };
}
