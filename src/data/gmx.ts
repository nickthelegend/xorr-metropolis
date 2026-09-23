/**
 * GMX V2 on Arbitrum One, as the executor reads it (`server/src/venues/gmx/`, PLAN.md P4.5).
 *
 * Markets come from GMX's own API (funding, borrowing, open interest, liquidity, mark price); positions from GMX's Reader
 * for the signed-in wallet's own GMX account; orders from the executor's record, re-read from the chain while pending.
 */
import { api } from './api';

export type GmxMarket = {
  id: string;
  name: string;
  markPrice: number | null;
  priceAt: number | null;
  openInterestUsd: { long: number; short: number };
  availableLiquidityUsd: { long: number; short: number };
  fundingPctPerHour: { long: number; short: number };
  borrowingPctPerHour: { long: number; short: number };
  netPctPerHour: { long: number; short: number };
  source: string;
};

export type GmxPosition = {
  marketId: string | null;
  collateralSymbol: string | null;
  isLong: boolean;
  sizeUsd: number;
  collateralAmount: number;
  entryPrice: number | null;
};

export type GmxOrder = {
  key: string;
  market: string;
  is_long: boolean;
  kind: string;
  size_usd: string;
  collateral_usd: string;
  status: 'pending' | 'executed' | 'cancelled' | 'frozen' | string;
  created_tx: string;
  executed_tx: string | null;
  reason: string | null;
  created_at: string;
};

export type HedgeSetup = {
  agent: string;
  agentName: string;
  subaccount: { active: boolean; maxAllowedCount: string; actionCount: string; expiresAt: string };
  toSign: { label: string; tx: { to: `0x${string}`; data: `0x${string}`; value: string } }[];
};
export type HedgeResult = { key: string; createdTx: string; status: string; executedTx?: string | null; keeper?: string; reason?: string };

export const gmx = {
  hedgeSetup: () => api.get<HedgeSetup>('/gmx/hedge/setup'),
  open: (p: { marketId: 'ETH-USD' | 'BTC-USD'; isLong: boolean; collateralUsd: number; leverage: number }) =>
    api.post<HedgeResult>('/gmx/hedge/open', p),
  close: (p: { marketId: string; isLong: boolean }) => api.post<HedgeResult>('/gmx/hedge/close', p),
  markets: () => api.get<{ markets: GmxMarket[] }>('/gmx/markets').then((r) => r.markets),
  positions: () => api.get<{ positions: GmxPosition[] }>('/gmx/positions').then((r) => r.positions),
  orders: () => api.get<{ orders: GmxOrder[] }>('/gmx/orders').then((r) => r.orders),
};
