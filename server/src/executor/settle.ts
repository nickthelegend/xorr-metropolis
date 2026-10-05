/**
 * Which venue settles this leg, and the exact call that does it (2026-09-23, ported from the X Layer build).
 *
 * Split out of `run.ts` because WHERE a trade fills is a separate question from running it, with its own rules — best
 * execution (PLAN.md 3.20):
 *
 *   1. **Every venue that can serve the leg says what it would deliver.** Uniswap v3 is quoted through QuoterV2 against
 *      the pools of the chain the executor settles on, along the best fee tier / path (`venues/uniswap.ts`). 1inch, where
 *      this deployment may ask it (`ONEINCH_ENABLED`: never on Robinhood Chain, elsewhere only with an API key), is asked
 *      for its route too.
 *   2. **The leg settles where the owner receives the most**, measured by each venue's own floor — its answer less the
 *      owner's tolerance — which the contract then enforces against the owner's own balance.
 *
 * On a fork 1inch prices the LIVE chain while the fork's pools stay where they were, so its route is dry-run through the
 * call that will carry the leg (`evm/measure-route.ts`) and held to what it delivers THERE; a route the fork cannot run is
 * simply not a candidate. Uniswap needs no such measurement: it is quoted against the fork's own pools.
 *
 * The Base-era Aqua and SwapVM books are gone (2026-09-23): they existed only on Base, and on Arbitrum or Robinhood Chain
 * there is nothing for them to fill against.
 *
 * A **direct** leg — supplying idle cash to a lending pool — has no swap, and settles against the pool the intent names.
 */
import type { Address } from 'viem';
import type { OutputFloor } from '../evm/delegation.js';
import { deliveredOnChain, PRICES_DRIFT } from '../evm/measure-route.js';
import { slippageFor, SLIPPAGE, TOKENS as VENUE_TOKENS, canonicalSymbol, ensureRegistry, isRoutable } from '../venues/tokens.js';
import { buildSwap, lessPct, quote } from '../venues/uniswap.js';
import type { TradeIntent } from './kinds/index.js';
import { kuruSide, kuruSwap } from '../venues/kuru-fill.js';

/**
 * The venue that settled, as the activity log and `/metrics` name it. `aave` is a direct leg — idle cash supplied to the
 * lending pool, no swap anywhere.
 */
export type SettlementVenue = 'uniswap-v3' | '1inch' | 'aave' | 'kuru';

/**
 * The contract call that will carry the leg, and what it pulls: `closePosition()` pulls the sold token in its own units,
 * `spend()` pulls the settlement token for the dollars.
 */
export type SettlementSend = { via: 'spend' | 'closePosition'; amount: bigint };

export type Settlement = {
  /** The token being spent, from the registry. */
  payToken: { address: Address; decimals: number };
  /** The call `spend()` (or `closePosition()`) forwards. */
  swap: { to: Address; data: `0x${string}` };
  venue: SettlementVenue;
  /** What the owner must receive for the trade to stand — enforced by the contract against the owner's own balance. */
  floor: OutputFloor;
  /** Readable route, for the activity log: "Uniswap v3 USDG→NVDA 0.05%". */
  route?: string;
  /**
   * Where both venues were measured for this leg (Kuru's book and Uniswap): what the one not chosen would have delivered,
   * beside what the chosen one measured, in the output token's units — so a fill can say what routing it was worth.
   */
  compared?: { venue: SettlementVenue; units: number; chosenUnits: number };
};

/** The 1inch module, loaded only where it may be asked — it is not a dependency of settling a trade. */
async function oneinch() {
  const m = await import('../venues/oneinch.js');
  return m.oneinchConfigured() ? m : null;
}

function describe(route: { tokens: string[]; fees: number[] }): string {
  const hops = route.fees.map((f, i) => `${route.tokens[i]}→${route.tokens[i + 1]} ${f / 10_000}%`);
  return `Uniswap v3 ${hops.join(', ')}`;
}

/**
 * @param owner  The user whose capital is being spent — never ours.
 * @param send   The call that will carry the leg and what it pulls.
 */
export async function chooseSettlement(params: {
  intent: TradeIntent;
  owner: Address;
  isClose: boolean;
  delegationFrom: Address;
  send: SettlementSend;
  /** Kept for callers written against the Base build; the subgraph's venue preference is not read (no books remain). */
  preferred?: string;
}): Promise<Settlement> {
  const { intent, owner, delegationFrom, send } = params;
  await ensureRegistry();
  const inSymbol = canonicalSymbol(intent.inSymbol);
  const outSymbol = canonicalSymbol(intent.outSymbol);

  const payToken = VENUE_TOKENS[inSymbol];
  if (!payToken) throw new Error(`No token registry entry for ${intent.inSymbol}`);

  if (intent.direct) {
    return {
      payToken,
      swap: { to: intent.direct.venue, data: intent.direct.data },
      venue: 'aave',
      floor: { tokenOut: intent.direct.tokenOut, minOut: intent.direct.minOut },
    };
  }

  const outToken = VENUE_TOKENS[outSymbol];
  if (!outToken) throw new Error(`No token registry entry for ${intent.outSymbol}`);

  /*
   * The quote first: it is the only number that can tell a thin pair from a deep one before deciding what tolerance the
   * route needs. A failed quote is not fatal — the tolerance falls back to the urgency constant, and building the route
   * quotes again (and refuses, saying why, if there is truly no route).
   */
  const uniswapCan = isRoutable(inSymbol) && isRoutable(outSymbol);
  const quoted = uniswapCan
    ? await quote({ inSymbol, outSymbol, amount: intent.amountIn }).catch(() => null)
    : null;

  /*
   * Urgency sets the floor; the pool sets the rest — except where the person named a tolerance of their own (PLAN.md
   * 3.9): the urgency constants and the impact widening are defaults for trades nobody is watching.
   */
  const tolerancePct =
    intent.slippagePct ?? slippageFor(params.isClose ? SLIPPAGE.stop : SLIPPAGE.scheduled, quoted?.priceImpactPct ?? null);

  // The delegation and the venue must be handed the same figure: on a close, what `closePosition` will send.
  const amountRaw = send.via === 'closePosition' ? send.amount : intent.amountInRaw;

  let uniswapError: unknown;
  const uniswap = uniswapCan
    ? await buildSwap({
        inSymbol,
        outSymbol,
        amount: intent.amountIn,
        amountRaw,
        from: delegationFrom,
        receiver: owner,
        slippagePct: tolerancePct,
      }).catch((e: unknown) => {
        uniswapError = e;
        return null;
      })
    : null;

  /*
   * 1inch, when this deployment may ask it: its route wins only when its floor is higher than Uniswap's, and never on a
   * guess — a route it cannot build (or, on a fork, cannot run) is simply not a candidate.
   */
  const inch = await oneinch();
  if (inch) {
    const route = await inch
      .buildSwap({
        inSymbol,
        outSymbol,
        amount: intent.amountIn,
        amountRaw,
        from: delegationFrom,
        receiver: owner,
        slippagePct: tolerancePct,
      })
      .catch(() => null);
    let floor = route?.minOut;
    if (route && PRICES_DRIFT) {
      const delivered = await deliveredOnChain({
        owner,
        via: send.via,
        token: payToken.address,
        venue: route.to,
        amount: send.amount,
        tokenOut: outToken.address,
        data: route.data,
      }).catch(() => undefined);
      floor = delivered === undefined ? undefined : lessPct(delivered, tolerancePct);
    }
    if (route && floor !== undefined && floor > 0n && (!uniswap || floor > uniswap.minOut)) {
      return {
        payToken,
        swap: { to: route.to, data: route.data },
        venue: '1inch',
        floor: { tokenOut: outToken.address, minOut: floor },
        route: '1inch',
      };
    }
  }

  /*
   * Kuru's order book, where it has one for this leg (MON/USDC on Monad): measured the way 1inch is — the whole leg run
   * through the delegation in a simulation, reading what the owner would receive — and chosen only when its floor is
   * higher than Uniswap's. A grant that does not allow the Kuru venue fails that simulation, so it simply is not a
   * candidate, and the trade goes where it always went.
   */
  const side = kuruSide(inSymbol, outSymbol);
  let kuruMeasured: Settlement['compared'];
  if (side) {
    // Exactly what the delegation approves the venue for and the adapter pulls: `send.amount`.
    const probe = kuruSwap(side, send.amount, owner, 0n);
    const delivered = await deliveredOnChain({
      owner,
      via: send.via,
      token: payToken.address,
      venue: probe.to,
      amount: send.amount,
      tokenOut: outToken.address,
      data: probe.data,
    }).catch(() => undefined);
    if (delivered !== undefined && delivered > 0n) {
      const floor = lessPct(delivered, tolerancePct);
      const units = (raw: bigint) => Number(raw) / 10 ** outToken.decimals;
      if (floor > 0n && (!uniswap || floor > uniswap.minOut)) {
        return {
          payToken,
          swap: kuruSwap(side, send.amount, owner, floor),
          venue: 'kuru',
          floor: { tokenOut: outToken.address, minOut: floor },
          route: `Kuru MON/USDC order book, market ${side}`,
          ...(uniswap ? { compared: { venue: 'uniswap-v3' as const, units: units(uniswap.quotedOut), chosenUnits: units(delivered) } } : {}),
        };
      }
      if (uniswap) kuruMeasured = { venue: 'kuru', units: units(delivered), chosenUnits: units(uniswap.quotedOut) };
    }
  }

  if (!uniswap) {
    if (uniswapError) throw uniswapError;
    throw new Error(`No route for ${inSymbol} -> ${outSymbol}: no Uniswap v3 pool reaches it and no other venue is enabled here`);
  }
  return {
    payToken,
    swap: { to: uniswap.to, data: uniswap.data },
    venue: 'uniswap-v3',
    floor: { tokenOut: outToken.address, minOut: uniswap.minOut },
    route: describe(uniswap.route),
    ...(kuruMeasured ? { compared: kuruMeasured } : {}),
  };
}
