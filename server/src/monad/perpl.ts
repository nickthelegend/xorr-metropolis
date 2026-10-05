/**
 * Perpl, Monad's perpetuals exchange: its public market state, for the council and the risk screens (PLAN.md P3.1,
 * 2026-09-24).
 *
 * `GET https://app.perpl.xyz/api/v1/pub/context` needs no key. Each market carries its config (`price_decimals`,
 * `size_decimals`, `is_open`, margins, fees) and its state (`mrk` mark, `bid`, `ask`, `oi` open interest, `lst` last),
 * integers scaled by those decimals. Read 2026-09-24: BTC mark 844583 at 1 price decimal = $84,458.3; markets BTC, MON,
 * ETH, SOL and more; no stock perps.
 *
 * The funding block's `rate` is passed through as `fundingRateRaw`, and converted beside it: it is in millionths per
 * funding interval (the desk's reading, `perpl-chain.ts`, which Perpl's Exchange settles by: 40 → 0.004% per 2,580 s
 * interval). `fundingPctPerHour` is that, per hour; it is null where the market states no rate or no interval.
 *
 * Perpl's `geo_block` list (BY, CU, GB, IR, KP, RU, SY, UA, US on 2026-09-24) is returned with the markets, so a screen
 * can say where trading is not offered rather than letting an order fail.
 */
import { getJson } from '../http/get.js';
import { CHAIN_KEY } from '../evm/chains.js';
import { PERPL, perplHere, type PerplNetwork } from './perpl-chain.js';

/**
 * The Perpl this build trades on: testnet for the testnet build (where the desks are), mainnet for the mainnet build and
 * its fork (a fork has no Perpl of its own). `PERPL_API` overrides the address, not the name.
 */
export function perplNetwork(key: string = CHAIN_KEY): PerplNetwork {
  const net = perplHere(key) ?? PERPL.monad;
  return process.env.PERPL_API ? { ...net, api: process.env.PERPL_API } : net;
}

type RawMarket = {
  id: number;
  name: string;
  funding_interval_sec?: number;
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
  /** Seconds between funding payments, as the market states it. */
  fundingIntervalSec: number | null;
  /** Funding per hour in percent: positive, longs pay shorts. */
  fundingPctPerHour: number | null;
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
    fundingIntervalSec: typeof m.funding_interval_sec === 'number' && m.funding_interval_sec > 0 ? m.funding_interval_sec : null,
    fundingPctPerHour:
      typeof m.funding?.rate === 'number' && typeof m.funding_interval_sec === 'number' && m.funding_interval_sec > 0
        ? (m.funding.rate / 1e6) * 100 * (3600 / m.funding_interval_sec)
        : null,
    at: typeof m.state?.at?.t === 'number' ? new Date(m.state.at.t).toISOString() : null,
  };
}

export type PerplContext = { network: string; markets: PerplMarket[]; geoBlock: string[] };

export function parseContext(raw: RawContext, network = PERPL.monad.name): PerplContext {
  return { network, markets: (raw.markets ?? []).map(parseMarket), geoBlock: raw.geo_block ?? [] };
}

/** Perpl answers in about 0.1 s and states no limit; 200 ms apart is 5 a second, with 429s backed off as everywhere. */
export const PERPL_GET = { spacingMs: 200 };

/** Perpl's markets as they stand on this build's Perpl, through the shared cached GET. */
export async function perplContext(net: PerplNetwork = perplNetwork()): Promise<PerplContext> {
  return parseContext(await getJson<RawContext>(`${net.api}/v1/pub/context`, 30_000, 15_000, {}, PERPL_GET), net.name);
}
