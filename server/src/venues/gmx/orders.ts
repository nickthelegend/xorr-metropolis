/**
 * GMX V2 orders through the SubaccountRouter: the owner's own GMX account, traded by an agent key it named
 * (PLAN.md P2.4, 2026-09-23).
 *
 * The shape of the permission, as the live SubaccountRouter (0x9c05880A…) enforces it on every agent order:
 *
 *   - the agent must be in the owner's subaccount list          → `SubaccountNotAuthorized`
 *   - the owner's action count for it must stay ≤ its maximum   → `MaxSubaccountActionCountExceeded`
 *   - the block must not be past the owner's expiry for it      → `SubaccountApprovalExpired`
 *   - the order's `receiver` must be the owner                  → `InvalidReceiverForSubaccountOrder`
 *
 * So the agent can open and close the owner's positions and nothing it does can pay itself. Collateral is pulled
 * from the OWNER by the Router (`pluginTransfer`), which is why the owner approves USDC to the Router, not to either
 * router contract. The agent pays only the keeper's execution fee, in ETH, from its own balance.
 *
 * Owner setup is ONE transaction the owner signs: `SubaccountRouter.multicall([addSubaccount,
 * setMaxAllowedSubaccountActionCount, setSubaccountExpiresAt, (setIntegrationId), (sendNativeToken → agent gas)])`.
 * The live contract (checked 2026-09-23) has no approval-signature requirement on this path — the signed
 * `SubaccountApproval` struct belongs to the Gelato relay routers, which xorr does not use.
 *
 * Execution fee is computed as GMX's SDK does (`utils/fees/executionFee.ts`, `GasUtils.adjustGasLimitForEstimate`):
 *   gasLimit = ESTIMATED_GAS_FEE_BASE_AMOUNT_V2_1 + ESTIMATED_GAS_FEE_PER_ORACLE_PRICE × (3 + swaps)
 *              + (INCREASE|DECREASE_ORDER_GAS_LIMIT + SINGLE_SWAP_GAS_LIMIT × swaps + callbackGasLimit)
 *                × ESTIMATED_GAS_FEE_MULTIPLIER_FACTOR
 *   fee      = gasLimit × gasPrice
 * with the SDK's 20% gas-price buffer for Arbitrum. The contract checks `fee ≥ gasLimit × tx.gasprice`, so the
 * transaction must be sent at (at most) the returned `txGasPrice`.
 */
import {
  BaseError,
  decodeErrorResult,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  isHex,
  maxUint256,
  stringToHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from 'viem';
import { dataStoreAbi, eventEmitterAbi, exchangeRouterAbi, gmxErrorsAbi, subaccountRouterAbi } from './abis.js';
import { DecreasePositionSwapType, FLOAT_PRECISION, GMX, KEYS, OrderType, keys } from './constants.js';

type Reader = Pick<PublicClient, 'readContract' | 'getGasPrice'>;

export type TxRequest = { to: Address; data: Hex; value: bigint };

// ---------------------------------------------------------------------------------------------------------------
// Env-configured attribution
// ---------------------------------------------------------------------------------------------------------------

/** `GMX_UI_FEE_RECEIVER`, or the zero address. An address that is not one is refused, not silently dropped. */
export function uiFeeReceiverFromEnv(env: NodeJS.ProcessEnv = process.env): Address {
  const v = env.GMX_UI_FEE_RECEIVER?.trim();
  if (!v) return zeroAddress;
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error(`GMX_UI_FEE_RECEIVER=${v} is not an address.`);
  return v as Address;
}

/**
 * `GMX_REFERRAL_CODE` as the bytes32 GMX stores: a code's text right-padded (how GMX's ReferralStorage keys codes),
 * or a 0x-prefixed 32-byte value passed through. Unset is zero — no referral.
 */
export function referralCodeFromEnv(env: NodeJS.ProcessEnv = process.env): Hex {
  const v = env.GMX_REFERRAL_CODE?.trim();
  if (!v) return zeroHash;
  if (isHex(v) && v.length === 66) return v;
  if (new TextEncoder().encode(v).length > 32) throw new Error(`GMX_REFERRAL_CODE "${v}" is longer than 32 bytes.`);
  return stringToHex(v, { size: 32 });
}

// ---------------------------------------------------------------------------------------------------------------
// Owner-signed setup
// ---------------------------------------------------------------------------------------------------------------

/** The owner approves collateral to GMX's Router (not a router contract): both routers pull through it. */
export function buildCollateralApproval(token: Address, amount: bigint = maxUint256): TxRequest {
  return { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [GMX.router, amount] }), value: 0n };
}

export type SubaccountSetup = {
  /** The agent key. */
  subaccount: Address;
  /** How many order actions (create/update/cancel) the agent may take in total. */
  maxAllowedCount: bigint;
  /** Unix seconds after which every agent action is refused. */
  expiresAt: bigint;
  /** Optional GMX integration id, so GMX can disable a whole integration's subaccounts at once. */
  integrationId?: Hex;
  /** ETH the owner sends the agent in the same transaction, to pay execution fees and gas. */
  fundSubaccountWei?: bigint;
};

/** One owner-signed transaction that registers the agent with its limits. */
export function buildSubaccountSetup(s: SubaccountSetup): TxRequest {
  if (s.maxAllowedCount <= 0n) throw new Error('maxAllowedCount must be at least 1.');
  const calls: Hex[] = [
    encodeFunctionData({ abi: subaccountRouterAbi, functionName: 'addSubaccount', args: [s.subaccount] }),
    encodeFunctionData({
      abi: subaccountRouterAbi,
      functionName: 'setMaxAllowedSubaccountActionCount',
      args: [s.subaccount, KEYS.SUBACCOUNT_ORDER_ACTION, s.maxAllowedCount],
    }),
    encodeFunctionData({
      abi: subaccountRouterAbi,
      functionName: 'setSubaccountExpiresAt',
      args: [s.subaccount, KEYS.SUBACCOUNT_ORDER_ACTION, s.expiresAt],
    }),
  ];
  if (s.integrationId && s.integrationId !== zeroHash) {
    calls.push(encodeFunctionData({ abi: subaccountRouterAbi, functionName: 'setIntegrationId', args: [s.subaccount, s.integrationId] }));
  }
  const fund = s.fundSubaccountWei ?? 0n;
  if (fund > 0n) {
    calls.push(encodeFunctionData({ abi: subaccountRouterAbi, functionName: 'sendNativeToken', args: [s.subaccount, fund] }));
  }
  return { to: GMX.subaccountRouter, data: encodeFunctionData({ abi: subaccountRouterAbi, functionName: 'multicall', args: [calls] }), value: fund };
}

/** The owner's revoke: the agent is removed from the list and every later order from it reverts. */
export function buildRemoveSubaccount(subaccount: Address): TxRequest {
  return {
    to: GMX.subaccountRouter,
    data: encodeFunctionData({ abi: subaccountRouterAbi, functionName: 'removeSubaccount', args: [subaccount] }),
    value: 0n,
  };
}

export type SubaccountState = {
  active: boolean;
  maxAllowedCount: bigint;
  actionCount: bigint;
  expiresAt: bigint;
  integrationId: Hex;
};

/** What the chain says the agent may still do for the owner. */
export async function readSubaccount(client: Reader, account: Address, subaccount: Address): Promise<SubaccountState> {
  const u = (key: Hex) => client.readContract({ address: GMX.dataStore, abi: dataStoreAbi, functionName: 'getUint', args: [key] });
  const [active, maxAllowedCount, actionCount, expiresAt, integrationId] = await Promise.all([
    client.readContract({ address: GMX.dataStore, abi: dataStoreAbi, functionName: 'containsAddress', args: [keys.subaccountList(account), subaccount] }),
    u(keys.maxAllowedSubaccountActionCount(account, subaccount, KEYS.SUBACCOUNT_ORDER_ACTION)),
    u(keys.subaccountActionCount(account, subaccount, KEYS.SUBACCOUNT_ORDER_ACTION)),
    u(keys.subaccountExpiresAt(account, subaccount, KEYS.SUBACCOUNT_ORDER_ACTION)),
    client.readContract({ address: GMX.dataStore, abi: dataStoreAbi, functionName: 'getBytes32', args: [keys.subaccountIntegrationId(account, subaccount)] }),
  ]);
  return { active, maxAllowedCount, actionCount, expiresAt, integrationId };
}

// ---------------------------------------------------------------------------------------------------------------
// Execution fee
// ---------------------------------------------------------------------------------------------------------------

/** The SDK's gas-price buffer for Arbitrum (`gasPriceBuffer: 2000n` bps). */
export const GAS_PRICE_BUFFER_BPS = 2000n;

export type ExecutionFee = {
  /** Wei to send as `executionFee` (and as `sendWnt` value). */
  feeWei: bigint;
  /** The gas limit GMX will check the fee against. */
  gasLimit: bigint;
  /** The node's gas price when estimated. */
  gasPrice: bigint;
  /** Send the order transaction at no more than this, or the fee check can fail. */
  txGasPrice: bigint;
};

export async function estimateExecutionFee(
  client: Reader,
  o: { kind: 'increase' | 'decrease'; swapsCount?: number; callbackGasLimit?: bigint; decreaseSwap?: boolean },
): Promise<ExecutionFee> {
  const u = (key: Hex) => client.readContract({ address: GMX.dataStore, abi: dataStoreAbi, functionName: 'getUint', args: [key] });
  const [base, perOraclePrice, multiplier, orderGas, swapGas, gasPrice] = await Promise.all([
    u(KEYS.ESTIMATED_GAS_FEE_BASE_AMOUNT_V2_1),
    u(KEYS.ESTIMATED_GAS_FEE_PER_ORACLE_PRICE),
    u(KEYS.ESTIMATED_GAS_FEE_MULTIPLIER_FACTOR),
    u(o.kind === 'increase' ? KEYS.INCREASE_ORDER_GAS_LIMIT : KEYS.DECREASE_ORDER_GAS_LIMIT),
    u(KEYS.SINGLE_SWAP_GAS_LIMIT),
    client.getGasPrice(),
  ]);
  const swaps = BigInt(o.swapsCount ?? 0) + (o.kind === 'decrease' && o.decreaseSwap ? 1n : 0n);
  const gasLimit = executionGasLimit({
    base,
    perOraclePrice,
    multiplier,
    orderGas,
    swapGas,
    swaps,
    oraclePriceCount: 3n + BigInt(o.swapsCount ?? 0),
    callbackGasLimit: o.callbackGasLimit ?? 0n,
  });
  const buffered = gasPrice + (gasPrice * GAS_PRICE_BUFFER_BPS) / 10_000n;
  return { feeWei: gasLimit * buffered, gasLimit, gasPrice, txGasPrice: buffered };
}

/** `GasUtils.adjustGasLimitForEstimate(estimateExecute{Increase,Decrease}OrderGasLimit)`, pure. */
export function executionGasLimit(p: {
  base: bigint;
  perOraclePrice: bigint;
  multiplier: bigint;
  orderGas: bigint;
  swapGas: bigint;
  swaps: bigint;
  oraclePriceCount: bigint;
  callbackGasLimit: bigint;
}): bigint {
  const estimated = p.orderGas + p.swapGas * p.swaps + p.callbackGasLimit;
  return p.base + p.perOraclePrice * p.oraclePriceCount + (estimated * p.multiplier) / FLOAT_PRECISION;
}

// ---------------------------------------------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------------------------------------------

/**
 * The worst price the order accepts, from GMX's own min/max for the index token (raw, USD per unit × 1e30).
 *
 * Buying exposure (long increase, short decrease) pays the max price, so the bound is an upper one: max × (1 + s).
 * Selling exposure (short increase, long decrease) receives the min price, so the bound is a lower one: min × (1 − s).
 */
export function acceptablePrice(price: { min: bigint; max: bigint }, isLong: boolean, isIncrease: boolean, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) throw new Error(`slippageBps ${slippageBps} is out of range.`);
  const s = BigInt(slippageBps);
  const buying = isLong === isIncrease;
  return buying ? (price.max * (10_000n + s)) / 10_000n : (price.min * (10_000n - s)) / 10_000n;
}

// ---------------------------------------------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------------------------------------------

export type MarketOrder = {
  /** The owner: whose position it is, and the only address that can receive its proceeds. */
  account: Address;
  market: Address;
  /** Collateral token (e.g. USDC). */
  collateralToken: Address;
  kind: 'increase' | 'decrease';
  isLong: boolean;
  /** Position size change, USD × 1e30. */
  sizeDeltaUsd: bigint;
  /** Increase: collateral to deposit (token units). Decrease: collateral to withdraw (0 = none beyond what closing returns). */
  collateralDeltaAmount: bigint;
  acceptablePrice: bigint;
  executionFee: bigint;
  uiFeeReceiver?: Address;
  referralCode?: Hex;
  /** Minimum output for a decrease (token units); 0 accepts what the position returns. */
  minOutputAmount?: bigint;
};

function createOrderParams(o: MarketOrder) {
  return {
    addresses: {
      receiver: o.account,
      cancellationReceiver: o.account,
      callbackContract: zeroAddress,
      uiFeeReceiver: o.uiFeeReceiver ?? uiFeeReceiverFromEnv(),
      market: o.market,
      initialCollateralToken: o.collateralToken,
      swapPath: [] as Address[],
    },
    numbers: {
      sizeDeltaUsd: o.sizeDeltaUsd,
      initialCollateralDeltaAmount: o.collateralDeltaAmount,
      triggerPrice: 0n,
      acceptablePrice: o.acceptablePrice,
      executionFee: o.executionFee,
      callbackGasLimit: 0n,
      minOutputAmount: o.minOutputAmount ?? 0n,
      validFromTime: 0n,
    },
    orderType: o.kind === 'increase' ? OrderType.MarketIncrease : OrderType.MarketDecrease,
    decreasePositionSwapType: DecreasePositionSwapType.NoSwap,
    isLong: o.isLong,
    shouldUnwrapNativeToken: false,
    autoCancel: false,
    referralCode: o.referralCode ?? referralCodeFromEnv(),
    dataList: [] as Hex[],
  } as const;
}

/**
 * The agent's transaction: `SubaccountRouter.multicall([sendWnt(OrderVault, fee), createOrder(owner, params)])`,
 * with `value = fee`. The collateral is pulled from the owner by the Router inside `createOrder`.
 */
export function buildAgentOrder(o: MarketOrder): TxRequest {
  const calls: Hex[] = [
    encodeFunctionData({ abi: subaccountRouterAbi, functionName: 'sendWnt', args: [GMX.orderVault, o.executionFee] }),
    encodeFunctionData({ abi: subaccountRouterAbi, functionName: 'createOrder', args: [o.account, createOrderParams(o)] }),
  ];
  return {
    to: GMX.subaccountRouter,
    data: encodeFunctionData({ abi: subaccountRouterAbi, functionName: 'multicall', args: [calls] }),
    value: o.executionFee,
  };
}

/**
 * The owner's own transaction through the ExchangeRouter, for when the owner trades without an agent:
 * `multicall([sendWnt(OrderVault, fee), sendTokens(collateral, OrderVault, amount), createOrder(params)])`.
 */
export function buildOwnerOrder(o: MarketOrder): TxRequest {
  const calls: Hex[] = [encodeFunctionData({ abi: exchangeRouterAbi, functionName: 'sendWnt', args: [GMX.orderVault, o.executionFee] })];
  if (o.kind === 'increase' && o.collateralDeltaAmount > 0n) {
    calls.push(
      encodeFunctionData({ abi: exchangeRouterAbi, functionName: 'sendTokens', args: [o.collateralToken, GMX.orderVault, o.collateralDeltaAmount] }),
    );
  }
  calls.push(encodeFunctionData({ abi: exchangeRouterAbi, functionName: 'createOrder', args: [createOrderParams(o)] }));
  return {
    to: GMX.exchangeRouter,
    data: encodeFunctionData({ abi: exchangeRouterAbi, functionName: 'multicall', args: [calls] }),
    value: o.executionFee,
  };
}

/** The agent cancels a pending order of the owner's (counts as one subaccount action). */
export function buildAgentCancel(key: Hex): TxRequest {
  return { to: GMX.subaccountRouter, data: encodeFunctionData({ abi: subaccountRouterAbi, functionName: 'cancelOrder', args: [key] }), value: 0n };
}

// ---------------------------------------------------------------------------------------------------------------
// Receipts and reverts
// ---------------------------------------------------------------------------------------------------------------

export type GmxEvent = { eventName: string; topic1?: Hex; topic2?: Hex; blockNumber: bigint; txHash: Hex; logIndex: number };

/** Every GMX EventEmitter event in a receipt, by name. */
export function gmxEventsIn(receipt: Pick<TransactionReceipt, 'logs'>): GmxEvent[] {
  const out: GmxEvent[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== GMX.eventEmitter.toLowerCase()) continue;
    try {
      const d = decodeEventLog({ abi: eventEmitterAbi, data: log.data, topics: log.topics });
      const args = d.args as { eventName: string; topic1?: Hex; topic2?: Hex };
      out.push({
        eventName: args.eventName,
        topic1: args.topic1,
        topic2: args.topic2,
        blockNumber: log.blockNumber ?? 0n,
        txHash: log.transactionHash ?? '0x',
        logIndex: log.logIndex ?? 0,
      });
    } catch {
      // Not one of the three EventLog shapes.
    }
  }
  return out;
}

/** The key of the order a createOrder transaction made (GMX's `OrderCreated`, topic1). */
export function orderKeyFromReceipt(receipt: Pick<TransactionReceipt, 'logs'>): Hex {
  const created = gmxEventsIn(receipt).find((e) => e.eventName === 'OrderCreated');
  if (!created?.topic1) throw new Error('The transaction created no GMX order (no OrderCreated event).');
  return created.topic1;
}

/** GMX's error name (and args) for revert data, or undefined when it is not a GMX error. */
export function decodeGmxError(data: Hex): { name: string; args: readonly unknown[] } | undefined {
  try {
    const d = decodeErrorResult({ abi: gmxErrorsAbi, data });
    return { name: d.errorName, args: (d.args ?? []) as readonly unknown[] };
  } catch {
    return undefined;
  }
}

/** The GMX error name inside a viem error (a failed simulate, estimate or call), when there is one. */
export function gmxRevertName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  let found: string | undefined;
  err.walk((e) => {
    const data = (e as { data?: unknown }).data;
    const hex = typeof data === 'string' ? data : (data as { data?: unknown } | undefined)?.data;
    if (typeof hex === 'string' && isHex(hex) && hex.length >= 10) {
      const d = decodeGmxError(hex as Hex);
      if (d) found = d.name;
    }
    const named = (e as { data?: { errorName?: string } }).data?.errorName;
    if (!found && typeof named === 'string') found = named;
    return false;
  });
  if (found) return found;
  const m = /reverted with (?:custom error|the following signature)[:\s]+(0x[0-9a-fA-F]{8,})/.exec(err.message);
  if (m?.[1]) return decodeGmxError(m[1] as Hex)?.name;
  return undefined;
}
