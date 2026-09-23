/**
 * The trade path an approved council round executes through (PLAN.md P3.3, 2026-09-23).
 *
 * `council/convene.ts` decides whether to ask; this is what it asks — the executor's own spend paths, unchanged:
 *
 *   - a BUY is `placeOrder` → `runStrategy`: the recorded and on-chain permission, the rules engine, the Stock Token gate
 *     (`stock-guard.ts`), Uniswap v3 through `XorrDelegation.spend()`, the fill measured, booked and audited;
 *   - a SELL is `closeHolding`: the same gate, then `closePosition()` back to the settlement token.
 *
 * Registered at startup (`index.ts`). Nothing here re-checks what those paths check; the answer is theirs, mapped onto
 * the round's outcome with the transaction hash when there is one.
 */
import type { Address } from 'viem';
import { one } from '../db/index.js';
import { holdings } from '../evm/balances.js';
import type { CouncilExecutor, ExecutionResult } from '../council/convene.js';
import { closeHolding } from '../routes/panic.js';
import type { WalletRow } from '../routes/wallet-context.js';
import { canonicalSymbol, ensureRegistry } from '../venues/tokens.js';
import { placeOrder } from './order.js';
import { ensureAgentGas, withAgent } from '../evm/agents.js';

/**
 * An agent's round is executed AS that agent: its own wallet signs (`withAgent`), its own permission and tally are what
 * the contract checks, and its gas is topped up first. A round the owner convened is the desk's, as their own order is.
 */
export const councilExecutor: CouncilExecutor = async (p): Promise<ExecutionResult> => {
  if (!p.agentId) return executeRound(p);
  const agentId = p.agentId;
  await ensureAgentGas(agentId);
  return withAgent(agentId, () => executeRound(p));
};

async function executeRound({ walletId, owner, proposal, roundId, agentId }: Parameters<CouncilExecutor>[0]): Promise<ExecutionResult> {
  const w = await one<WalletRow>(`SELECT * FROM wallets WHERE id = $1`, [walletId]);
  if (!w || w.address.toLowerCase() !== owner.toLowerCase()) {
    return { status: 'refused', detail: 'The round names a wallet this executor has no record of for that owner.' };
  }
  await ensureRegistry();
  const symbol = canonicalSymbol(proposal.symbol);

  if (proposal.side === 'buy') {
    const order = await placeOrder(w, symbol, proposal.usd, `Council round ${roundId}: buy $${proposal.usd} of ${symbol}`);
    if (!order.placed) return { status: 'refused', detail: `${order.refusal.reason}: ${order.refusal.detail}` };
    const o = order.outcome;
    if (o.status === 'filled') {
      return {
        status: 'executed',
        txHash: o.signature as `0x${string}`,
        detail: `Bought ${o.units.toFixed(6)} ${symbol} at $${o.price.toFixed(4)}.`,
        fill: { units: o.units, price: o.price, usd: o.units * o.price },
      };
    }
    if (o.status === 'blocked') return { status: 'refused', detail: `${o.reason}: ${o.detail}` };
    if (o.status === 'failed') return { status: 'failed', detail: o.error };
    return { status: 'refused', detail: `The order did not run (${o.status}).` };
  }

  const held = (await holdings(owner as Address)).find((h) => h.symbol === symbol && h.units > 0);
  if (!held || !(held.usd > 0)) return { status: 'refused', detail: `No ${symbol} to sell.` };
  const fraction = Math.min(1, proposal.usd / held.usd);
  const out = await closeHolding({ wallet: w, symbol, fraction, actor: agentId ?? 'Council' });
  const b = out.body as Record<string, unknown>;
  if (out.status === 200) {
    return {
      status: 'executed',
      txHash: b.txHash as `0x${string}`,
      detail: `Sold ${Number(b.units).toFixed(6)} ${symbol} for $${Number(b.usd).toFixed(2)}.`,
    };
  }
  const detail = String(b.detail ?? b.error ?? 'The sale did not go through.');
  return out.status === 409 ? { status: 'refused', detail: `${String(b.reason ?? 'refused')}: ${detail}` } : { status: 'failed', detail };
}
