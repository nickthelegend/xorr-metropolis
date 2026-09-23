/**
 * Where a GMX order is, read from the chain (PLAN.md P2.5, 2026-09-23).
 *
 * A market order lives in the DataStore only until a keeper acts on it; executing or cancelling DELETES it. So "the
 * order is gone" says nothing by itself, and the outcome is read from GMX's EventEmitter instead:
 *
 *   order still stored, not frozen      → 'pending'   (waiting for a keeper)
 *   order still stored, `isFrozen`      → 'frozen'    (a keeper tried and it could not execute; `OrderFrozen` says why)
 *   `OrderExecuted` log for the key     → 'executed'
 *   `OrderCancelled` log for the key    → 'cancelled' (with GMX's reason, and the decoded error name when there is one)
 *
 * Every one of those events is `EventLog2(msgSender, eventName, eventNameHash, topic1 = key, topic2 = account, …)`,
 * so the log query filters on the event-name hash and the key and reads nothing else. The positions after execution
 * come from `Reader.getAccountPositions` for the OWNER — an agent never holds a GMX position of its own.
 */
import { formatUnits, zeroAddress, type Address, type Hex, type PublicClient } from 'viem';
import { eventEmitterAbi, readerAbi } from './abis.js';
import { GMX, OrderType, TOKENS, USD_DECIMALS, marketByToken, tokenByAddress } from './constants.js';
import { decodeGmxError } from './orders.js';

type Client = Pick<PublicClient, 'readContract' | 'getLogs' | 'getBlockNumber'>;

export type OrderStatus = 'pending' | 'executed' | 'cancelled' | 'frozen' | 'unknown';

export type OrderState = {
  key: Hex;
  status: OrderStatus;
  /** Present while the order is stored (pending or frozen). */
  order?: {
    account: Address;
    market: Address;
    isLong: boolean;
    kind: 'increase' | 'decrease' | 'other';
    sizeDeltaUsd: number;
    acceptablePrice: bigint;
    executionFee: bigint;
    updatedAtTime: bigint;
  };
  /** The transaction that executed, cancelled or froze it. */
  tx?: Hex;
  blockNumber?: bigint;
  /** GMX's reason for a cancel or freeze, with the decoded error name when the reason bytes carry one. */
  reason?: string;
};

const OUTCOMES = ['OrderExecuted', 'OrderCancelled', 'OrderFrozen'] as const;

type EventLogData = {
  stringItems: { items: readonly { key: string; value: string }[] };
  bytesItems: { items: readonly { key: string; value: Hex }[] };
};

function reasonOf(eventData: EventLogData): string | undefined {
  const reason = eventData.stringItems.items.find((i) => i.key === 'reason')?.value;
  const bytes = eventData.bytesItems.items.find((i) => i.key === 'reasonBytes')?.value;
  const decoded = bytes && bytes.length >= 10 ? decodeGmxError(bytes) : undefined;
  if (decoded) return reason && reason !== decoded.name ? `${decoded.name} (${reason})` : decoded.name;
  return reason || undefined;
}

/**
 * The order's state. `fromBlock` bounds the event search — pass the block the order was created in; without it the
 * last `lookbackBlocks` are searched (public RPCs refuse an unbounded range).
 */
export async function orderStatus(client: Client, key: Hex, opts: { fromBlock?: bigint; lookbackBlocks?: bigint } = {}): Promise<OrderState> {
  const order = await client.readContract({ address: GMX.reader, abi: readerAbi, functionName: 'getOrder', args: [GMX.dataStore, key] });
  if (order.addresses.account !== zeroAddress) {
    const t = order.numbers.orderType;
    return {
      key,
      status: order.flags.isFrozen ? 'frozen' : 'pending',
      order: {
        account: order.addresses.account,
        market: order.addresses.market,
        isLong: order.flags.isLong,
        kind: t === OrderType.MarketIncrease || t === OrderType.LimitIncrease || t === OrderType.StopIncrease
          ? 'increase'
          : t === OrderType.MarketDecrease || t === OrderType.LimitDecrease || t === OrderType.StopLossDecrease
            ? 'decrease'
            : 'other',
        sizeDeltaUsd: Number(formatUnits(order.numbers.sizeDeltaUsd, USD_DECIMALS)),
        acceptablePrice: order.numbers.acceptablePrice,
        executionFee: order.numbers.executionFee,
        updatedAtTime: order.numbers.updatedAtTime,
      },
      ...(order.flags.isFrozen ? await lastOutcome(client, key, opts) : {}),
    };
  }
  const outcome = await lastOutcome(client, key, opts);
  if (!outcome.tx) return { key, status: 'unknown' };
  return { key, ...outcome } as OrderState;
}

async function lastOutcome(
  client: Client,
  key: Hex,
  opts: { fromBlock?: bigint; lookbackBlocks?: bigint },
): Promise<Partial<OrderState>> {
  const latest = await client.getBlockNumber();
  const fromBlock = opts.fromBlock ?? (latest > (opts.lookbackBlocks ?? 50_000n) ? latest - (opts.lookbackBlocks ?? 50_000n) : 0n);
  const event = eventEmitterAbi.find((e) => e.name === 'EventLog2')!;
  const logs = await client.getLogs({
    address: GMX.eventEmitter,
    event,
    args: { eventNameHash: [...OUTCOMES], topic1: key },
    fromBlock,
    toBlock: latest,
  });
  const last = logs.at(-1);
  if (!last) return {};
  const args = last.args as { eventName: string; eventData: EventLogData };
  const status: OrderStatus = args.eventName === 'OrderExecuted' ? 'executed' : args.eventName === 'OrderCancelled' ? 'cancelled' : 'frozen';
  return {
    status,
    tx: last.transactionHash ?? undefined,
    blockNumber: last.blockNumber ?? undefined,
    reason: status === 'executed' ? undefined : reasonOf(args.eventData),
  };
}

/** Poll until the order leaves 'pending' or the deadline passes. */
export async function waitForOrder(
  client: Client,
  key: Hex,
  opts: { fromBlock?: bigint; timeoutMs?: number; intervalMs?: number } = {},
): Promise<OrderState> {
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  for (;;) {
    const s = await orderStatus(client, key, opts);
    if (s.status !== 'pending' || Date.now() > deadline) return s;
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 2_000));
  }
}

export type PositionView = {
  account: Address;
  market: Address;
  marketId: string | null;
  collateralToken: Address;
  collateralSymbol: string | null;
  isLong: boolean;
  sizeUsd: number;
  /** GMX's own value (USD × 1e30) — what a full close passes as `sizeDeltaUsd`. */
  sizeInUsdRaw: bigint;
  sizeInTokens: bigint;
  /** Collateral in whole tokens. */
  collateralAmount: number;
  /** Average entry: sizeInUsd / sizeInTokens, USD per whole index token. */
  entryPrice: number | null;
  increasedAt: number;
};

/** The owner's open GMX positions, human-readable. */
export async function accountPositions(client: Pick<PublicClient, 'readContract'>, account: Address): Promise<PositionView[]> {
  const raw = await client.readContract({
    address: GMX.reader,
    abi: readerAbi,
    functionName: 'getAccountPositions',
    args: [GMX.dataStore, account, 0n, 100n],
  });
  return raw.map((p) => {
    const m = marketByToken(p.addresses.market);
    const collateral = tokenByAddress(p.addresses.collateralToken);
    const index = m ? TOKENS[m.index] : undefined;
    const sizeUsd = Number(formatUnits(p.numbers.sizeInUsd, USD_DECIMALS));
    const sizeTokens = index ? Number(formatUnits(p.numbers.sizeInTokens, index.decimals)) : 0;
    return {
      account: p.addresses.account,
      market: p.addresses.market,
      marketId: m?.id ?? null,
      collateralToken: p.addresses.collateralToken,
      collateralSymbol: collateral?.symbol ?? null,
      isLong: p.flags.isLong,
      sizeUsd,
      sizeInUsdRaw: p.numbers.sizeInUsd,
      sizeInTokens: p.numbers.sizeInTokens,
      collateralAmount: collateral ? Number(formatUnits(p.numbers.collateralAmount, collateral.decimals)) : 0,
      entryPrice: sizeTokens > 0 ? sizeUsd / sizeTokens : null,
      increasedAt: Number(p.numbers.increasedAtTime),
    };
  });
}

