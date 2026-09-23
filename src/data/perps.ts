/**
 * The Perpl desk, as the executor reads it (`server/src/monad/perpl-desk.ts`, FEATURES-100 #2–#7).
 *
 * The desk is Perpl's own DelegatedAccount: the user owns it and alone can withdraw; xorr's agent key is its operator and
 * can trade but never withdraw. Every number here is read from the chain by the executor on each request.
 */
import { encodeFunctionData, erc20Abi, parseAbi, type Address, type Hex } from 'viem';
import { api } from './api';

export type PerpMarket = {
  id: number;
  name: string;
  priceDecimals: number;
  lotDecimals: number;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  fundingPerInterval: number | null;
  fundingIntervalSec: number | null;
  openInterest: number | null;
  maxLeverage: number;
  maintLeverage: number;
  open: boolean;
};

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
  liqDistance: number | null;
};

export type Desk = {
  network: string;
  exchange: Address;
  factory: Address;
  collateral: Address;
  owner: Address;
  desk: Address | null;
  operator: Address;
  operatorActive: boolean;
  allowlistMissing: { name: string; selector: Hex }[];
  accountId: string;
  balance: number;
  locked: number;
  idle: number;
  wallet: { ausd: number; gas: number };
  positions: DeskPosition[];
  caps: { maxOrderUsd: number; maxDayUsd: number; maxLeverage: number; usedTodayUsd: number };
  createTx: string | null;
  explorer: string | null;
};

export type PerpOrder = {
  id: string;
  perp_id: number;
  market: string;
  side: 'open_long' | 'open_short' | 'close_long' | 'close_short';
  lots: string;
  limit_price: string;
  notional_usd: string;
  leverage_hdths: number;
  status: 'filled' | 'reverted' | 'refused' | 'sent';
  tx_hash: string | null;
  placed_by: string;
  created_at: string;
};

export type PerpOrderResult = {
  id: string;
  status: 'filled' | 'reverted';
  txHash: Hex;
  explorer: string;
  market: string;
  side: PerpOrder['side'];
  lots: number;
  limitPrice: number;
  notionalUsd: number;
  position: DeskPosition | null;
};

export type TypedCreate = {
  domain: { name: string; version: string; chainId: number; verifyingContract: Address };
  types: { Create: { name: string; type: string }[] };
  primaryType: 'Create';
  message: { owner: Address; operator: Address; nonce: string; deadline: string };
};

/** A Perpl mainnet market as `/monad/perpl` reads it (Perpl's public context, live). */
export type PerplLiveMarket = {
  id: number;
  name: string;
  open: boolean;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  /** In the market's own units (BTC for BTC). */
  openInterest: number | null;
  fundingRateRaw: number | null;
  fundingIntervalSec?: number | null;
  /** Percent per hour; positive, longs pay shorts. */
  fundingPctPerHour?: number | null;
  at: string | null;
};

export const perps = {
  /** Perpl on Monad mainnet, read live and public: every open market, and where Perpl does not offer trading. */
  live: () => api.get<{ markets: PerplLiveMarket[]; geoBlock: string[] }>('/monad/perpl'),
  markets: () => api.get<{ network: string; markets: PerpMarket[] }>('/perps/markets'),
  desk: () => api.get<Desk>('/perps/desk'),
  createData: () => api.post<TypedCreate>('/perps/desk/create-data', {}),
  create: (p: { signature: Hex; nonce: string; deadline: string }) =>
    api.post<{ desk: Address; operator: Address; txHash: string; explorer: string }>('/perps/desk/create', p),
  consent: () => api.post<{ desk: Address; operator: Address; deadline: string; signature: Hex }>('/perps/desk/consent', {}),
  setCaps: (caps: { maxOrderUsd: number; maxDayUsd: number; maxLeverage: number }) => api.put<Desk>('/perps/caps', caps),
  order: (p: { perpId: number; side: PerpOrder['side']; usd?: number; leverage?: number; agent?: string }) =>
    api.post<PerpOrderResult>('/perps/order', p),
  orders: () => api.get<{ orders: PerpOrder[] }>('/perps/orders'),
  fundTest: () => api.post<{ sent: { what: string; tx: string; explorer: string }[] }>('/perps/fund-test', {}),
};

/** The desk functions the owner signs, encoded here: the desk contract is Perpl's DelegatedAccount. */
const DESK = parseAbi([
  'function createAccount(uint256 amount)',
  'function withdrawCollateral(uint256 amount)',
  'function removeOperator(address _operator)',
  'function addOperator(address _operator, uint256 _deadline, bytes _sig)',
  'function setOperatorAllowlist(bytes4 selector, bool allowed)',
]);

const units = (usd: number) => BigInt(Math.round(usd * 1e6));

export const deskCalls = {
  fund: (ausd: Address, desk: Address, usd: number) => ({ to: ausd, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [desk, units(usd)] }) }),
  open: (desk: Address, usd: number) => ({ to: desk, data: encodeFunctionData({ abi: DESK, functionName: 'createAccount', args: [units(usd)] }) }),
  allow: (desk: Address, selector: Hex) => ({ to: desk, data: encodeFunctionData({ abi: DESK, functionName: 'setOperatorAllowlist', args: [selector, true] }) }),
  stop: (desk: Address, operator: Address) => ({ to: desk, data: encodeFunctionData({ abi: DESK, functionName: 'removeOperator', args: [operator] }) }),
  resume: (desk: Address, operator: Address, deadline: string, sig: Hex) => ({
    to: desk,
    data: encodeFunctionData({ abi: DESK, functionName: 'addOperator', args: [operator, BigInt(deadline), sig] }),
  }),
  withdraw: (desk: Address, usd: number) => ({ to: desk, data: encodeFunctionData({ abi: DESK, functionName: 'withdrawCollateral', args: [BigInt(Math.floor(usd * 1e6))] }) }),
};
