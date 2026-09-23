/**
 * GMX V2 on Arbitrum One: contracts, markets, tokens and the DataStore keys this module reads (2026-09-23).
 *
 * Addresses are the LIVE ones, read on 2026-09-23 — the repo's `deployments` folder predates GMX's last router
 * upgrade and is wrong. The OrderHandler is not a constant anyone should trust from a list: it is what
 * `ExchangeRouter.orderHandler()` answers, and it answered 0xa5D2d452… for both routers.
 *
 * DataStore keys are `keccak256(abi.encode(...))` exactly as gmx-synthetics `data/Keys.sol` builds them — not
 * `encodePacked`, which gives a different, empty slot and reads as zero instead of failing.
 */
import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';

export const GMX = {
  exchangeRouter: '0x7dE39FF2e232A2203196788d37e234cF8F1b83f1',
  /** The Router collateral is approved to; both routers pull through it (`pluginTransfer`). */
  router: '0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6',
  subaccountRouter: '0x9c05880A2AaD7530c69e18e342eDC9E06cc757db',
  dataStore: '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8',
  orderVault: '0x31eF83a530Fde1B38EE9A18093A333D8Bbbc40D5',
  orderHandler: '0xa5D2d45228ee2E3A18AB122B2cE84997d008f4Eb',
  reader: '0xfA26cBb46e2614609406de08CA1Dc7f70a684184',
  roleStore: '0x3c3d99FD298f679DBC2CEcd132b4eC4d0F5e6e72',
  eventEmitter: '0xC8ee91A54287DB53897056e12D9819156D3822Fb',
  oracle: '0x26C02F221e8dB5A821e12347C7eA8a6b6E10842f',
} as const satisfies Record<string, Address>;

export const TOKENS = {
  WETH: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 },
  /** GMX's synthetic BTC index token (no contract behind it; prices only). */
  BTC: { address: '0x47904963fc8b2340414262125aF798B9655E58Cd', decimals: 8 },
  WBTC: { address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8 },
  /** Circle's native USDC — not USDC.e. */
  USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
  /** Paxos USDG. */
  USDG: { address: '0x004B506865409877C9fA29bfb1ebA929984B9bbC', decimals: 6 },
} as const satisfies Record<string, { address: Address; decimals: number }>;

export type TokenSymbol = keyof typeof TOKENS;

export type GmxMarket = {
  /** Our id for the market, stable in URLs and the database. */
  id: 'ETH-USD' | 'BTC-USD' | 'ETH-USD-USDG' | 'BTC-USD-USDG';
  /** GMX's own name for it, as `/markets` spells it. */
  name: string;
  marketToken: Address;
  index: TokenSymbol;
  long: TokenSymbol;
  short: TokenSymbol;
};

/** The markets xorr trades. Each `marketToken` was checked against `/markets` on 2026-09-23. */
export const MARKETS: readonly GmxMarket[] = [
  { id: 'ETH-USD', name: 'ETH/USD [ETH-USDC]', marketToken: '0x70d95587d40A2caf56bd97485aB3Eec10Bee6336', index: 'WETH', long: 'WETH', short: 'USDC' },
  { id: 'BTC-USD', name: 'BTC/USD [WBTC.b-USDC]', marketToken: '0x47c031236e19d024b42f8AE6780E44A573170703', index: 'BTC', long: 'WBTC', short: 'USDC' },
  { id: 'ETH-USD-USDG', name: 'ETH/USD [USDG-USDG]', marketToken: '0x6f095F58e9Eb2c583A1828202712c03962491d7e', index: 'WETH', long: 'USDG', short: 'USDG' },
  { id: 'BTC-USD-USDG', name: 'BTC/USD [USDG-USDG]', marketToken: '0xe57B97F2f83F39E74Ec83f3e039FD370884784fF', index: 'BTC', long: 'USDG', short: 'USDG' },
];

export function marketById(id: string): GmxMarket | undefined {
  return MARKETS.find((m) => m.id === id);
}

export function marketByToken(marketToken: string): GmxMarket | undefined {
  return MARKETS.find((m) => m.marketToken.toLowerCase() === marketToken.toLowerCase());
}

export function tokenByAddress(address: string): (typeof TOKENS)[TokenSymbol] & { symbol: TokenSymbol } | undefined {
  for (const [symbol, t] of Object.entries(TOKENS) as [TokenSymbol, (typeof TOKENS)[TokenSymbol]][]) {
    if (t.address.toLowerCase() === address.toLowerCase()) return { ...t, symbol };
  }
  return undefined;
}

/** GMX's `Order.OrderType`. */
export const OrderType = {
  MarketSwap: 0,
  LimitSwap: 1,
  MarketIncrease: 2,
  LimitIncrease: 3,
  MarketDecrease: 4,
  LimitDecrease: 5,
  StopLossDecrease: 6,
  Liquidation: 7,
  StopIncrease: 8,
} as const;

/** GMX's `Order.DecreasePositionSwapType`. */
export const DecreasePositionSwapType = { NoSwap: 0, SwapPnlTokenToCollateralToken: 1, SwapCollateralTokenToPnlToken: 2 } as const;

/** USD amounts and prices in GMX carry 30 decimals. */
export const USD_DECIMALS = 30;
export const FLOAT_PRECISION = 10n ** 30n;

// ---------------------------------------------------------------------------------------------------------------
// DataStore keys (gmx-synthetics data/Keys.sol)
// ---------------------------------------------------------------------------------------------------------------

/** `keccak256(abi.encode(string))`. */
export function hashString(s: string): Hex {
  return keccak256(encodeAbiParameters([{ type: 'string' }], [s]));
}

type AbiScalar = 'bytes32' | 'address' | 'bool' | 'uint256';
/** `keccak256(abi.encode(...))` over scalar values. */
export function hashData(types: readonly AbiScalar[], values: readonly unknown[]): Hex {
  return keccak256(encodeAbiParameters(types.map((type) => ({ type })), values as never));
}

export const KEYS = {
  ORDER_KEEPER: hashString('ORDER_KEEPER'),
  SUBACCOUNT_ORDER_ACTION: hashString('SUBACCOUNT_ORDER_ACTION'),
  ESTIMATED_GAS_FEE_BASE_AMOUNT_V2_1: hashString('ESTIMATED_GAS_FEE_BASE_AMOUNT_V2_1'),
  ESTIMATED_GAS_FEE_PER_ORACLE_PRICE: hashString('ESTIMATED_GAS_FEE_PER_ORACLE_PRICE'),
  ESTIMATED_GAS_FEE_MULTIPLIER_FACTOR: hashString('ESTIMATED_GAS_FEE_MULTIPLIER_FACTOR'),
  INCREASE_ORDER_GAS_LIMIT: hashString('INCREASE_ORDER_GAS_LIMIT'),
  DECREASE_ORDER_GAS_LIMIT: hashString('DECREASE_ORDER_GAS_LIMIT'),
  SINGLE_SWAP_GAS_LIMIT: hashString('SINGLE_SWAP_GAS_LIMIT'),
  MAX_ORACLE_REF_PRICE_DEVIATION_FACTOR: hashString('MAX_ORACLE_REF_PRICE_DEVIATION_FACTOR'),
} as const;

export const keys = {
  subaccountList: (account: Address) => hashData(['bytes32', 'address'], [hashString('SUBACCOUNT_LIST'), account]),
  maxAllowedSubaccountActionCount: (account: Address, subaccount: Address, actionType: Hex) =>
    hashData(['bytes32', 'address', 'address', 'bytes32'], [hashString('MAX_ALLOWED_SUBACCOUNT_ACTION_COUNT'), account, subaccount, actionType]),
  subaccountActionCount: (account: Address, subaccount: Address, actionType: Hex) =>
    hashData(['bytes32', 'address', 'address', 'bytes32'], [hashString('SUBACCOUNT_ACTION_COUNT'), account, subaccount, actionType]),
  subaccountExpiresAt: (account: Address, subaccount: Address, actionType: Hex) =>
    hashData(['bytes32', 'address', 'address', 'bytes32'], [hashString('SUBACCOUNT_EXPIRES_AT'), account, subaccount, actionType]),
  subaccountIntegrationId: (account: Address, subaccount: Address) =>
    hashData(['bytes32', 'address', 'address'], [hashString('SUBACCOUNT_INTEGRATION_ID'), account, subaccount]),
  /** `Keys.oracleProviderForTokenKey(oracle, token)` — the provider the Oracle insists on for a token. */
  oracleProviderForToken: (oracle: Address, token: Address) =>
    hashData(['bytes32', 'address', 'address'], [hashString('ORACLE_PROVIDER_FOR_TOKEN'), oracle, token]),
  isOracleProviderEnabled: (provider: Address) => hashData(['bytes32', 'address'], [hashString('IS_ORACLE_PROVIDER_ENABLED'), provider]),
  priceFeed: (token: Address) => hashData(['bytes32', 'address'], [hashString('PRICE_FEED'), token]),
  priceFeedHeartbeatDuration: (token: Address) =>
    hashData(['bytes32', 'address'], [hashString('PRICE_FEED_HEARTBEAT_DURATION'), token]),
  uiFeeFactor: (account: Address) => hashData(['bytes32', 'address'], [hashString('UI_FEE_FACTOR'), account]),
  /** `Position.getPositionKey`: `keccak256(abi.encode(account, market, collateralToken, isLong))`. */
  position: (account: Address, market: Address, collateralToken: Address, isLong: boolean) =>
    hashData(['address', 'address', 'address', 'bool'], [account, market, collateralToken, isLong]),
};
