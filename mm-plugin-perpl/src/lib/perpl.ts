/**
 * Perpl, Monad's on-chain perpetuals exchange, for the MetaMask Agent Wallet: its networks, its Exchange's encoding, and
 * the arithmetic an order needs. Ported from xorr's executor (`server/src/monad/perpl-chain.ts`), where the same encoding
 * filled orders on Monad testnet on 2026-09-24.
 *
 * Here the agent wallet owns its Perpl account directly — `approve` AUSD to the Exchange, then `createAccount` — so every
 * order is the wallet's own transaction, submitted through `mm`'s policy-gated executor.
 *
 * Encoding (Perpl's dex-sdk `types/request.rs`): order types 0 OpenLong · 1 OpenShort · 2 CloseLong · 3 CloseShort; price
 * in the market's price decimals, size in its lot decimals, collateral in 6 decimals (AUSD); leverage in hundredths
 * (200 = 2x); an IOC order is void after `lastExecutionBlock`.
 */
import { encodeFunctionData, erc20Abi, parseAbi, type Address, type Hex } from 'viem';

export type NetworkKey = 'testnet' | 'mainnet';

export type PerplNet = {
  key: NetworkKey;
  chainId: number;
  name: string;
  exchange: Address;
  /** AUSD, Agora's dollar: Perpl's margin. */
  collateral: Address;
  api: string;
  explorerTx: (hash: string) => string;
};

/** Perpl's deployments, from Perpl's own READMEs, each checked on chain (the Exchange answers both). */
export const NETWORKS: Record<NetworkKey, PerplNet> = {
  testnet: {
    key: 'testnet',
    chainId: 10143,
    name: 'Perpl testnet',
    exchange: '0x1964C32f0bE608E7D29302AFF5E61268E72080cc',
    collateral: '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC',
    api: 'https://testnet.perpl.xyz/api',
    explorerTx: (h) => `https://testnet.monadvision.com/tx/${h}`,
  },
  mainnet: {
    key: 'mainnet',
    chainId: 143,
    name: 'Perpl',
    exchange: '0x34B6552d57a35a1D042CcAe1951BD1C370112a6F',
    collateral: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a',
    api: 'https://app.perpl.xyz/api',
    explorerTx: (h) => `https://monadscan.com/tx/${h}`,
  },
};

const ORDER_DESC =
  '(uint256 orderDescId,uint256 perpId,uint8 orderType,uint256 orderId,uint256 pricePNS,uint256 lotLNS,uint256 expiryBlock,bool postOnly,bool fillOrKill,bool immediateOrCancel,uint256 maxMatches,uint256 leverageHdths,uint256 lastExecutionBlock,uint256 amountCNS,uint256 maxNegPnlCollatBPS)';

export const EXCHANGE_ABI = parseAbi([
  `function execOrder(${ORDER_DESC} orderDesc) returns (uint256 perpId, uint256 orderId)`,
  'function createAccount(uint256 amountCNS) returns (uint256 accountId)',
  'function depositCollateral(uint256 amountCNS)',
  'function getAccountByAddr(address accountAddress) view returns ((uint256 accountId,uint256 balanceCNS,uint256 lockedBalanceCNS,uint8 frozen,address accountAddr,(uint256 bank1,uint256 bank2,uint256 bank3,uint256 bank4) positions) accountInfo)',
  'function getPosition(uint256 perpId, uint256 accountId) view returns ((uint256 accountId,uint256 nextNodeId,uint256 prevNodeId,uint8 positionType,uint256 depositCNS,uint256 pricePNS,uint256 lotLNS,uint256 entryBlock,int256 pnlCNS,int256 deltaPnlCNS,int256 premiumPnlCNS) positionInfo, uint256 markPricePNS, bool markPriceValid)',
  'function getMinAccountOpenCNS() view returns (uint256)',
]);

export const ORDER_TYPE = { open_long: 0, open_short: 1, close_long: 2, close_short: 3 } as const;
export type PerpSide = keyof typeof ORDER_TYPE;

/** A market as Perpl's public context describes it. */
export type Market = {
  id: number;
  name: string;
  priceDecimals: number;
  lotDecimals: number;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  /** When Perpl last updated the mark. */
  at: string | null;
  /** Funding per interval as a fraction (Perpl's `rate` is in millionths). Positive: longs pay shorts. */
  fundingPerInterval: number | null;
  fundingIntervalSec: number | null;
  /** In the market's own units. */
  openInterest: number | null;
  /** Leverage to open, and where a position is liquidated, as multiples. */
  maxLeverage: number;
  maintLeverage: number;
  open: boolean;
};

export type RawMarket = {
  id: number;
  name: string;
  funding_interval_sec?: number;
  config?: { is_open?: boolean; price_decimals?: number; size_decimals?: number; initial_margin?: number; maintenance_margin?: number };
  state?: { at?: { t?: number }; mrk?: number; bid?: number; ask?: number; oi?: number };
  funding?: { rate?: number };
};

export function parseMarket(m: RawMarket): Market {
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
    at: typeof m.state?.at?.t === 'number' ? new Date(m.state.at.t).toISOString() : null,
    fundingPerInterval: typeof m.funding?.rate === 'number' ? m.funding.rate / 1e6 : null,
    fundingIntervalSec: m.funding_interval_sec ?? null,
    openInterest: scale(m.state?.oi, sd),
    maxLeverage: (m.config?.initial_margin ?? 0) / 100,
    maintLeverage: (m.config?.maintenance_margin ?? 0) / 100,
    open: m.config?.is_open === true,
  };
}

/** Funding per hour, % of notional. Positive: longs pay shorts. */
export function fundingPctPerHour(m: Pick<Market, 'fundingPerInterval' | 'fundingIntervalSec'>): number | null {
  if (m.fundingPerInterval === null || !m.fundingIntervalSec) return null;
  return m.fundingPerInterval * 100 * (3600 / m.fundingIntervalSec);
}

/** Find a market by what a person types: "MON", "mon", "MON Perp" or its id. */
export function findMarket(markets: readonly Market[], query: string): Market | undefined {
  const q = query.trim().toUpperCase().replace(/ PERP$/, '');
  return markets.find((m) => m.name.toUpperCase() === q || String(m.id) === q);
}

/** How far through the top of the book an IOC may reach, and the underwater allowance at entry. */
export const IOC_TOLERANCE = 0.01;
export const MAX_NEG_PNL_BPS = 300n;
export const MAX_MATCHES = 16n;
/**
 * Blocks the order stays executable. xorr's executor signs at once and uses 18 (~5.4 s at 300 ms blocks); an agent wallet
 * may wait on its owner's approval, so the plugin allows ~60 s. The IOC limit still bounds the price.
 */
export const EXEC_WINDOW_BLOCKS = 150n;

export type OrderPlan = {
  perpId: number;
  market: string;
  side: PerpSide;
  lotLNS: bigint;
  lots: number;
  pricePNS: bigint;
  limitPrice: number;
  notionalUsd: number;
  leverageHdths: number;
};

/**
 * Size an IOC order in dollars against the book top. Buys (open long, close short) reach up to ask × (1 + tolerance);
 * sells down to bid × (1 − tolerance). A size that rounds to zero lots is refused rather than sent as an order for nothing.
 */
export function planOrder(market: Market, side: PerpSide, usd: number, leverageHdths: number): OrderPlan {
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
    market: market.name,
    side,
    lotLNS,
    lots,
    pricePNS,
    limitPrice: Number(pricePNS) / 10 ** market.priceDecimals,
    notionalUsd: lots * top,
    leverageHdths,
  };
}

export function execOrderData(plan: OrderPlan, head: bigint, id: bigint): Hex {
  return encodeFunctionData({
    abi: EXCHANGE_ABI,
    functionName: 'execOrder',
    args: [
      {
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
      },
    ],
  });
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

/** AUSD has 6 decimals. */
export const toCns = (usd: number) => BigInt(Math.round(usd * 1e6));

export const approveData = (spender: Address, amount: bigint): Hex =>
  encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] });
export const createAccountData = (amount: bigint): Hex =>
  encodeFunctionData({ abi: EXCHANGE_ABI, functionName: 'createAccount', args: [amount] });
export const depositData = (amount: bigint): Hex =>
  encodeFunctionData({ abi: EXCHANGE_ABI, functionName: 'depositCollateral', args: [amount] });

/** Perpl's public context: every market, and where Perpl does not offer trading. */
export async function readContext(net: PerplNet, fetchJson: (url: string) => Promise<unknown> = getJson): Promise<{ markets: Market[]; geoBlock: string[] }> {
  const raw = (await fetchJson(`${net.api}/v1/pub/context`)) as { markets?: RawMarket[]; geo_block?: string[] };
  return { markets: (raw.markets ?? []).map(parseMarket), geoBlock: raw.geo_block ?? [] };
}

export async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered HTTP ${res.status}`);
  return res.json();
}
