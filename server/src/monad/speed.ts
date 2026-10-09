/**
 * The Monad speed receipt (2026-10-07; docs/ROADMAP-WIN.md F1).
 *
 * The block time was a sentence in the README (an out-of-date one: 400 ms, where MIP-12 made it 300); nothing in the app showed it. A judge with five minutes saw a receipt with
 * a hash and no time. So every fill now carries what it can prove about itself, measured, never asserted:
 *
 *   - the time from broadcast to the receipt, polled every 100 ms (`confirmTimed`) — viem's own wait polls on the client's
 *     interval, seconds, and would have measured the poll rather than the chain;
 *   - the block it landed in, the gas it used and declared, and the price it paid (`fillGas`), read from its receipt;
 *   - what that gas cost on Monad — Monad bills the gas LIMIT a transaction declares, not the gas it used — at Chainlink's
 *     MON/USD, against what the same gas used would cost on Ethereum at today's price and Chainlink's ETH/USD.
 *
 * And beside it, the chain itself (`monadPulse`): Monad mainnet's head block and its block interval measured over the last
 * hundred blocks, so the cadence on screen is today's, not a number from a spec. The executor's own chain is measured the
 * same way (`chainCadence`): the local fork mines a block every second (`--block-time 1`), so a fill there confirms at the
 * fork's pace, and the receipt says that rather than letting a fork's second stand for Monad.
 *
 * Every read here can fail — a public RPC, a feed — and a value that could not be read is absent, never filled in.
 */
import { createPublicClient, formatGwei, http, type Hex, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import { publicClient } from '../evm/client.js';
import { readFeed } from './chainlink.js';
import { monadMainnet } from './mainnet.js';

/** How many blocks the cadence is measured over: enough that one-second timestamps resolve it to a few ms. */
export const CADENCE_BLOCKS = 100;
/** How often a confirmation is looked for. */
const POLL_MS = 100;
/** How long a pulse is reused: the cadence does not move between two screens opened a second apart. */
const PULSE_TTL_MS = 5_000;

/** The average block interval, in ms, between two blocks `blocks` apart. Null when the span is unusable. */
export function cadenceMs(headTimestampSec: number, olderTimestampSec: number, blocks: number): number | null {
  if (!(blocks > 0) || !(headTimestampSec >= olderTimestampSec)) return null;
  const ms = ((headTimestampSec - olderTimestampSec) * 1000) / blocks;
  return ms > 0 ? Math.round(ms) : null;
}

/** What `gas` at `priceWei` costs in dollars, given the native token's dollar price. Null without any of them. */
export function costUsd(gas: bigint | null, priceWei: bigint | null, usdPerNative: number | null): number | null {
  if (gas === null || priceWei === null || usdPerNative === null || !(usdPerNative > 0)) return null;
  const wei = gas * priceWei;
  // Through 1e9 so a dollar amount of fractions of a cent survives the bigint-to-number step.
  return (Number(wei / 1_000_000_000n) / 1e9) * usdPerNative;
}

export type FillGas = { block: bigint; blockHash: Hex; gasUsed: bigint; gasLimit: bigint; gasPriceWei: bigint };

/** The block, gas and price of a mined transaction, from its own receipt. Undefined when either read fails. */
export async function fillGas(hash: Hex, client: PublicClient = publicClient): Promise<FillGas | undefined> {
  try {
    const [receipt, tx] = await Promise.all([client.getTransactionReceipt({ hash }), client.getTransaction({ hash })]);
    return {
      block: receipt.blockNumber,
      blockHash: receipt.blockHash,
      gasUsed: receipt.gasUsed,
      gasLimit: tx.gas,
      gasPriceWei: receipt.effectiveGasPrice ?? tx.gasPrice ?? 0n,
    };
  } catch {
    return undefined;
  }
}

/**
 * Milliseconds from `sentAt` (when the broadcast returned) to the moment the receipt is readable, looked for every 100 ms.
 * Undefined when it does not appear within `timeoutMs`; the fill's own wait decides success, this only measures.
 */
export async function confirmTimed(
  hash: Hex,
  sentAt: number,
  opts: { client?: PublicClient; timeoutMs?: number; now?: () => number } = {},
): Promise<number | undefined> {
  const client = opts.client ?? publicClient;
  const now = opts.now ?? Date.now;
  const deadline = sentAt + (opts.timeoutMs ?? 30_000);
  for (;;) {
    const receipt = await client.getTransactionReceipt({ hash }).catch(() => undefined);
    if (receipt) return Math.max(0, now() - sentAt);
    if (now() > deadline) return undefined;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

export type Pulse = {
  at: string;
  monad: { block: string | null; blockMs: number | null; gasGwei: string | null; monUsd: number | null };
  ethereum: { gasGwei: string | null; ethUsd: number | null } | null;
};

const ETHEREUM_RPC = process.env.ETHEREUM_RPC ?? 'https://ethereum-rpc.publicnode.com';
let ethereumClient: PublicClient | undefined;
function ethereum(): PublicClient {
  ethereumClient ??= createPublicClient({ chain: mainnet, transport: http(ETHEREUM_RPC, { timeout: 6_000 }) }) as PublicClient;
  return ethereumClient;
}

let cached: { at: number; pulse: Pulse } | undefined;
let chainCached: { at: number; ms: number | null } | undefined;

/** The executor's own chain's block interval over its last 20 blocks — the fork's, on a fork. Cached for 30 s. */
export async function chainCadence(client: PublicClient = publicClient): Promise<number | null> {
  if (chainCached && Date.now() - chainCached.at < 30_000) return chainCached.ms;
  const head = await client.getBlock().catch(() => undefined);
  const older = head && head.number > 20n ? await client.getBlock({ blockNumber: head.number - 20n }).catch(() => undefined) : undefined;
  const ms = head && older ? cadenceMs(Number(head.timestamp), Number(older.timestamp), 20) : null;
  chainCached = { at: Date.now(), ms };
  return ms;
}

/** Monad mainnet now — head, measured cadence, gas price, MON/USD — and Ethereum's gas price and ETH/USD for comparison. */
export async function monadPulse(force = false): Promise<Pulse> {
  if (!force && cached && Date.now() - cached.at < PULSE_TTL_MS) return cached.pulse;
  const m = monadMainnet();
  const head = await m.getBlock().catch(() => undefined);
  const older = head ? await m.getBlock({ blockNumber: head.number - BigInt(CADENCE_BLOCKS) }).catch(() => undefined) : undefined;
  const [gas, mon, eth, ethGas] = await Promise.all([
    m.getGasPrice().catch(() => undefined),
    readFeed('MON').catch(() => undefined),
    readFeed('ETH').catch(() => undefined),
    ethereum().getGasPrice().catch(() => undefined),
  ]);
  const pulse: Pulse = {
    at: new Date().toISOString(),
    monad: {
      block: head ? head.number.toString() : null,
      blockMs: head && older ? cadenceMs(Number(head.timestamp), Number(older.timestamp), CADENCE_BLOCKS) : null,
      gasGwei: gas !== undefined ? formatGwei(gas) : null,
      monUsd: mon?.price ?? null,
    },
    ethereum: ethGas !== undefined || eth ? { gasGwei: ethGas !== undefined ? formatGwei(ethGas) : null, ethUsd: eth?.price ?? null } : null,
  };
  cached = { at: Date.now(), pulse };
  return pulse;
}

export type SpeedReceipt = {
  tx: string;
  confirmMs: number | null;
  block: string | null;
  gasUsed: string | null;
  gasLimit: string | null;
  gasPriceGwei: string | null;
  /**
   * What it cost on Monad: the declared limit at a Monad gas price, at MON/USD. On a fork the price the fork charged is
   * anvil's, not Monad's, so there it is Monad mainnet's current price (`pricedAt: 'mainnet'`); elsewhere, what was paid.
   */
  costUsd: number | null;
  pricedAt: 'paid' | 'mainnet';
  /** The Monad gas price the cost used, in gwei. */
  monadGasGwei: string | null;
  /** The same gas used, at Ethereum mainnet's price now, at ETH/USD. */
  ethereumUsd: number | null;
  /** A local fork of Monad mainnet: its blocks are the fork's (`chainBlockMs`), not Monad's. */
  fork: boolean;
  /** The block interval of the chain this fill was on, measured — the fork's on a fork. */
  chainBlockMs: number | null;
  /** ms from broadcast until the fill's block was final (the chain's `finalized` block); null when not measured. */
  finalMs: number | null;
  /** The receipt came back with the send (`eth_sendRawTransactionSync`), so `confirmMs` is that call's duration. */
  sync: boolean;
  pulse: Pulse;
};

/** A fill's speed receipt from what was recorded when it confirmed, priced at the pulse's rates. */
export function speedReceipt(
  row: {
    signature: string;
    tx_ms: number | null;
    tx_block: string | null;
    tx_gas_used: string | null;
    tx_gas_limit: string | null;
    tx_gas_price: string | null;
    tx_final_ms?: number | null;
    tx_sync?: boolean | null;
  },
  pulse: Pulse,
  fork: boolean,
  chainBlockMs: number | null = null,
): SpeedReceipt {
  const big = (v: string | null) => (v === null || v === undefined ? null : BigInt(v));
  const gasUsed = big(row.tx_gas_used);
  const gasLimit = big(row.tx_gas_limit);
  const price = big(row.tx_gas_price);
  const gweiToWei = (g: string | null | undefined) => (g ? BigInt(Math.round(Number(g) * 1e9)) : null);
  const ethPriceWei = gweiToWei(pulse.ethereum?.gasGwei);
  const monadPrice = fork ? gweiToWei(pulse.monad.gasGwei) : price;
  return {
    tx: row.signature,
    confirmMs: row.tx_ms,
    block: row.tx_block,
    gasUsed: gasUsed?.toString() ?? null,
    gasLimit: gasLimit?.toString() ?? null,
    gasPriceGwei: price !== null ? formatGwei(price) : null,
    costUsd: costUsd(gasLimit, monadPrice, pulse.monad.monUsd),
    pricedAt: fork ? 'mainnet' : 'paid',
    monadGasGwei: monadPrice !== null ? formatGwei(monadPrice) : null,
    ethereumUsd: costUsd(gasUsed, ethPriceWei, pulse.ethereum?.ethUsd ?? null),
    fork,
    chainBlockMs,
    finalMs: row.tx_final_ms ?? null,
    sync: row.tx_sync === true,
    pulse,
  };
}

export type SpeedHistoryItem = {
  id: string;
  tx: string;
  venue: string | null;
  symbol: string | null;
  executedMs: number;
  sync: boolean;
  finalMs: number | null;
  gasUsed: number | null;
  gasLimit: number | null;
  at: string | null;
};

/** A wallet's recent fills as a speed history, oldest first (the rows arrive newest first). */
export function speedHistory(
  rows: readonly {
    id: string;
    signature: string;
    venue: string | null;
    symbol: string | null;
    tx_ms: number | null;
    tx_sync: boolean | null;
    tx_final_ms: number | null;
    tx_gas_used: string | null;
    tx_gas_limit: string | null;
    finished_at: Date | string | null;
  }[],
): SpeedHistoryItem[] {
  return rows
    .filter((r) => r.tx_ms !== null)
    .map((r) => ({
      id: r.id,
      tx: r.signature,
      venue: r.venue,
      symbol: r.symbol,
      executedMs: r.tx_ms!,
      sync: r.tx_sync === true,
      finalMs: r.tx_final_ms,
      gasUsed: r.tx_gas_used === null ? null : Number(r.tx_gas_used),
      gasLimit: r.tx_gas_limit === null ? null : Number(r.tx_gas_limit),
      at: r.finished_at === null ? null : new Date(r.finished_at).toISOString(),
    }))
    .reverse();
}
