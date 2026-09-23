/**
 * GET /market/xstocks — the tokenized-equity catalog, browsable.
 *
 * The app could trade an xStock by name and could not show you what there was to trade. `XSTOCKS`
 * has been the executor's private list since the Solana work landed: eleven mints, reachable only if
 * you already knew the symbol to type. This publishes it, with the sector of each underlying listing
 * and both prices that exist for it — see `venues/xstocks-catalog.ts` for why there are two.
 *
 * Public, for the same reason the rest of `/market/*` is: a catalog of what is listed and what it
 * costs is not user data, and gating it means a signed-out visitor sees a list of dashes.
 *
 * A row with no price is a row, not an omission. `feed: 'unavailable'` and `price: null` is the
 * honest answer on a cluster where these mints do not exist, and dropping those rows would hide
 * exactly the fact that matters — that the app cannot trade them here.
 */
import { Hono, type Context } from 'hono';
import { log } from '../http/request-id.js';
import { requireUser } from '../auth/middleware.js';
import { xStockCatalog, xStockSectors, type XStockCatalogRow } from '../venues/xstocks-catalog.js';
import { xStockQuote, DEFAULT_SLIPPAGE_BPS } from '../venues/xstocks-quote.js';
import { UnpricedError } from '../venues/jupiter.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireWallet } from './wallet-context.js';
import { guardAndSpend } from '../executor/place.js';
import { applyFill } from '../positions/index.js';
import { tx } from '../db/index.js';
import { append } from '../audit/log.js';
import { notifyEntry } from '../notifications/alerts.js';
import { ON_SOLANA } from '../solana/clusters.js';
import { explorerTx } from '../solana/connection.js';
import { SellRefused, prepareUserSell, verifyUserSell } from '../solana/userSell.js';
import { IS_ARBITRUM, IS_MONAD, IS_ROBINHOOD, CHAIN_KEY, explorerTx as evmExplorerTx } from '../evm/chains.js';
import { rhCatalog, rhStockQuote } from '../venues/rh-xstocks.js';
import { placeOrder } from '../executor/order.js';
import { closeHolding } from './panic.js';
import { chainUnitsOf } from '../evm/balances.js';
import { canonicalSymbol, ensureRegistry, TOKENS } from '../venues/tokens.js';
import { multiplierOf } from '../venues/rh-stocks.js';
import type { Address } from 'viem';

export const xstockRoutes = new Hono();

export type XStockCatalogResponse = {
  rows: XStockCatalogRow[];
  /** The sectors present, in the order the filter offers them. */
  sectors: string[];
  /** How many rows nothing would price. The screen says this out loud rather than making it countable. */
  unpriced: number;
};

xstockRoutes.get('/market/xstocks', async (c) => {
  /*
   * Robinhood Chain: the live Robinhood catalog, narrowed to the Stock Tokens that trade on this node (2026-09-23).
   * Arbitrum One lists no stocks this build trades, and answering with the Solana xStocks there would offer tokens that
   * do not exist on the chain — so it answers an empty catalog that says why.
   */
  if (IS_ROBINHOOD) return c.json(await rhCatalog());
  if (IS_ARBITRUM) {
    return c.json({ rows: [], sectors: [], unpriced: 0, chain: CHAIN_KEY, note: 'Stock Tokens trade on Robinhood Chain, not on Arbitrum One.' });
  }
  // Monad lists no tokenized equity (checked against Monad's token list, 2026-09-24): xorr trades MON, ETH and BTC here.
  if (IS_MONAD) {
    return c.json({ rows: [], sectors: [], unpriced: 0, chain: CHAIN_KEY, note: 'Monad lists no tokenized stock; xorr trades MON, ETH and BTC here.' });
  }
  const rows = await xStockCatalog();
  const unpriced = rows.filter((r) => r.feed !== 'live').length;

  /*
   * Worth a line in the log when nothing priced.
   *
   * All eleven unavailable means the price endpoint is unreachable or this deployment's mints are
   * not the ones it knows — two different faults, both of which look from the app like a quiet
   * catalog. Silence here is how the first one gets diagnosed as the second.
   */
  if (unpriced === rows.length && rows.length > 0) {
    log.warn(`[xstocks] catalog priced none of ${rows.length} mints`);
  }

  const body: XStockCatalogResponse = { rows, sectors: xStockSectors(), unpriced };
  return c.json(body);
});

/**
 * GET /market/xstocks/quote — what this order costs, before it is placed.
 *
 * Behind a session, unlike the catalog beside it: a catalogue entry is a public fact about a listed
 * asset, and this is a quote for one person's order at one size. It also costs an upstream request
 * per call, which is not something to leave open.
 *
 * A pair nothing will price is a 502 naming the pair, not a breakdown of zeroes — zeroes on this
 * screen read as a free trade.
 */
xstockRoutes.get('/market/xstocks/quote', async (c) => {
  requireUser(c);

  const symbol = c.req.query('symbol') ?? '';
  const sideParam = c.req.query('side') ?? 'buy';
  const usd = Number(c.req.query('usd'));

  if (sideParam !== 'buy' && sideParam !== 'sell') {
    return c.json({ error: 'invalid_side', detail: 'side is buy or sell.' }, 400);
  }
  if (!(Number.isFinite(usd) && usd > 0)) {
    return c.json({ error: 'invalid_amount', detail: 'usd is the size of the order, above zero.' }, 400);
  }

  /*
   * The tolerance, bounded where `/swap/quote` bounds its own.
   *
   * Out of range is refused rather than clamped: a ticket that asked for 0.1% and was quoted at 3%
   * would show a floor nobody agreed to, and the person reading it has no way to tell.
   */
  const asked = c.req.query('slippageBps');
  const slippageBps = asked === undefined ? DEFAULT_SLIPPAGE_BPS : Number(asked);
  if (!(Number.isInteger(slippageBps) && slippageBps >= 5 && slippageBps <= 300)) {
    return c.json(
      { error: 'invalid_slippage', detail: 'slippageBps is a whole number between 5 and 300.' },
      400,
    );
  }

  try {
    if (IS_ROBINHOOD) return c.json(await rhStockQuote({ symbol, side: sideParam, usd, slippageBps }));
    return c.json(await xStockQuote({ symbol, side: sideParam, usd, slippageBps }));
  } catch (e) {
    /*
     * No quote is a real answer and the ticket renders it as one. It is distinguished from a fault
     * so the screen can say "nobody would price this right now" instead of offering a retry for
     * something retrying will not fix.
     */
    if (e instanceof UnpricedError) {
      return c.json({ error: 'no_quote', detail: e.message }, 502);
    }
    throw e;
  }
});


/**
 * Buy an xStock from the phone (2026-09-19).
 *
 * The one path that can spend is `guardAndSpend`: the owner's recorded permission (cap, end date, not revoked), the
 * rules engine, the on-chain delegation, the issuer's transfer gates, a live quote — and only then the delegate moves
 * the owner's USDC and Jupiter routes it. This route adds nothing that can spend; it is the door to that path the phone
 * never had, so an xStock could be bought only by the agent. What it adds is what a fill needs afterwards, exactly as the
 * agent's own fills get it: the position booked (attributed to the person), the trail, and the notification.
 *
 * Idempotent by the request's `Idempotency-Key`: `guardAndSpend` marks the key before its first broadcast, so a retry
 * after a lost answer replays this one instead of buying again.
 */
const BuyInput = z.object({ symbol: z.string().min(1).max(20), usd: z.number().positive().max(100_000) }).strict();

xstockRoutes.post('/xstocks/buy', async (c) => {
  if (IS_ROBINHOOD) return robinhoodBuy(c);
  if (!ON_SOLANA) return c.json({ error: 'not_solana', message: 'xStocks are bought on a Solana executor.' }, 400);
  const body = BuyInput.parse(await c.req.json());
  const w = await requireWallet(c);
  const outcome = await guardAndSpend({ walletId: w.id, ownerPubkey: w.address, symbol: body.symbol, usd: body.usd, side: 'buy' });
  if (!outcome.placed) {
    return c.json({ status: 'blocked', reason: outcome.reason, message: outcome.detail }, 409);
  }

  // Booked, so Holdings and P&L know about it. Not fatal: the money has moved, and a bookkeeping failure is logged.
  const orderId = randomUUID();
  await tx((client) =>
    applyFill(client, {
      walletId: w.id,
      symbol: outcome.symbol,
      units: outcome.filledUnits,
      usd: outcome.usd,
      attribution: { source: 'manual', id: orderId, label: 'You' },
    }),
  ).catch((e) => log.error('[xstocks/buy] failed to book the fill:', e));

  const venue = outcome.venue === 'jupiter-route' ? 'Jupiter' : 'the venue vault';
  await append({
    walletId: w.id,
    agent: 'You',
    action: `Bought ${outcome.symbol}`,
    detail: `${outcome.filledUnits.toFixed(6)} ${outcome.symbol} at $${outcome.fillPrice.toFixed(2)} through ${venue}.`,
    amount: `$${outcome.usd.toFixed(2)}`,
    kind: 'trade',
    signature: outcome.signature,
    payload: { orderId, venue: outcome.venue, slot: outcome.slot },
  }).catch((e) => log.error('[xstocks/buy] failed to write the audit row:', e));

  await notifyEntry({
    walletId: w.id,
    symbol: outcome.symbol,
    strategyKind: 'manual',
    notionalUsd: outcome.usd,
    units: outcome.filledUnits,
    price: outcome.fillPrice,
    signature: outcome.signature,
    agentName: 'You',
  }).catch((e) => log.error('[xstocks/buy] failed to notify:', e));

  return c.json({
    status: 'filled',
    orderId,
    symbol: outcome.symbol,
    usd: outcome.usd,
    units: outcome.filledUnits,
    price: outcome.fillPrice,
    venue: outcome.venue,
    signature: outcome.signature,
    slot: outcome.slot,
    explorer: explorerTx(outcome.signature),
  });
});

const SellPrepareInput = z.object({ symbol: z.string().min(1).max(16), units: z.number().positive() });
const SellRecordInput = z.object({ symbol: z.string().min(1).max(16), signature: z.string().min(64).max(100) });

/**
 * POST /xstocks/sell/prepare — the sale the owner will sign (2026-09-19): their shares into the venue vault and the
 * vault's USDC to them, in one transaction at a live Jupiter quote, with the vault's leg already signed. Nothing moves
 * until the owner signs and broadcasts it.
 */
xstockRoutes.post('/xstocks/sell/prepare', async (c) => {
  if (IS_ROBINHOOD) return executorSells(c);
  if (!ON_SOLANA) return c.json({ error: 'not_solana', message: 'xStocks are sold on a Solana executor.' }, 400);
  const body = SellPrepareInput.parse(await c.req.json());
  const w = await requireWallet(c);
  try {
    return c.json(await prepareUserSell({ owner: w.address, symbol: body.symbol, units: body.units }));
  } catch (e) {
    if (e instanceof SellRefused) return c.json({ status: 'blocked', reason: e.reason, message: e.message }, 409);
    throw e;
  }
});

/**
 * POST /xstocks/sell/record — a sale the owner signed and broadcast, read back from the chain before it is booked:
 * the disposal in the position ledger, the audit row, the notification. Recording the same signature twice is a no-op.
 */
xstockRoutes.post('/xstocks/sell/record', async (c) => {
  if (IS_ROBINHOOD) return executorSells(c);
  if (!ON_SOLANA) return c.json({ error: 'not_solana', message: 'xStocks are sold on a Solana executor.' }, 400);
  const body = SellRecordInput.parse(await c.req.json());
  const w = await requireWallet(c);
  let sold: Awaited<ReturnType<typeof verifyUserSell>>;
  try {
    sold = await verifyUserSell({ owner: w.address, signature: body.signature, symbol: body.symbol });
  } catch (e) {
    if (e instanceof SellRefused) return c.json({ status: 'blocked', reason: e.reason, message: e.message }, 409);
    throw e;
  }
  const orderId = randomUUID();
  const duplicate = await tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [w.id]);
    const seen = await client.query('SELECT 1 FROM audit_log WHERE wallet_id = $1 AND signature = $2 LIMIT 1', [w.id, body.signature]);
    if ((seen.rowCount ?? 0) > 0) return true;
    await applyFill(client, {
      walletId: w.id,
      symbol: sold.symbol,
      units: -sold.units,
      usd: sold.usd,
      attribution: { source: 'manual', id: orderId, label: 'You' },
    });
    await append(
      {
        walletId: w.id,
        agent: 'You',
        action: `Sold ${sold.symbol}`,
        detail: `${sold.units.toFixed(6)} ${sold.symbol} at $${sold.price.toFixed(2)} against the venue vault, at Jupiter's live quote. You signed it.`,
        amount: `$${sold.usd.toFixed(2)}`,
        kind: 'trade',
        signature: body.signature,
        payload: { orderId, venue: 'venue-vault', slot: sold.slot, side: 'sell' },
      },
      client,
    );
    return false;
  });
  return c.json({
    status: 'filled',
    duplicate,
    orderId,
    symbol: sold.symbol,
    units: sold.units,
    usd: sold.usd,
    price: sold.price,
    venue: 'venue-vault',
    signature: body.signature,
    slot: sold.slot,
    explorer: explorerTx(body.signature),
  });
});

// ── Robinhood Chain (2026-09-23) ─────────────────────────────────────────────────────────────────

type Ctx = Context;

/**
 * POST /xstocks/buy on Robinhood Chain: a one-off order through the executor's own run path (`placeOrder` →
 * `runStrategy`), the one every agent's buy takes — the recorded and on-chain permission, the Stock Token gates
 * (`executor/stock-guard.ts`: session, halt, feed, deviation), Uniswap v3 through `XorrDelegation.spend()`, the Stock
 * Token delivered to the OWNER's wallet, the fill measured on chain, booked, audited and notified by the run itself.
 *
 * The answer is the `XStockBuyOutcome` the app reads, with `venue: 'uniswap-v3'` and the ERC-8056 `shares` added.
 */
async function robinhoodBuy(c: Ctx) {
  const body = BuyInput.parse(await c.req.json());
  const w = await requireWallet(c);
  const order = await placeOrder(w, body.symbol, body.usd, `Buy $${body.usd} of ${canonicalSymbol(body.symbol)}`);
  if (!order.placed) return c.json({ status: 'blocked', reason: order.refusal.reason, message: order.refusal.detail }, 409);
  const o = order.outcome;
  if (o.status === 'blocked') return c.json({ status: 'blocked', reason: o.reason, message: o.detail }, 409);
  if (o.status === 'failed') return c.json({ status: 'failed', reason: 'fill_failed', message: o.error }, 502);
  if (o.status !== 'filled') return c.json({ status: 'blocked', reason: o.status, message: 'The order did not run.' }, 409);
  const symbol = canonicalSymbol(body.symbol);
  const multiplier = await multiplierOf(symbol);
  return c.json({
    status: 'filled',
    orderId: order.orderId,
    symbol,
    usd: body.usd,
    units: o.units,
    price: o.price,
    venue: 'uniswap-v3',
    signature: o.signature,
    slot: 0,
    explorer: evmExplorerTx(o.signature),
    chain: CHAIN_KEY,
    ...(multiplier !== null ? { multiplier, shares: o.units * multiplier } : {}),
  });
}

const SellInput = z
  .object({
    symbol: z.string().min(1).max(20),
    /** Tokens to sell (as `units` reads everywhere else); or `fraction` of the holding. One of the two. */
    units: z.number().positive().optional(),
    fraction: z.number().gt(0).max(1).optional(),
  })
  .strict();

/**
 * POST /xstocks/sell on Robinhood Chain: the owner's Stock Token sold back to USDG through the permission —
 * `XorrDelegation.closePosition()` (uncapped: de-risking is not spending), after the same Stock Token gates a buy passes.
 * The proceeds land in the owner's wallet; the sale is booked and audited by `closeHolding`, as `/positions/close` is.
 */
xstockRoutes.post('/xstocks/sell', async (c) => {
  if (!IS_ROBINHOOD) {
    return c.json({ error: 'not_robinhood', message: 'This sale path is for Robinhood Chain; on Solana use /xstocks/sell/prepare.' }, 400);
  }
  const body = SellInput.parse(await c.req.json());
  const w = await requireWallet(c);
  await ensureRegistry();
  const symbol = canonicalSymbol(body.symbol);
  if (TOKENS[symbol]?.kind !== 'stock') {
    return c.json({ status: 'blocked', reason: 'not_tradable', message: `${body.symbol} is not a Stock Token that trades on ${CHAIN_KEY}.` }, 409);
  }
  let fraction = body.fraction ?? 1;
  if (body.units !== undefined) {
    const held = (await chainUnitsOf(w.address as Address, [symbol])).get(symbol) ?? 0;
    if (!(held > 0)) return c.json({ status: 'blocked', reason: 'not_held', message: `No ${symbol} to sell.` }, 409);
    fraction = Math.min(1, body.units / held);
  }
  const out = await closeHolding({ wallet: w, symbol, fraction, actor: 'You' });
  const b = out.body as Record<string, unknown>;
  if (out.status !== 200) {
    return c.json({ status: 'blocked', reason: b.reason ?? b.status ?? 'failed', message: b.detail ?? b.error ?? 'The sale did not go through.' }, out.status as 409 | 502);
  }
  const units = Number(b.units);
  const usd = Number(b.usd);
  const multiplier = await multiplierOf(symbol);
  return c.json({
    status: 'filled',
    duplicate: false,
    orderId: randomUUID(),
    symbol,
    units,
    usd,
    price: units > 0 ? usd / units : 0,
    venue: b.venue ?? 'uniswap-v3',
    signature: b.txHash,
    slot: 0,
    explorer: b.explorer,
    chain: CHAIN_KEY,
    ...(multiplier !== null ? { multiplier, shares: units * multiplier } : {}),
  });
});

/** The Solana owner-signed sale flow does not exist on Robinhood Chain: the executor sells through the permission. */
function executorSells(c: Ctx) {
  return c.json(
    {
      status: 'blocked',
      reason: 'sold_through_permission',
      message: 'On Robinhood Chain a sale goes through your permission, not a transaction you sign: POST /xstocks/sell { symbol, units }.',
    },
    409,
  );
}
