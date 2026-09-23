/**
 * What the council reads before it votes (PLAN.md P3.2, 2026-09-23).
 *
 * Every persona votes on the same snapshot of real inputs, read once per round and stored with it, so a vote can always
 * be checked against exactly what it saw. Each input carries its source. An input that could not be read is recorded as
 * the error it was — a persona that needs it abstains and says why; nothing is filled in.
 *
 *   guard      Robinhood's session + halt state, the Chainlink feed, the pool's quote and their deviation
 *              (`robinhood/guards.ts` — the same check the executor enforces before a stock trade).
 *   trend      The stock's own Chainlink rounds on Robinhood Chain: the latest and up to five before it.
 *   day        Robinhood's quote for the underlying: bid, ask, today's high and low.
 *   gmx        GMX V2 ETH/USD and BTC/USD funding and open interest on Arbitrum — the crypto market's risk appetite.
 *   permission The owner's grant on XorrDelegation, read from the chain: cap, what is left today, expiry, revoked.
 *   holding    What the owner already holds of this stock (ERC-8056 shares) and what it is worth at the feed price.
 */
import type { Address } from 'viem';
import { erc20Abi } from 'viem';
import { stockTradeCheck, type GuardResult } from '../robinhood/guards.js';
import { guardDeps } from '../executor/stock-guard.js';
import { aggregatorV3Abi, feedFor, robinhoodClient, stockTokenAbi } from '../robinhood/chain.js';
import { fetchPrice } from '../robinhood/api.js';
import { catalogEntry } from '../robinhood/catalog.js';
import { fetchMarkets } from '../venues/gmx/api.js';
import { readPolicy } from '../evm/delegation.js';
import { publicClient } from '../evm/client.js';
import { agentAddress } from '../evm/agents.js';

export type Proposal = { side: 'buy' | 'sell'; symbol: string; usd: number };

type Read<T> = ({ ok: true } & T) | { ok: false; error: string };

export type TrendInput = Read<{
  source: string;
  rounds: { price: number; at: string }[];
  changePct: number;
  spanHours: number;
}>;
export type DayInput = Read<{
  source: string;
  bid: number;
  ask: number;
  high: number;
  low: number;
  /** Where the ask sits in today's range: 0 at the low, 1 at the high. */
  positionInRange: number;
}>;
export type GmxSide = { market: string; fundingLongPctPerHour: number; fundingShortPctPerHour: number; longSharePct: number; openInterestUsd: number };
export type GmxInput = Read<{ source: string; eth: GmxSide; btc: GmxSide }>;
export type PermissionInput = Read<{
  source: string;
  dailyCapUsd: number;
  remainingTodayUsd: number;
  expiresAt: number;
  revoked: boolean;
  /** The whole grant from now to expiry, in whole days, as the pacing rule reads it. */
  grantUsd: number;
}>;
export type HoldingInput = Read<{ source: string; shares: number; valueUsd: number }>;

export type CouncilInputs = {
  readAt: string;
  proposal: Proposal;
  guard: Read<{ result: GuardResult }>;
  trend: TrendInput;
  day: DayInput;
  gmx: GmxInput;
  permission: PermissionInput;
  holding: HoldingInput;
};

const errorOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

async function read<T>(f: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, ...(await f()) };
  } catch (e) {
    return { ok: false, error: errorOf(e) };
  }
}

/** The stock's last Chainlink rounds on Robinhood Chain, oldest first. */
export async function trendOf(symbol: string): Promise<{ source: string; rounds: { price: number; at: string }[]; changePct: number; spanHours: number }> {
  const feed = await feedFor(symbol);
  if (!feed) throw new Error(`no Chainlink feed for ${symbol} on Robinhood Chain`);
  const client = robinhoodClient();
  const roundAbi = [
    ...aggregatorV3Abi,
    {
      type: 'function',
      name: 'getRoundData',
      stateMutability: 'view',
      inputs: [{ name: '_roundId', type: 'uint80' }],
      outputs: [
        { name: 'roundId', type: 'uint80' },
        { name: 'answer', type: 'int256' },
        { name: 'startedAt', type: 'uint256' },
        { name: 'updatedAt', type: 'uint256' },
        { name: 'answeredInRound', type: 'uint80' },
      ],
    },
  ] as const;
  const [latestId, latestAnswer, , latestAt] = await client.readContract({ address: feed.proxy, abi: roundAbi, functionName: 'latestRoundData' });
  const rounds: { price: number; at: string }[] = [{ price: Number(latestAnswer) / 10 ** feed.decimals, at: new Date(Number(latestAt) * 1000).toISOString() }];
  // A proxy's round id packs the phase in its top 16 bits; stepping back within the phase is `id - k`.
  const phaseFloor = (latestId >> 64n) << 64n;
  for (let k = 1n; k <= 5n; k++) {
    const id = latestId - k;
    if (id <= phaseFloor) break;
    try {
      const [, answer, , at] = await client.readContract({ address: feed.proxy, abi: roundAbi, functionName: 'getRoundData', args: [id] });
      if (answer <= 0n || at === 0n) break;
      rounds.unshift({ price: Number(answer) / 10 ** feed.decimals, at: new Date(Number(at) * 1000).toISOString() });
    } catch {
      break;
    }
  }
  const first = rounds[0]!;
  const last = rounds[rounds.length - 1]!;
  return {
    source: `Chainlink ${feed.name} ${feed.proxy} on Robinhood Chain, ${rounds.length} rounds`,
    rounds,
    changePct: ((last.price - first.price) / first.price) * 100,
    spanHours: (Date.parse(last.at) - Date.parse(first.at)) / 3_600_000,
  };
}

async function dayOf(symbol: string) {
  const q = await fetchPrice(symbol);
  const bid = Number(q.bid);
  const ask = Number(q.ask);
  const high = Number(q.dailyHigh);
  const low = Number(q.dailyLow);
  if (![bid, ask, high, low].every(Number.isFinite)) throw new Error(`Robinhood quote for ${symbol} has non-numeric fields`);
  return {
    source: `Robinhood /rhj/prices/${symbol} at ${q.generatedAt}`,
    bid,
    ask,
    high,
    low,
    positionInRange: high > low ? Math.min(1, Math.max(0, (ask - low) / (high - low))) : 0.5,
  };
}

async function gmxOf() {
  const markets = await fetchMarkets();
  const side = (id: 'ETH-USD' | 'BTC-USD'): GmxSide => {
    const m = markets.find((x) => x.id === id);
    if (!m) throw new Error(`GMX /markets/info has no ${id} market`);
    const oi = m.openInterestUsd.long + m.openInterestUsd.short;
    return {
      market: m.name,
      fundingLongPctPerHour: m.fundingPctPerHour.long,
      fundingShortPctPerHour: m.fundingPctPerHour.short,
      longSharePct: oi > 0 ? (m.openInterestUsd.long / oi) * 100 : 50,
      openInterestUsd: oi,
    };
  };
  return { source: markets[0]?.source ?? 'GMX /markets/info', eth: side('ETH-USD'), btc: side('BTC-USD') };
}

async function permissionOf(owner: Address, agentId?: string) {
  // The proposing agent's own permission (its own cap and tally), or the desk's for a round the owner convened.
  const p = await readPolicy(owner, agentId ? agentAddress(agentId) : undefined);
  if (!p) throw new Error(agentId ? `the owner has not granted ${agentId} a permission of its own` : 'no grant on XorrDelegation for this owner');
  // `readPolicy` answers the expiry in milliseconds; the round stores seconds, as the contract does.
  const expiresAt = Math.floor(p.expiresAt / 1000);
  const daysLeft = Math.max(1, Math.ceil((expiresAt - Date.now() / 1000) / 86_400));
  return {
    source: `XorrDelegation agentPolicyOf / remainingTodayFor (${agentId ?? 'desk'}) on the settlement chain`,
    dailyCapUsd: p.dailyCapUsd,
    remainingTodayUsd: p.remainingTodayUsd,
    expiresAt,
    revoked: p.revoked,
    grantUsd: p.dailyCapUsd * daysLeft,
  };
}

async function holdingOf(owner: Address, symbol: string, price: number | undefined) {
  const entry = await catalogEntry(symbol);
  if (!entry) throw new Error(`${symbol} is not in the Robinhood catalog`);
  const token = entry.address as Address;
  const [balance, multiplier] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
    publicClient.readContract({ address: token, abi: stockTokenAbi, functionName: 'uiMultiplier' }),
  ]);
  const shares = Number((balance * multiplier) / 10n ** 18n) / 1e18;
  return {
    source: `${symbol} ${token} balanceOf × uiMultiplier (ERC-8056) on the settlement chain`,
    shares,
    valueUsd: price === undefined ? 0 : shares * price,
  };
}

export async function readCouncilInputs(owner: Address, proposal: Proposal, agentId?: string): Promise<CouncilInputs> {
  const symbol = proposal.symbol.toUpperCase();
  const [guard, trend, day, gmx, permission] = await Promise.all([
    // The executor's own guard inputs: on a fork, the fork's pool against the live feed — the trade the council approves.
    read(async () => ({ result: await stockTradeCheck({ symbol, side: proposal.side, usdg: proposal.usd }, guardDeps()) })),
    read(() => trendOf(symbol)),
    read(() => dayOf(symbol)),
    read(() => gmxOf()),
    read(() => permissionOf(owner, agentId)),
  ]);
  const feedPrice = guard.ok ? guard.result.detail.chainlink?.price : trend.ok ? trend.rounds.at(-1)?.price : undefined;
  const holding = await read(() => holdingOf(owner, symbol, feedPrice));
  return { readAt: new Date().toISOString(), proposal: { ...proposal, symbol }, guard, trend, day, gmx, permission, holding };
}
