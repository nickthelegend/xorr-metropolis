/**
 * The calldata xorr hands GMX, decoded back and checked field by field — and the pieces of GMX's arithmetic this
 * module reimplements (keys, execution fee, acceptable price). The same calldata executed for real on a fork in
 * `prove-gmx.ts`; these tests keep it from drifting.
 */
import { decodeFunctionData, encodeErrorResult, erc20Abi, maxUint256, stringToHex, zeroAddress, zeroHash, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { exchangeRouterAbi, gmxErrorsAbi, subaccountRouterAbi } from './abis.js';
import { GMX, KEYS, MARKETS, OrderType, TOKENS, hashString, keys } from './constants.js';
import {
  acceptablePrice,
  buildAgentOrder,
  buildCollateralApproval,
  buildOwnerOrder,
  buildRemoveSubaccount,
  buildSubaccountSetup,
  decodeGmxError,
  estimateExecutionFee,
  executionGasLimit,
  referralCodeFromEnv,
  uiFeeReceiverFromEnv,
} from './orders.js';

const OWNER = '0x1111111111111111111111111111111111111111' as const;
const AGENT = '0x2222222222222222222222222222222222222222' as const;
const ETH = MARKETS.find((m) => m.id === 'ETH-USD')!;

describe('DataStore keys', () => {
  it('matches the constants GMX publishes', () => {
    // Role.sol / forked-env-example: ORDER_KEEPER = keccak256(abi.encode("ORDER_KEEPER")).
    expect(KEYS.ORDER_KEEPER).toBe('0x40a07f8f0fc57fcf18b093d96362a8e661eaac7b7e6edbf66f242111f83a6794');
    expect(hashString('SUBACCOUNT_ORDER_ACTION')).toBe(KEYS.SUBACCOUNT_ORDER_ACTION);
  });

  it('builds the oracle-provider key the live DataStore answers for WETH', () => {
    // DataStore.getAddress(this key) on Arbitrum One answered 0x7BA7Ae61… on 2026-09-23: the encoding is the contract's.
    expect(keys.oracleProviderForToken(GMX.oracle, TOKENS.WETH.address)).toBe('0x01a9c07f28bb6e17afbbb8e93c38d12e6fea42c6dd0df4b1c10bb681d5f30071');
  });
});

describe('owner setup', () => {
  it('registers the agent with count and expiry in one multicall, funding it when asked', () => {
    const tx = buildSubaccountSetup({ subaccount: AGENT, maxAllowedCount: 3n, expiresAt: 1_800_000_000n, fundSubaccountWei: 10n ** 17n });
    expect(tx.to).toBe(GMX.subaccountRouter);
    expect(tx.value).toBe(10n ** 17n);
    const outer = decodeFunctionData({ abi: subaccountRouterAbi, data: tx.data });
    expect(outer.functionName).toBe('multicall');
    const inner = (outer.args![0] as Hex[]).map((d) => decodeFunctionData({ abi: subaccountRouterAbi, data: d }));
    expect(inner.map((c) => c.functionName)).toEqual([
      'addSubaccount',
      'setMaxAllowedSubaccountActionCount',
      'setSubaccountExpiresAt',
      'sendNativeToken',
    ]);
    expect(inner[1]!.args).toEqual([AGENT, KEYS.SUBACCOUNT_ORDER_ACTION, 3n]);
    expect(inner[2]!.args).toEqual([AGENT, KEYS.SUBACCOUNT_ORDER_ACTION, 1_800_000_000n]);
    expect(inner[3]!.args).toEqual([AGENT, 10n ** 17n]);
  });

  it('refuses a zero count and sends no ETH unless asked', () => {
    expect(() => buildSubaccountSetup({ subaccount: AGENT, maxAllowedCount: 0n, expiresAt: 1n })).toThrow(/at least 1/);
    expect(buildSubaccountSetup({ subaccount: AGENT, maxAllowedCount: 1n, expiresAt: 1n }).value).toBe(0n);
  });

  it('approves collateral to the Router, not a router contract', () => {
    const tx = buildCollateralApproval(TOKENS.USDC.address);
    expect(tx.to).toBe(TOKENS.USDC.address);
    const d = decodeFunctionData({ abi: erc20Abi, data: tx.data });
    expect(d.args).toEqual([GMX.router, maxUint256]);
  });

  it('removes the agent', () => {
    const d = decodeFunctionData({ abi: subaccountRouterAbi, data: buildRemoveSubaccount(AGENT).data });
    expect(d.functionName).toBe('removeSubaccount');
    expect(d.args).toEqual([AGENT]);
  });
});

describe('agent order', () => {
  const base = {
    account: OWNER,
    market: ETH.marketToken,
    collateralToken: TOKENS.USDC.address,
    isLong: true,
    sizeDeltaUsd: 100n * 10n ** 30n,
    acceptablePrice: 2_800n * 10n ** 12n,
    executionFee: 5n * 10n ** 15n,
    uiFeeReceiver: zeroAddress,
    referralCode: zeroHash,
  } as const;

  it('sends the fee to the OrderVault and creates the order for the OWNER', () => {
    const tx = buildAgentOrder({ ...base, kind: 'increase', collateralDeltaAmount: 50_000_000n });
    expect(tx.to).toBe(GMX.subaccountRouter);
    expect(tx.value).toBe(base.executionFee);
    const outer = decodeFunctionData({ abi: subaccountRouterAbi, data: tx.data });
    const [sendWnt, create] = (outer.args![0] as Hex[]).map((d) => decodeFunctionData({ abi: subaccountRouterAbi, data: d }));
    expect(sendWnt!.functionName).toBe('sendWnt');
    expect(sendWnt!.args).toEqual([GMX.orderVault, base.executionFee]);
    expect(create!.functionName).toBe('createOrder');
    const [account, params] = create!.args as [string, any];
    expect(account).toBe(OWNER);
    expect(params.addresses.receiver).toBe(OWNER);
    expect(params.addresses.cancellationReceiver).toBe(OWNER);
    expect(params.addresses.market).toBe(ETH.marketToken);
    expect(params.addresses.initialCollateralToken).toBe(TOKENS.USDC.address);
    expect(params.numbers.initialCollateralDeltaAmount).toBe(50_000_000n);
    expect(params.numbers.executionFee).toBe(base.executionFee);
    expect(params.orderType).toBe(OrderType.MarketIncrease);
    expect(params.isLong).toBe(true);
  });

  it('closes with a MarketDecrease', () => {
    const tx = buildAgentOrder({ ...base, kind: 'decrease', collateralDeltaAmount: 0n });
    const outer = decodeFunctionData({ abi: subaccountRouterAbi, data: tx.data });
    const create = decodeFunctionData({ abi: subaccountRouterAbi, data: (outer.args![0] as Hex[])[1]! });
    expect((create.args![1] as any).orderType).toBe(OrderType.MarketDecrease);
  });

  it('carries the UI fee receiver and referral code', () => {
    const ui = '0x3333333333333333333333333333333333333333' as const;
    const code = stringToHex('xorr', { size: 32 });
    const tx = buildAgentOrder({ ...base, kind: 'increase', collateralDeltaAmount: 1n, uiFeeReceiver: ui, referralCode: code });
    const outer = decodeFunctionData({ abi: subaccountRouterAbi, data: tx.data });
    const params = decodeFunctionData({ abi: subaccountRouterAbi, data: (outer.args![0] as Hex[])[1]! }).args![1] as any;
    expect(params.addresses.uiFeeReceiver).toBe(ui);
    expect(params.referralCode).toBe(code);
  });

  it('the owner-signed ExchangeRouter path sends collateral itself', () => {
    const tx = buildOwnerOrder({ ...base, kind: 'increase', collateralDeltaAmount: 50_000_000n });
    expect(tx.to).toBe(GMX.exchangeRouter);
    const outer = decodeFunctionData({ abi: exchangeRouterAbi, data: tx.data });
    const names = (outer.args![0] as Hex[]).map((d) => decodeFunctionData({ abi: exchangeRouterAbi, data: d }).functionName);
    expect(names).toEqual(['sendWnt', 'sendTokens', 'createOrder']);
  });
});

describe('env attribution', () => {
  it('reads GMX_UI_FEE_RECEIVER and refuses a non-address', () => {
    expect(uiFeeReceiverFromEnv({})).toBe(zeroAddress);
    expect(uiFeeReceiverFromEnv({ GMX_UI_FEE_RECEIVER: '0x3333333333333333333333333333333333333333' })).toBe('0x3333333333333333333333333333333333333333');
    expect(() => uiFeeReceiverFromEnv({ GMX_UI_FEE_RECEIVER: 'me' })).toThrow(/not an address/);
  });

  it('reads GMX_REFERRAL_CODE as text or bytes32', () => {
    expect(referralCodeFromEnv({})).toBe(zeroHash);
    expect(referralCodeFromEnv({ GMX_REFERRAL_CODE: 'xorr' })).toBe(stringToHex('xorr', { size: 32 }));
    const raw = `0x${'ab'.repeat(32)}` as const;
    expect(referralCodeFromEnv({ GMX_REFERRAL_CODE: raw })).toBe(raw);
  });
});

describe('acceptable price', () => {
  const p = { min: 2_000n * 10n ** 12n, max: 2_002n * 10n ** 12n };
  it('bounds buying exposure from above at max × (1 + s)', () => {
    expect(acceptablePrice(p, true, true, 100)).toBe((p.max * 10_100n) / 10_000n);
    expect(acceptablePrice(p, false, false, 100)).toBe((p.max * 10_100n) / 10_000n);
  });
  it('bounds selling exposure from below at min × (1 − s)', () => {
    expect(acceptablePrice(p, false, true, 50)).toBe((p.min * 9_950n) / 10_000n);
    expect(acceptablePrice(p, true, false, 50)).toBe((p.min * 9_950n) / 10_000n);
  });
  it('refuses a nonsense slippage', () => {
    expect(() => acceptablePrice(p, true, true, 10_000)).toThrow();
    expect(() => acceptablePrice(p, true, true, 1.5)).toThrow();
  });
});

describe('execution fee', () => {
  // Values read from the live DataStore on 2026-09-23.
  const live = {
    base: 132_763n,
    perOraclePrice: 336_595n,
    multiplier: 10n ** 30n,
    orderGas: 3_000_000n,
    swapGas: 1_000_000n,
  };

  it('is GasUtils.adjustGasLimitForEstimate over the order estimate', () => {
    expect(executionGasLimit({ ...live, swaps: 0n, oraclePriceCount: 3n, callbackGasLimit: 0n })).toBe(4_142_548n);
    expect(executionGasLimit({ ...live, multiplier: 12n * 10n ** 29n, swaps: 1n, oraclePriceCount: 4n, callbackGasLimit: 0n })).toBe(
      132_763n + 336_595n * 4n + 4_800_000n,
    );
  });

  it('reads the DataStore and prices the gas with the SDK’s 20% buffer', async () => {
    const values: Record<string, bigint> = {
      [KEYS.ESTIMATED_GAS_FEE_BASE_AMOUNT_V2_1]: live.base,
      [KEYS.ESTIMATED_GAS_FEE_PER_ORACLE_PRICE]: live.perOraclePrice,
      [KEYS.ESTIMATED_GAS_FEE_MULTIPLIER_FACTOR]: live.multiplier,
      [KEYS.INCREASE_ORDER_GAS_LIMIT]: live.orderGas,
      [KEYS.DECREASE_ORDER_GAS_LIMIT]: live.orderGas,
      [KEYS.SINGLE_SWAP_GAS_LIMIT]: live.swapGas,
    };
    const client = {
      readContract: async ({ args }: { args: [Hex] }) => values[args[0]] ?? 0n,
      getGasPrice: async () => 10_000_000n,
    } as never;
    const fee = await estimateExecutionFee(client, { kind: 'increase' });
    expect(fee.gasLimit).toBe(4_142_548n);
    expect(fee.txGasPrice).toBe(12_000_000n);
    expect(fee.feeWei).toBe(4_142_548n * 12_000_000n);
  });
});

describe('GMX errors', () => {
  it('decodes a subaccount refusal by name', () => {
    const data = encodeErrorResult({
      abi: gmxErrorsAbi,
      errorName: 'MaxSubaccountActionCountExceeded',
      args: [OWNER, AGENT, 3n, 2n],
    });
    expect(decodeGmxError(data)?.name).toBe('MaxSubaccountActionCountExceeded');
    expect(decodeGmxError('0xdeadbeef')).toBeUndefined();
  });
});
