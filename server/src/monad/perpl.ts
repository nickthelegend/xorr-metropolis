/**
 * Perpl, Monad's perpetuals exchange: its public market state, for the council and the risk screens (PLAN.md P3.1,
 * 2026-09-24).
 *
 * `GET https://app.perpl.xyz/api/v1/pub/context` needs no key. Each market carries its config (`price_decimals`,
 * `size_decimals`, `is_open`, margins, fees) and its state (`mrk` mark, `bid`, `ask`, `oi` open interest, `lst` last),
 * integers scaled by those decimals. Read 2026-09-24: BTC mark 844583 at 1 price decimal = $84,458.3; markets BTC, MON,
 * ETH, SOL and more; no stock perps.
 *
 * The funding block's `rate` is passed through as `fundingRateRaw` and not converted: its unit is not stated in the
 * response, and a funding rate with a guessed unit is a number the council would reason from as if it were true.
 *
 * Perpl's `geo_block` list (BY, CU, GB, IR, KP, RU, SY, UA, US on 2026-09-24) is returned with the markets, so a screen
 * can say where trading is not offered rather than letting an order fail.
 */
import { getJson } from '../http/get.js';

export const PERPL_API = process.env.PERPL_API ?? 'https://app.perpl.xyz/api';

type RawMarket = {
  id: number;
  name: string;
  config?: { is_open?: boolean; price_decimals?: number; size_decimals?: number; initial_margin?: number; maintenance_margin?: number };
  state?: { at?: { b?: number; t?: number }; mrk?: number; bid?: number; ask?: number; lst?: number; oi?: number };
  funding?: { at?: { t?: number }; rate?: number };
};
type RawContext = { markets?: RawMarket[]; geo_block?: string[] };

export type PerplMarket = {
  id: number;
  name: string;
  open: boolean;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  /** Open interest in the market's own size units (BTC for BTC). */
  openInterest: number | null;
  fundingRateRaw: number | null;
  /** When Perpl last updated the state, ISO. */
  at: string | null;
};

const scaled = (v: number | undefined, decimals: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v / 10 ** decimals : null;

export function parseMarket(m: RawMarket): PerplMarket {
  const pd = m.config?.price_decimals ?? 0;
  const sd = m.config?.size_decimals ?? 0;
  return {
    id: m.id,
    name: m.name,
    open: m.config?.is_open === true,
    mark: scaled(m.state?.mrk, pd),
    bid: scaled(m.state?.bid, pd),
    ask: scaled(m.state?.ask, pd),
    openInterest: scaled(m.state?.oi, sd),
    fundingRateRaw: typeof m.funding?.rate === 'number' ? m.funding.rate : null,
    at: typeof m.state?.at?.t === 'number' ? new Date(m.state.at.t).toISOString() : null,
  };
}

export type PerplContext = { markets: PerplMarket[]; geoBlock: string[] };

export function parseContext(raw: RawContext): PerplContext {
  return { markets: (raw.markets ?? []).map(parseMarket), geoBlock: raw.geo_block ?? [] };
}

/** Perpl's markets as they stand, through the shared cached GET. */
export async function perplContext(): Promise<PerplContext> {
  return parseContext(await getJson<RawContext>(`${PERPL_API}/v1/pub/context`));
}
