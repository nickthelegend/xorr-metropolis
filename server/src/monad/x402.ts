/**
 * Agents pay to ask xorr's council (2026-10-07; MONAD-TECH item 7): x402 through Monad's facilitator.
 *
 * xorr's council is a market read other agents would pay for: Chainlink on Monad against the fill's quote and Kuru's
 * book, the trend, and who pays funding on Perpl, each desk's vote on the trade put to it. `POST /x402/council` sells
 * that read for $0.01 of USDC per call, by HTTP 402: no account, no key — the caller signs an EIP-3009 authorization,
 * Monad's facilitator verifies it, the read is served, and the facilitator settles it on chain (it pays the gas).
 *
 * The protocol is x402 v2 through the official packages (`@x402/hono`, `@x402/core`, `@x402/evm`), as Monad's guide
 * sets it up. The network is Monad testnet by default (`X402_NETWORK`, `eip155:10143`, Circle's testnet USDC, whose
 * EIP-712 domain the guide gives); settling a real payment is a testnet transaction by the payer's USDC, so it waits for
 * the testnet go. Until then the 402 and the facilitator's verdict on a signed payment are real: an unfunded payer is
 * refused by Monad's facilitator, not by this code.
 *
 * Only the market desks sit — the price desk, the trend reader and the perps desk. The risk keeper reads an owner's
 * permission and holdings, and a paying agent is not an owner here.
 */
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { HTTPFacilitatorClient, type FacilitatorClient } from '@x402/core/server';
import { paymentMiddleware, x402ResourceServer } from '@x402/hono';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import type { Address } from 'viem';
import { delegateAccount } from '../evm/client.js';
import { readMonadMarketInputs, MONAD_COUNCIL_SYMBOLS } from '../council/monad-inputs.js';
import { perpsDesk, priceDesk, trendReader } from '../council/personas.js';
import type { MonadCouncilInputs } from '../council/monad-inputs.js';

export const X402_NETWORK = (process.env.X402_NETWORK ?? 'eip155:10143') as `eip155:${string}`;
export const X402_FACILITATOR = process.env.X402_FACILITATOR ?? 'https://x402-facilitator.molandak.org';
export const X402_PRICE = process.env.X402_PRICE ?? '$0.01';
/** Circle's USDC on Monad testnet, with the EIP-712 domain Monad's guide gives for it. */
export const MONAD_TESTNET_USDC: Address = '0x534b2f3A21130d7a60830c2Df862319e593943A3';

export function x402PayTo(): Address {
  return (process.env.X402_PAY_TO as Address | undefined) ?? delegateAccount.address;
}

/** The resource server: Monad's facilitator, the exact scheme, and testnet USDC priced the way the guide sets it. */
export function x402Server(facilitator: FacilitatorClient = new HTTPFacilitatorClient({ url: X402_FACILITATOR })): x402ResourceServer {
  const scheme = new ExactEvmScheme().registerMoneyParser(async (amount, network) =>
    network === 'eip155:10143' ? { amount: Math.floor(Number(amount) * 1_000_000).toString(), asset: MONAD_TESTNET_USDC, extra: { name: 'USDC', version: '2' } } : null,
  );
  return new x402ResourceServer(facilitator).register(X402_NETWORK, scheme);
}

export const COUNCIL_ROUTE = 'POST /x402/council';

/** The paywall over the market read. */
export function councilPaywall(server: x402ResourceServer): MiddlewareHandler {
  return paymentMiddleware(
    {
      [COUNCIL_ROUTE]: {
        accepts: [{ scheme: 'exact', price: X402_PRICE, network: X402_NETWORK, payTo: x402PayTo() }],
        description: "xorr's council market read on Monad: Chainlink against Kuru and Uniswap, the trend and Perpl funding, and each desk's vote on the trade you put to it.",
        mimeType: 'application/json',
      },
    },
    server,
    undefined,
    undefined,
    false,
  ) as MiddlewareHandler;
}

const askBody = z.object({ side: z.enum(['buy', 'sell']), symbol: z.enum(MONAD_COUNCIL_SYMBOLS), usd: z.number().positive().max(100_000) });

/** The market read itself, behind the paywall: the three market desks' readings and votes. */
export async function marketRead(p: z.infer<typeof askBody>) {
  const i = await readMonadMarketInputs(p);
  const full = { ...i, permission: { ok: false, error: 'not part of a market read' }, holding: { ok: false, error: 'not part of a market read' } } as MonadCouncilInputs;
  return { readAt: i.readAt, proposal: i.proposal, ballots: [priceDesk(full), trendReader(full), perpsDesk(full)], inputs: { price: i.price, trend: i.trend, perps: i.perps } };
}

/** The routes, with the paywall made on first use (no facilitator call at start-up). `server` is for tests. */
export function x402Routes(server?: () => x402ResourceServer): Hono {
  const app = new Hono();
  // Made on the first paid request, after asking the facilitator what it supports; a failed ask is tried again next time.
  let paywall: Promise<MiddlewareHandler> | undefined;
  app.use('/x402/council', async (c, next) => {
    paywall ??= (async () => {
      const rs = (server ?? x402Server)();
      await rs.initialize();
      return councilPaywall(rs);
    })();
    const mw = await paywall.catch((e: unknown) => {
      paywall = undefined;
      throw e;
    });
    return mw(c, next);
  });
  app.post('/x402/council', async (c) => {
    const parsed = askBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_proposal', message: 'Send {side: "buy"|"sell", symbol: MON|ETH|BTC, usd > 0}.' }, 400);
    return c.json(await marketRead(parsed.data));
  });
  // What the endpoint costs and where it settles, free: an agent reads this before it decides to pay.
  app.get('/x402', (c) =>
    c.json({ route: COUNCIL_ROUTE, price: X402_PRICE, network: X402_NETWORK, asset: MONAD_TESTNET_USDC, payTo: x402PayTo(), facilitator: X402_FACILITATOR, x402Version: 2 }),
  );
  return app;
}
