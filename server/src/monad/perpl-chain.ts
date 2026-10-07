/**
 * Perpl on-chain: the Exchange, Perpl's own DelegatedAccount factory, and the arithmetic an order needs
 * (FEATURES-100 #2/#3/#6, 2026-09-24).
 *
 * Perpl is a fully on-chain perps CLOB with AUSD margin. An account belongs to whoever calls `createAccount`, and only that
 * address may `execOrder` for it. So xorr does not trade a user's Perpl account with the user's key, and does not hold
 * their money: the account is owned by **Perpl's own `DelegatedAccount`** (github.com/PerplFoundation/delegated-account,
 * factory deployed by Perpl on Monad mainnet and testnet). Its owner — the user — alone can withdraw, and a withdrawal
 * always pays the owner. xorr's per-owner agent key is its *operator*: it may call only the Exchange functions Perpl
 * allowlisted for operators (`execOrder(s)`, collateral top-ups, `requestDecreasePositionCollateral`), never
 * `withdrawCollateral`. Removing the operator (`removeOperator`) is the owner's one-transaction stop.
 *
 * Encoding, read from Perpl's SDK (dex-sdk `types/request.rs`) and checked with orders on Monad testnet on 2026-09-24:
 *   - order types 0 OpenLong · 1 OpenShort · 2 CloseLong · 3 CloseShort · 4 Cancel · 5 IncreasePositionCollateral · 6 Change
 *   - price in the market's `priceDecimals`, size in its `lotDecimals`, collateral in 6 decimals (AUSD)
 *   - leverage in hundredths (200 = 2x); `maxMatches` in 1..1000; `lastExecutionBlock` a few blocks ahead (the order is
 *     void after it — Monad makes a block every 300 ms)
 *   - `maxNegPnlCollatBPS`: how much of the collateral an order may start underwater by. 0 refuses any fill above the mark
 *     (a taker buy at the ask always is), which is what `TakerOrderSettlementFailed(…, 14)` was on the first attempt.
 *   - `getMarginFractions` returns leverages in hundredths: MON on testnet 300 (3x to open) / 500 (liquidated at 5x = 20%
 *     maintenance); BTC 1500 / 2500.
 */
import { encodeFunctionData, getAddress, parseAbi, toFunctionSelector, type Address, type Hex, type PublicClient } from 'viem';
import { CHAIN_KEY } from '../evm/chains.js';

export type PerplNetwork = { exchange: Address; factory: Address; collateral: Address; api: string; name: string };

/** Perpl's deployments, from Perpl's own READMEs and each checked on chain (factory.EXCHANGE() answers the Exchange). */
export const PERPL: Record<'monad' | 'monad-testnet', PerplNetwork> = {
  monad: {
    exchange: '0x34B6552d57a35a1D042CcAe1951BD1C370112a6F',
    factory: '0xc535276e3e446e4f28d95ed27ccd5c32e4c8907a',
    collateral: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a',
    api: 'https://app.perpl.xyz/api',
    name: 'Perpl',
  },
  'monad-testnet': {
    exchange: '0x1964C32f0bE608E7D29302AFF5E61268E72080cc',
    factory: '0xf42548Ccb3300Bc76c35dc2D347416db2E8d7209',
    collateral: '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC',
    api: 'https://testnet.perpl.xyz/api',
    name: 'Perpl testnet',
  },
};

/**
 * Perpl on the chain this executor serves, or null where there is none. A fork of mainnet carries Perpl's contracts but
 * not its keepers, so it trades only while the local keeper posts marks (`fork/perpl-keeper.ts`, `PERPL_FORK_KEEPER=1`).
 */
export function perplHere(key: string = CHAIN_KEY, env: NodeJS.ProcessEnv = process.env): PerplNetwork | null {
  if (key === 'monad-testnet') return PERPL['monad-testnet'];
  if (key === 'monad') return PERPL.monad;
  if (key === 'monad-fork' && env.PERPL_FORK_KEEPER === '1') return { ...PERPL.monad, name: 'Perpl (fork)' };
  return null;
}

const ORDER_DESC =
  '(uint256 orderDescId,uint256 perpId,uint8 orderType,uint256 orderId,uint256 pricePNS,uint256 lotLNS,uint256 expiryBlock,bool postOnly,bool fillOrKill,bool immediateOrCancel,uint256 maxMatches,uint256 leverageHdths,uint256 lastExecutionBlock,uint256 amountCNS,uint256 maxNegPnlCollatBPS)';

export const EXCHANGE_ABI = parseAbi([
  `function execOrder(${ORDER_DESC} orderDesc) returns (uint256 perpId, uint256 orderId)`,
  'function getAccountByAddr(address accountAddress) view returns ((uint256 accountId,uint256 balanceCNS,uint256 lockedBalanceCNS,uint8 frozen,address accountAddr,(uint256 bank1,uint256 bank2,uint256 bank3,uint256 bank4) positions) accountInfo)',
  'function getPosition(uint256 perpId, uint256 accountId) view returns ((uint256 accountId,uint256 nextNodeId,uint256 prevNodeId,uint8 positionType,uint256 depositCNS,uint256 pricePNS,uint256 lotLNS,uint256 entryBlock,int256 pnlCNS,int256 deltaPnlCNS,int256 premiumPnlCNS) positionInfo, uint256 markPricePNS, bool markPriceValid)',
  'function getMarginFractions(uint256 perpId, uint256 lotLNS) view returns (uint256 perpInitMarginFracHdths, uint256 perpMaintMarginFracHdths, uint256 dynamicInitMarginFracHdths, uint256 oiMaxLNS, uint256 unityDescentThreshHdths, uint256 overColDescentThreshHdths)',
  'function getTakerFee(uint256 perpId) view returns (uint256)',
  'function getMinAccountOpenCNS() view returns (uint256)',
]);

export const DESK_ABI = parseAbi([
  'function owner() view returns (address)',
  'function isOperator(address) view returns (bool)',
  'function accountId() view returns (uint256)',
  'function createAccount(uint256 amount)',
  'function withdrawCollateral(uint256 amount)',
  'function removeOperator(address _operator)',
  'function addOperator(address _operator, uint256 _deadline, bytes _sig)',
  'function operatorNonces(address) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function operatorAllowlist(bytes4) view returns (bool)',
  'function setOperatorAllowlist(bytes4 selector, bool allowed)',
  `function execOrder(${ORDER_DESC} orderDesc) returns (uint256 perpId, uint256 orderId)`,
  'error OnlyOwnerOrOperator()',
  'error SelectorNotAllowed(bytes4 selector)',
  'error AccountNotCreated()',
]);

export const FACTORY_ABI = parseAbi([
  'function nonces(address) view returns (uint256)',
  'function operatorNonces(address) view returns (uint256)',
  'function createWithSignature(address _owner, address _operator, uint256 _deadline, bytes _ownerSig, uint256 _opDeadline, bytes _opSig) returns (address proxy)',
  'event DelegatedAccountCreated(address indexed proxy, address indexed owner, address indexed operator)',
]);

/** The EIP-712 domain of Perpl's factory, for the owner's `Create` and the operator's `AssignOperator`. */
export function factoryDomain(net: PerplNetwork, chainId: number) {
  return { name: 'DelegatedAccountFactory', version: '1', chainId, verifyingContract: getAddress(net.factory) } as const;
}
export const CREATE_TYPES = {
  Create: [
    { name: 'owner', type: 'address' },
    { name: 'operator', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;
export const ASSIGN_OPERATOR_TYPES = {
  AssignOperator: [
    { name: 'owner', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/**
 * The Exchange functions xorr's operator calls, by their CURRENT selectors. Perpl's README: a desk's operator allowlist is
 * written once, from the selectors its implementation was compiled against, so after an Exchange ABI change a new desk does
 * not allow the current `execOrder` (measured on Monad testnet 2026-09-24: `execOrder` 0x4d8dc985 not allowed,
 * `depositCollateral` and `increasePositionCollateral` allowed). The owner enables them with `setOperatorAllowlist` — the
 * reconciliation Perpl's own setup script performs.
 */
export const OPERATOR_SELECTORS: Record<string, Hex> = {
  execOrder: toFunctionSelector(EXCHANGE_ABI.find((f) => f.type === 'function' && f.name === 'execOrder')!),
};

export const ORDER_TYPE = { open_long: 0, open_short: 1, close_long: 2, close_short: 3 } as const;
export type PerpSide = keyof typeof ORDER_TYPE;

/** A market as the Exchange and Perpl's API describe it: decimals, the live book top, the mark, funding. */
export type PerpMarket = {
  id: number;
  name: string;
  priceDecimals: number;
  lotDecimals: number;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  /** Funding per interval as a fraction (Perpl's `rate` is in millionths: -40 → -0.00004). */
  fundingPerInterval: number | null;
  fundingIntervalSec: number | null;
  openInterest: number | null;
  /** Leverage limits, as multiples (3 = 3x): to open, and where it is liquidated. */
  maxLeverage: number;
  maintLeverage: number;
  open: boolean;
};

/** Perpl's `/v1/pub/context` market, decoded (the same numbers the Exchange stores, scaled by each market's decimals). */
export function marketFromContext(m: {
  id: number;
  name: string;
  funding_interval_sec?: number;
  config?: { is_open?: boolean; price_decimals?: number; size_decimals?: number; initial_margin?: number; maintenance_margin?: number };
  state?: { mrk?: number; bid?: number; ask?: number; oi?: number };
  funding?: { rate?: number };
}): PerpMarket {
  const pd = m.config?.price_decimals ?? 0;
  const sd = m.config?.size_decimals ?? 0;
  const scale = (v: number | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v / 10 ** d : null);
  return {
    id: m.id,
    name: m.name.replace(/ Perp$/, ''),
    priceDecimals: pd,
    lotDecimals: sd,
    mark: scale(m.state?.mrk, pd),
    bid: scale(m.state?.bid, pd),
    ask: scale(m.state?.ask, pd),
    fundingPerInterval: typeof m.funding?.rate === 'number' ? m.funding.rate / 1e6 : null,
    fundingIntervalSec: m.funding_interval_sec ?? null,
    openInterest: scale(m.state?.oi, sd),
    maxLeverage: (m.config?.initial_margin ?? 0) / 100,
    maintLeverage: (m.config?.maintenance_margin ?? 0) / 100,
    open: m.config?.is_open === true,
  };
}

/** An order the desk will send: sized in USD, priced as an IOC limit through the book top. */
export type PerpOrderPlan = {
  perpId: number;
  side: PerpSide;
  lotLNS: bigint;
  lots: number;
  pricePNS: bigint;
  limitPrice: number;
  notionalUsd: number;
  leverageHdths: number;
};

/** How far through the top of the book an IOC may reach, and the underwater allowance at entry. */
export const IOC_TOLERANCE = 0.01;
export const MAX_NEG_PNL_BPS = 300n;
export const MAX_MATCHES = 16n;
/** Blocks ahead the order stays executable: ~5.4 s at Monad's 300 ms. */
export const EXEC_WINDOW_BLOCKS = 18n;

/**
 * Size an IOC order in USD against the book top. Buys (open long, close short) reach up to ask × (1 + tolerance); sells
 * down to bid × (1 − tolerance). Size is rounded down to the market's lot precision; a size that rounds to zero is refused
 * rather than sent as an order for nothing.
 */
export function planOrder(market: PerpMarket, side: PerpSide, usd: number, leverageHdths: number): PerpOrderPlan {
  const buying = side === 'open_long' || side === 'close_short';
  const top = buying ? market.ask : market.bid;
  if (top === null || !(top > 0)) throw new Error(`${market.name}: no ${buying ? 'ask' : 'bid'} on Perpl's book right now`);
  const limit = buying ? top * (1 + IOC_TOLERANCE) : top * (1 - IOC_TOLERANCE);
  const pricePNS = BigInt(Math.floor(limit * 10 ** market.priceDecimals));
  const lotLNS = BigInt(Math.floor((usd / top) * 10 ** market.lotDecimals));
  if (lotLNS <= 0n) throw new Error(`$${usd} is less than one ${market.name} lot at ${top}`);
  const lots = Number(lotLNS) / 10 ** market.lotDecimals;
  return {
    perpId: market.id,
    side,
    lotLNS,
    lots,
    pricePNS,
    limitPrice: Number(pricePNS) / 10 ** market.priceDecimals,
    notionalUsd: lots * top,
    leverageHdths,
  };
}

/** The Exchange's `OrderDesc` for a plan, executable until `head + EXEC_WINDOW_BLOCKS`. */
export function orderDesc(plan: PerpOrderPlan, head: bigint, id: bigint) {
  return {
    orderDescId: id,
    perpId: BigInt(plan.perpId),
    orderType: ORDER_TYPE[plan.side],
    orderId: 0n,
    pricePNS: plan.pricePNS,
    lotLNS: plan.lotLNS,
    expiryBlock: 0n,
    postOnly: false,
    fillOrKill: false,
    immediateOrCancel: true,
    maxMatches: MAX_MATCHES,
    leverageHdths: BigInt(plan.leverageHdths),
    lastExecutionBlock: head + EXEC_WINDOW_BLOCKS,
    amountCNS: 0n,
    maxNegPnlCollatBPS: MAX_NEG_PNL_BPS,
  } as const;
}

export function execOrderData(plan: PerpOrderPlan, head: bigint, id: bigint): Hex {
  return encodeFunctionData({ abi: DESK_ABI, functionName: 'execOrder', args: [orderDesc(plan, head, id)] });
}

/**
 * Where an isolated position is liquidated: equity (deposit + PnL) falls to the maintenance margin, lots × mark / maintLev.
 * Long: m = (entry·lots − deposit) / (lots·(1 − 1/L)). Short: m = (entry·lots + deposit) / (lots·(1 + 1/L)).
 */
export function liquidationPrice(p: { long: boolean; entry: number; lots: number; deposit: number; maintLeverage: number }): number | null {
  if (!(p.lots > 0) || !(p.maintLeverage > 0)) return null;
  const f = 1 / p.maintLeverage;
  const m = p.long ? (p.entry * p.lots - p.deposit) / (p.lots * (1 - f)) : (p.entry * p.lots + p.deposit) / (p.lots * (1 + f));
  return m > 0 ? m : 0;
}

export type DeskPosition = {
  perpId: number;
  market: string;
  long: boolean;
  lots: number;
  entry: number;
  mark: number | null;
  deposit: number;
  pnl: number;
  liquidation: number | null;
  /** How far the mark is from liquidation, as a fraction of the mark (0.38 = 38% away). */
  liqDistance: number | null;
};

/** One position of `accountId`, read from the Exchange now, or null when there is none in that market. */
export async function readPosition(client: PublicClient, net: PerplNetwork, market: PerpMarket, accountId: bigint): Promise<DeskPosition | null> {
  const [pos, markPNS] = await client.readContract({ address: net.exchange, abi: EXCHANGE_ABI, functionName: 'getPosition', args: [BigInt(market.id), accountId] });
  if (pos.lotLNS === 0n) return null;
  const lots = Number(pos.lotLNS) / 10 ** market.lotDecimals;
  const entry = Number(pos.pricePNS) / 10 ** market.priceDecimals;
  const mark = markPNS > 0n ? Number(markPNS) / 10 ** market.priceDecimals : market.mark;
  const deposit = Number(pos.depositCNS) / 1e6;
  const long = pos.positionType === 0;
  const liquidation = liquidationPrice({ long, entry, lots, deposit, maintLeverage: market.maintLeverage });
  return {
    perpId: market.id,
    market: market.name,
    long,
    lots,
    entry,
    mark,
    deposit,
    pnl: Number(pos.pnlCNS) / 1e6,
    liquidation,
    liqDistance: liquidation !== null && mark ? Math.abs(mark - liquidation) / mark : null,
  };
}
