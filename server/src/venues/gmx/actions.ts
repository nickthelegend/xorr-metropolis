/**
 * GMX V2 hedges from the product (PLAN.md P2.4–P2.6 in the app, 2026-09-23).
 *
 * The hedge agent is its own wallet — `agentActor(HEDGER_ID)`, derived like every other agent — and acts as a GMX
 * *subaccount* of the owner's own GMX account: the owner signs one setup (approve USDC to GMX's Router; add the agent with
 * a maximum action count and an end date), and from then on the agent creates orders FOR the owner. Positions are the
 * owner's; collateral is pulled from the owner by GMX's Router; GMX itself refuses the agent past its count or date, or
 * once removed.
 *
 * A market order is two transactions: the agent creates it and a keeper executes it. On a fork no GMX keeper runs, so the
 * order is executed by our fork keeper (`keeper.ts`, anvil only) at GMX's own live signed prices, and every place that
 * shows it says so. On Arbitrum One the real keepers execute and the tracker only watches.
 */
import { erc20Abi, maxUint256, type Address, type Hex } from 'viem';
import { CHAIN_KEY, IS_ARBITRUM, rpcUrl } from '../../evm/chains.js';
import { moneyOn } from '../../evm/money.js';
import { publicClient } from '../../evm/client.js';
import { agentActor, ensureAgentGas } from '../../evm/agents.js';
import { log } from '../../http/request-id.js';
import { rawPriceOf } from './api.js';
import { GMX, TOKENS, marketById } from './constants.js';
import {
  acceptablePrice,
  buildAgentOrder,
  buildCollateralApproval,
  buildSubaccountSetup,
  estimateExecutionFee,
  orderKeyFromReceipt,
  readSubaccount,
  gmxRevertName,
  type TxRequest,
} from './orders.js';
import { accountPositions, orderStatus } from './tracker.js';
import { recordGmxOrder, applyGmxOrderState } from './store.js';
import { forkExecuteOrder, FORK_KEEPER_LABEL } from './keeper.js';

/** The hedge agent's id: its wallet is derived from it like every other agent's. */
export const HEDGER_ID = 'gmx-hedger';
export const HEDGER_NAME = 'Hedge Desk';
export const SLIPPAGE_BPS = 100;
export const MAX_ACTIONS = 20n;
export const SETUP_DAYS = 7;

export class GmxNotHere extends Error {
  readonly status = 409;
  constructor() {
    super(`GMX V2 runs on Arbitrum One; this executor settles on ${CHAIN_KEY}.`);
  }
}
function requireArbitrum() {
  if (!IS_ARBITRUM || CHAIN_KEY === 'arbitrum-sepolia') throw new GmxNotHere();
}

export function hedgerAddress(): Address {
  return agentActor(HEDGER_ID).account.address;
}

/** What the owner still has to sign before the hedge agent can act, and the agent's standing on GMX. */
export async function hedgeSetup(owner: Address): Promise<{
  agent: Address;
  agentName: string;
  subaccount: Awaited<ReturnType<typeof readSubaccount>>;
  allowanceUsdc: string;
  toSign: { label: string; tx: { to: Address; data: Hex; value: string } }[];
}> {
  requireArbitrum();
  const agent = hedgerAddress();
  const [sub, allowance] = await Promise.all([
    readSubaccount(publicClient, owner, agent),
    publicClient.readContract({ address: TOKENS.USDC.address as Address, abi: erc20Abi, functionName: 'allowance', args: [owner, GMX.router as Address] }),
  ]);
  const toSign: { label: string; tx: TxRequest }[] = [];
  if (allowance < 10n ** 12n) toSign.push({ label: 'Let GMX take USDC collateral from your wallet', tx: buildCollateralApproval(TOKENS.USDC.address as Address, maxUint256) });
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (!sub.active || sub.expiresAt <= nowSec || sub.actionCount >= sub.maxAllowedCount) {
    toSign.push({
      label: `Let ${HEDGER_NAME} place up to ${MAX_ACTIONS} GMX orders for you for ${SETUP_DAYS} days`,
      tx: buildSubaccountSetup({ subaccount: agent, maxAllowedCount: sub.actionCount + MAX_ACTIONS, expiresAt: nowSec + BigInt(SETUP_DAYS * 86_400) }),
    });
  }
  return {
    agent,
    agentName: HEDGER_NAME,
    subaccount: sub,
    allowanceUsdc: allowance.toString(),
    toSign: toSign.map((t) => ({ label: t.label, tx: { to: t.tx.to, data: t.tx.data, value: t.tx.value.toString() } })),
  };
}

export type HedgeResult = { key: Hex; createdTx: Hex; status: string; executedTx?: Hex | null; keeper?: string; reason?: string };

/** After an order is created on a fork, our keeper executes it (anvil only); on Arbitrum One the real keepers do. */
async function settleOnFork(key: Hex, fromBlock: bigint): Promise<Pick<HedgeResult, 'status' | 'executedTx' | 'keeper' | 'reason'>> {
  if (moneyOn(CHAIN_KEY) !== 'copy') return { status: 'pending' };
  try {
    const exec = await forkExecuteOrder({ rpc: rpcUrl, key });
    const state = await orderStatus(publicClient, key, { fromBlock });
    await applyGmxOrderState(state).catch(() => undefined);
    return { status: state.status, executedTx: exec.executeTx, keeper: FORK_KEEPER_LABEL, reason: state.reason ?? undefined };
  } catch (e) {
    log.error('[gmx] fork keeper failed', e);
    return { status: 'pending', reason: `fork keeper: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` };
  }
}

async function sendAsHedger(req: TxRequest, gasPrice: bigint): Promise<Hex> {
  await ensureAgentGas(HEDGER_ID);
  const a = agentActor(HEDGER_ID);
  const hash = await a.wallet.sendTransaction({ account: a.account, chain: a.wallet.chain, to: req.to, data: req.data, value: req.value, gasPrice } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`the agent's GMX transaction reverted (${hash})`);
  return hash;
}

/** Open (or add to) a market long or short for the owner, placed by the hedge agent. */
export async function openHedge(p: { owner: Address; marketId: string; isLong: boolean; collateralUsd: number; leverage: number }): Promise<HedgeResult> {
  requireArbitrum();
  const market = marketById(p.marketId);
  if (!market || market.short !== 'USDC') throw new Error(`Hedges use USDC collateral on ETH-USD or BTC-USD; ${p.marketId} is not one.`);
  if (!(p.collateralUsd >= 5 && p.collateralUsd <= 10_000)) throw new Error('Collateral must be between $5 and $10,000.');
  if (!(p.leverage >= 1 && p.leverage <= 5)) throw new Error('Leverage must be between 1x and 5x.');
  const collateral = BigInt(Math.round(p.collateralUsd * 1e6));
  const indexToken = (TOKENS as Record<string, { address: string }>)[market.index]?.address as Address;
  const price = await rawPriceOf(indexToken);
  const fee = await estimateExecutionFee(publicClient, { kind: 'increase' });
  const req = buildAgentOrder({
    account: p.owner,
    market: market.marketToken as Address,
    collateralToken: TOKENS.USDC.address as Address,
    kind: 'increase',
    isLong: p.isLong,
    sizeDeltaUsd: collateral * 10n ** 24n * BigInt(Math.round(p.leverage)),
    collateralDeltaAmount: collateral,
    acceptablePrice: acceptablePrice(price, p.isLong, true, SLIPPAGE_BPS),
    executionFee: fee.feeWei,
  });
  let createdTx: Hex;
  try {
    createdTx = await sendAsHedger(req, fee.txGasPrice);
  } catch (e) {
    throw new Error(`GMX refused the order: ${gmxRevertName(e) ?? (e instanceof Error ? e.message.slice(0, 200) : String(e))}`);
  }
  const receipt = await publicClient.getTransactionReceipt({ hash: createdTx });
  const key = orderKeyFromReceipt(receipt);
  await recordGmxOrder({ key, owner: p.owner, market: market.marketToken, isLong: p.isLong, kind: 'increase', sizeUsd: p.collateralUsd * p.leverage, collateralUsd: p.collateralUsd, createdTx });
  return { key, createdTx, ...(await settleOnFork(key, receipt.blockNumber)) };
}

/** Close the owner's whole position in a market and direction, placed by the hedge agent. */
export async function closeHedge(p: { owner: Address; marketId: string; isLong: boolean }): Promise<HedgeResult> {
  requireArbitrum();
  const market = marketById(p.marketId);
  if (!market) throw new Error(`No GMX market ${p.marketId}.`);
  const pos = (await accountPositions(publicClient, p.owner)).find((x) => x.market.toLowerCase() === market.marketToken.toLowerCase() && x.isLong === p.isLong);
  if (!pos) throw new Error(`No open ${p.isLong ? 'long' : 'short'} on ${market.name}.`);
  const indexToken = (TOKENS as Record<string, { address: string }>)[market.index]?.address as Address;
  const price = await rawPriceOf(indexToken);
  const fee = await estimateExecutionFee(publicClient, { kind: 'decrease' });
  const req = buildAgentOrder({
    account: p.owner,
    market: market.marketToken as Address,
    collateralToken: pos.collateralToken,
    kind: 'decrease',
    isLong: p.isLong,
    sizeDeltaUsd: pos.sizeInUsdRaw,
    collateralDeltaAmount: 0n,
    acceptablePrice: acceptablePrice(price, p.isLong, false, SLIPPAGE_BPS),
    executionFee: fee.feeWei,
  });
  let createdTx: Hex;
  try {
    createdTx = await sendAsHedger(req, fee.txGasPrice);
  } catch (e) {
    throw new Error(`GMX refused the close: ${gmxRevertName(e) ?? (e instanceof Error ? e.message.slice(0, 200) : String(e))}`);
  }
  const receipt = await publicClient.getTransactionReceipt({ hash: createdTx });
  const key = orderKeyFromReceipt(receipt);
  await recordGmxOrder({ key, owner: p.owner, market: market.marketToken, isLong: p.isLong, kind: 'decrease', sizeUsd: pos.sizeUsd, collateralUsd: 0, createdTx });
  return { key, createdTx, ...(await settleOnFork(key, receipt.blockNumber)) };
}
