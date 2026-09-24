/**
 * What the council reads before it votes on Monad (FEATURES-100 #8, 2026-09-24).
 *
 * The seats and the rule that decides a round are the same as on Robinhood Chain (`personas.ts`); what they read is
 * Monad's own. No stock, session or GMX input exists here, so none is read or faked:
 *
 *   price      Chainlink on Monad mainnet (the price and its age) against the price the fill would actually get — the
 *              executor's own Uniswap v3 quote on this chain, or on Monad testnet Perpl's book, where agents trade — and,
 *              for MON, the top of Kuru's MON/USDC order book. The gap between the fill and Chainlink is what can veto.
 *   trend      The asset's own Chainlink rounds on Monad mainnet, sampled back over the last 512 rounds.
 *   perps      Perpl's BTC, ETH and MON perpetuals: who pays funding, per hour, and the mark.
 *   permission The owner's grant on XorrDelegation (the same contract on every chain). On Monad testnet the agent trades the
 *              owner's Perpl desk instead, so there it is the desk's own limits: the daily cap and what is left of it,
 *              and "revoked" when the owner has removed xorr's operator on chain. A desk has no end date.
 *   holding    What the owner already holds of the asset, from the executor's own balance read (testnet: the desk's
 *              long, at Perpl's mark).
 *
 * Each input carries its source and is stored with the round; one that could not be read is stored as its error.
 */
import type { Address, PublicClient } from 'viem';
import { CHAIN_KEY } from '../evm/chains.js';
import { holdings } from '../evm/balances.js';
import { getJson } from '../http/get.js';
import { quote } from '../venues/uniswap.js';
import { canonicalSymbol, ensureRegistry } from '../venues/tokens.js';
import { CHAINLINK_MONAD, feedFor, readFeed } from '../monad/chainlink.js';
import { readBook } from '../monad/kuru.js';
import { monadMainnet } from '../monad/mainnet.js';
import { PERPL, marketFromContext, perplHere, type PerpMarket } from '../monad/perpl-chain.js';
import { deskState } from '../monad/perpl-desk.js';
import { POSITION_SHARE_OF_GRANT } from './personas.js';
import type { HoldingInput, PermissionInput, Proposal, TrendInput } from './inputs.js';
import { permissionOf } from './inputs.js';

type Read<T> = ({ ok: true } & T) | { ok: false; error: string };

/** The assets a Monad council can be asked about: each has a Chainlink feed on Monad and a Perpl market. */
export const MONAD_COUNCIL_SYMBOLS = ['MON', 'ETH', 'BTC'] as const;
/** The token a spot fill on Monad moves for each: the delegation swaps wrapped tokens, never native MON. */
const SPOT_TOKEN: Record<(typeof MONAD_COUNCIL_SYMBOLS)[number], string> = { MON: 'WMON', ETH: 'WETH', BTC: 'WBTC' };
/**
 * The registry token a Monad spot fill moves for a council symbol. `ETH` in Monad's registry is the NATIVE-MON sentinel
 * (`venues/tokens.ts`), so a round about ETH must never reach the trade path as "ETH".
 */
export function spotToken(symbol: string): string {
  return SPOT_TOKEN[assertMonadSymbol(symbol)];
}
/** The widest gap allowed between the fill's price and Chainlink, fee included (the Stock Token guard's 150 bps). */
export const MAX_FILL_GAP_BPS = Number(process.env.MONAD_COUNCIL_MAX_GAP_BPS ?? 150);
/** Chainlink's heartbeat for these feeds is an hour (Chainlink's Monad feed list); older is stale. */
export const FEED_MAX_AGE_SEC = 3600;

export type PriceInput = Read<{
  source: string;
  chainlink: { price: number; ageSec: number; feed: string; updatedAt: string; maxAgeSec: number };
  fill: { price: number; venue: string };
  kuru: { mid: number; spreadBps: number | null } | null;
  gapBps: number;
  maxGapBps: number;
}>;
export type PerpsSide = { market: string; mark: number | null; fundingPctPerHour: number; openInterest: number | null };
export type PerpsInput = Read<{ source: string; markets: PerpsSide[] }>;

export type MonadCouncilInputs = {
  venue: 'monad';
  readAt: string;
  proposal: Proposal;
  price: PriceInput;
  trend: TrendInput;
  perps: PerpsInput;
  permission: PermissionInput;
  holding: HoldingInput;
};

const errorOf = (e: unknown) => (e instanceof Error ? e.message.split('\n')[0]! : String(e)).slice(0, 300);

async function read<T>(f: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, ...(await f()) };
  } catch (e) {
    return { ok: false, error: errorOf(e) };
  }
}

export function assertMonadSymbol(symbol: string): (typeof MONAD_COUNCIL_SYMBOLS)[number] {
  const s = symbol.toUpperCase().replace(/^W(?=MON|ETH|BTC)/, '');
  if (!(MONAD_COUNCIL_SYMBOLS as readonly string[]).includes(s)) {
    throw new Error(`The council on Monad votes on ${MONAD_COUNCIL_SYMBOLS.join(', ')}; ${symbol} is not one of them.`);
  }
  return s as (typeof MONAD_COUNCIL_SYMBOLS)[number];
}

/** The Perpl deployment whose markets the council reads: this chain's, or mainnet's on a fork (a copy of mainnet). */
const perplNet = () => perplHere() ?? PERPL.monad;

export async function perplMarketsNow(): Promise<PerpMarket[]> {
  const ctx = await getJson<{ markets: Parameters<typeof marketFromContext>[0][] }>(`${perplNet().api}/v1/pub/context`);
  return ctx.markets.map(marketFromContext).filter((m) => m.open);
}

/** Funding per hour, in percent: Perpl states a rate per funding interval (43 min on 2026-09-24). */
export function fundingPctPerHour(m: Pick<PerpMarket, 'fundingPerInterval' | 'fundingIntervalSec'>): number | null {
  if (m.fundingPerInterval === null || !m.fundingIntervalSec) return null;
  return m.fundingPerInterval * 100 * (3600 / m.fundingIntervalSec);
}

/** What the fill would pay (or get) per unit, from the venue the executor would send it to on this chain. */
async function fillPrice(symbol: (typeof MONAD_COUNCIL_SYMBOLS)[number], proposal: Proposal, chainlink: number): Promise<{ price: number; venue: string }> {
  if (CHAIN_KEY === 'monad-testnet') {
    // No spot venue on Monad testnet: agents trade Perpl's book, so its top of book is the fill.
    const m = (await perplMarketsNow()).find((x) => x.name === symbol);
    if (!m) throw new Error(`${perplNet().name} has no open ${symbol} market`);
    const p = proposal.side === 'buy' ? m.ask : m.bid;
    if (!(p && p > 0)) throw new Error(`${perplNet().name} ${symbol} has no ${proposal.side === 'buy' ? 'ask' : 'bid'}`);
    return { price: p, venue: `${perplNet().name} ${symbol} ${proposal.side === 'buy' ? 'ask' : 'bid'}` };
  }
  await ensureRegistry();
  const token = canonicalSymbol(SPOT_TOKEN[symbol]);
  if (proposal.side === 'buy') {
    const q = await quote({ inSymbol: 'USDC', outSymbol: token, amount: proposal.usd, skipPriceImpact: true });
    if (!(q.outAmount > 0)) throw new Error(`Uniswap v3 quoted no ${token} for $${proposal.usd}`);
    return { price: proposal.usd / q.outAmount, venue: `Uniswap v3 USDC→${token} on ${CHAIN_KEY}, $${proposal.usd} quoted` };
  }
  const units = proposal.usd / chainlink;
  const q = await quote({ inSymbol: token, outSymbol: 'USDC', amount: units, skipPriceImpact: true });
  if (!(q.outAmount > 0)) throw new Error(`Uniswap v3 quoted no USDC for ${units} ${token}`);
  return { price: q.outAmount / units, venue: `Uniswap v3 ${token}→USDC on ${CHAIN_KEY}, ${units.toPrecision(4)} ${token} quoted` };
}

async function priceOf(symbol: (typeof MONAD_COUNCIL_SYMBOLS)[number], proposal: Proposal, client: PublicClient) {
  const feedSymbol = feedFor(symbol);
  if (!feedSymbol) throw new Error(`no Chainlink feed for ${symbol} on Monad`);
  const feed = await readFeed(feedSymbol, { client, maxAgeSec: FEED_MAX_AGE_SEC });
  const [fill, kuru] = await Promise.all([
    fillPrice(symbol, proposal, feed.price),
    symbol === 'MON' ? readBook('MON/USDC', client).then((b) => (b.mid !== null ? { mid: b.mid, spreadBps: b.spreadBps } : null), () => null) : Promise.resolve(null),
  ]);
  const gapBps = (Math.abs(fill.price - feed.price) / feed.price) * 10_000;
  return {
    source: `Chainlink ${feedSymbol}/USD ${feed.feed} on Monad mainnet; the fill from ${fill.venue}${kuru ? '; Kuru MON/USDC book' : ''}`,
    chainlink: { price: feed.price, ageSec: feed.ageSec, feed: feed.feed, updatedAt: feed.updatedAt, maxAgeSec: FEED_MAX_AGE_SEC },
    fill,
    kuru,
    gapBps,
    maxGapBps: MAX_FILL_GAP_BPS,
  };
}

/** The council symbol a spot token prices as: WMON/MON → MON, WETH → ETH, WBTC → BTC; anything else has no gate. */
const GATED: Record<string, (typeof MONAD_COUNCIL_SYMBOLS)[number]> = { MON: 'MON', WMON: 'MON', WETH: 'ETH', WBTC: 'BTC' };

/**
 * The council's price check, for an order placed by hand (PLAN P2.2).
 *
 * Only the council's price desk compared the fill with Chainlink; a buy from the order ticket went straight to the venue,
 * so the same trade was vetoed when an agent proposed it and filled when a person pressed Buy. Same inputs, same limit
 * (`MAX_FILL_GAP_BPS`), same staleness rule. A price that cannot be checked is not a price that passed: the order is
 * refused with the reason, as a missing permission is. `null` for a token with no Chainlink feed to check against.
 */
export async function manualPriceGate(
  spotSymbol: string,
  usd: number,
  client: PublicClient = monadMainnet(),
): Promise<{ ok: true; gapBps: number } | { ok: false; detail: string } | null> {
  const symbol = GATED[spotSymbol.toUpperCase()];
  if (!symbol) return null;
  let p: Awaited<ReturnType<typeof priceOf>>;
  try {
    p = await priceOf(symbol, { side: 'buy', symbol, usd }, client);
  } catch (e) {
    const why = e instanceof Error ? e.message.split('\n')[0] : String(e);
    return { ok: false, detail: `The price could not be checked against Chainlink (${why}), so nothing was placed.` };
  }
  // Cents from $1 up; four significant digits below ($0.02401, not $2.401e-2; $87,450.81, not $8.745e+4).
  const fmt = (n: number) =>
    n >= 1
      ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
      : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumSignificantDigits: 4, maximumSignificantDigits: 4 });
  if (p.chainlink.ageSec > p.chainlink.maxAgeSec) {
    return {
      ok: false,
      detail: `Chainlink's ${symbol}/USD round is ${Math.round(p.chainlink.ageSec / 60)} min old, past its ${p.chainlink.maxAgeSec / 60}-minute heartbeat, so the fill cannot be checked. Nothing was placed.`,
    };
  }
  if (p.gapBps > p.maxGapBps) {
    const kuru = p.kuru ? `; Kuru's mid is ${fmt(p.kuru.mid)}` : '';
    return {
      ok: false,
      detail: `The fill (${fmt(p.fill.price)}, ${p.fill.venue}) is ${p.gapBps.toFixed(0)} bps from Chainlink (${fmt(p.chainlink.price)}), past the ${p.maxGapBps} bps limit${kuru}. Nothing was placed.`,
    };
  }
  return { ok: true, gapBps: p.gapBps };
}

/** Round ids behind the latest the trend samples: a proxy's id packs the phase in its top bits, so `id - k` stays in it. */
// MON/USD answers a round every few minutes (32 rounds were under an hour on 2026-09-24), so the samples reach 512 back.
const TREND_STEPS = [512n, 256n, 128n, 64n, 32n, 8n, 1n];

export async function monadTrend(symbol: string, client: PublicClient = monadMainnet()) {
  const feedSymbol = feedFor(symbol);
  if (!feedSymbol) throw new Error(`no Chainlink feed for ${symbol} on Monad`);
  const address = CHAINLINK_MONAD[feedSymbol];
  const round = [
    { name: 'roundId', type: 'uint80' },
    { name: 'answer', type: 'int256' },
    { name: 'startedAt', type: 'uint256' },
    { name: 'updatedAt', type: 'uint256' },
    { name: 'answeredInRound', type: 'uint80' },
  ] as const;
  const abi = [
    { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
    { type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: round },
    { type: 'function', name: 'getRoundData', stateMutability: 'view', inputs: [{ name: '_roundId', type: 'uint80' }], outputs: round },
  ] as const;
  const [decimals, latest] = await Promise.all([
    client.readContract({ address, abi, functionName: 'decimals' }),
    client.readContract({ address, abi, functionName: 'latestRoundData' }),
  ]);
  const [latestId, latestAnswer, , latestAt] = latest;
  const phaseFloor = (latestId >> 64n) << 64n;
  const earlier = await Promise.all(
    TREND_STEPS.filter((k) => latestId - k > phaseFloor).map((k) =>
      client.readContract({ address, abi, functionName: 'getRoundData', args: [latestId - k] }).then(
        ([, answer, , at]) => (answer > 0n && at > 0n ? { price: Number(answer) / 10 ** decimals, at: new Date(Number(at) * 1000).toISOString() } : null),
        () => null,
      ),
    ),
  );
  const rounds = [...earlier.filter((r): r is { price: number; at: string } => r !== null), { price: Number(latestAnswer) / 10 ** decimals, at: new Date(Number(latestAt) * 1000).toISOString() }];
  const first = rounds[0]!;
  const last = rounds[rounds.length - 1]!;
  return {
    source: `Chainlink ${feedSymbol}/USD ${address} on Monad mainnet, ${rounds.length} rounds`,
    rounds,
    changePct: ((last.price - first.price) / first.price) * 100,
    spanHours: (Date.parse(last.at) - Date.parse(first.at)) / 3_600_000,
  };
}

async function perpsNow() {
  const markets = await perplMarketsNow();
  const sides: PerpsSide[] = [];
  for (const name of MONAD_COUNCIL_SYMBOLS) {
    const m = markets.find((x) => x.name === name);
    if (!m) throw new Error(`${perplNet().name} has no open ${name} market`);
    const f = fundingPctPerHour(m);
    if (f === null) throw new Error(`${perplNet().name} ${name} states no funding rate or interval`);
    sides.push({ market: name, mark: m.mark, fundingPctPerHour: f, openInterest: m.openInterest });
  }
  return { source: `${perplNet().name} ${perplNet().api}/v1/pub/context`, markets: sides };
}

/** Monad testnet: the desk's limits in the permission's shape. The position limit is one day's cap. */
async function deskPermission(owner: Address) {
  const d = await deskState(owner);
  if (!d.desk) throw new Error('no Perpl desk for this owner yet');
  return {
    source: `Perpl desk ${d.desk} on ${CHAIN_KEY}: the owner's caps, and isOperator for xorr's key read now`,
    dailyCapUsd: d.caps.maxDayUsd,
    remainingTodayUsd: Math.max(0, d.caps.maxDayUsd - d.caps.usedTodayUsd),
    // A desk does not expire; a year out keeps the expiry check honest without inventing a date the owner chose.
    expiresAt: Math.floor(Date.now() / 1000) + 365 * 86_400,
    revoked: !d.operatorActive,
    grantUsd: d.caps.maxDayUsd / POSITION_SHARE_OF_GRANT,
  };
}

async function deskHolding(owner: Address, symbol: string) {
  const d = await deskState(owner);
  const pos = d.positions.find((p) => p.market === symbol && p.long);
  return { source: `Perpl desk ${d.desk ?? 'none'} positions on ${CHAIN_KEY}`, shares: pos?.lots ?? 0, valueUsd: pos ? pos.lots * (pos.mark ?? pos.entry) : 0 };
}

async function holdingNow(owner: Address, symbol: (typeof MONAD_COUNCIL_SYMBOLS)[number]) {
  if (CHAIN_KEY === 'monad-testnet') return deskHolding(owner, symbol);
  await ensureRegistry();
  const token = canonicalSymbol(SPOT_TOKEN[symbol]);
  const held = (await holdings(owner)).find((h) => h.symbol === token);
  return { source: `${token} balanceOf on ${CHAIN_KEY} (evm/balances.ts)`, shares: held?.units ?? 0, valueUsd: held?.usd ?? 0 };
}

export async function readMonadCouncilInputs(owner: Address, proposal: Proposal, agentId?: string, client: PublicClient = monadMainnet()): Promise<MonadCouncilInputs> {
  const symbol = assertMonadSymbol(proposal.symbol);
  const [price, trend, perps, permission, holding] = await Promise.all([
    read(() => priceOf(symbol, proposal, client)),
    read(() => monadTrend(symbol, client)),
    read(() => perpsNow()),
    read(() => (CHAIN_KEY === 'monad-testnet' ? deskPermission(owner) : permissionOf(owner, agentId))),
    read(() => holdingNow(owner, symbol)),
  ]);
  return { venue: 'monad', readAt: new Date().toISOString(), proposal: { ...proposal, symbol }, price, trend, perps, permission, holding };
}
