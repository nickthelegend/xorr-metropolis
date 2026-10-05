/**
 * The Perpl desk: a user's Perpl account, held by Perpl's own DelegatedAccount, traded by xorr's agent key
 * (FEATURES-100 #2/#3/#5/#6/#7/#37, 2026-09-24). The on-chain side is `perpl-chain.ts`.
 *
 *   1. `createTypedData(owner)` — the owner's EIP-712 `Create(owner, operator, nonce, deadline)` for Perpl's factory. The
 *      operator is xorr's key for this owner alone (`operatorFor`), so stopping one user's agent touches nobody else's.
 *   2. `createDesk(owner, sig, deadline)` — the operator signs Perpl's `AssignOperator` consent and the executor submits
 *      `createWithSignature`, paying the gas. The owner signed a message, not a transaction.
 *   3. The owner sends AUSD to the desk and calls `createAccount(amount)` — both theirs to sign (owner-only on the desk).
 *   4. `placePerpOrder` — the operator sends an IOC order through the desk after the owner's caps and an `eth_call` of the
 *      exact transaction; a refusal is named, never sent to fail on chain.
 *   5. The owner's `removeOperator` stops it on chain; `withdrawCollateral` always pays the owner.
 *
 * Caps (per order, per day, leverage) are the owner's and are enforced here, before signing. What the chain guarantees on
 * its own is narrower and stronger: the agent can never withdraw, and after `removeOperator` it can do nothing.
 */
import { randomUUID } from 'node:crypto';
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  decodeEventLog,
  erc20Abi,
  getAddress,
  parseAbi,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from 'viem';
import { chain, CHAIN_KEY, explorerTx } from '../evm/chains.js';
import { delegateAccount, publicClient, walletClient } from '../evm/client.js';
import { agentActor, ensureAgentGas } from '../evm/agents.js';
import { one, query } from '../db/index.js';
import { isNotYetSpendable, monadFees, sendWhenSpendable } from '../evm/spendable.js';
import { append } from '../audit/log.js';
import { getJson } from '../http/get.js';
import {
  ASSIGN_OPERATOR_TYPES,
  CREATE_TYPES,
  DESK_ABI,
  EXCHANGE_ABI,
  FACTORY_ABI,
  OPERATOR_SELECTORS,
  execOrderData,
  factoryDomain,
  marketFromContext,
  perplHere,
  planOrder,
  readPosition,
  type DeskPosition,
  type PerpMarket,
  type PerpSide,
  type PerplNetwork,
} from './perpl-chain.js';

export class PerplRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 403 | 409 | 502 = 409,
  ) {
    super(message);
  }
}

function net(): PerplNetwork {
  const n = perplHere();
  if (!n) throw new PerplRefusal('perpl_not_here', `Perpl runs on Monad mainnet and Monad testnet; this executor serves ${CHAIN_KEY}.`);
  return n;
}

/** xorr's operator key for one owner — derived from the executor's master key, never stored, one per owner. */
export function operatorFor(owner: Address) {
  return agentActor(`perpl:${owner.toLowerCase()}`);
}

// ---------------------------------------------------------------- markets

/** Perpl's markets now: Perpl's public context (book top, mark, funding, OI, leverage limits), open ones only. */
export async function perplMarkets(): Promise<PerpMarket[]> {
  const ctx = await getJson<{ markets: Parameters<typeof marketFromContext>[0][] }>(`${net().api}/v1/pub/context`);
  return ctx.markets.map(marketFromContext).filter((m) => m.open);
}

const PERP_INFO_ABI = parseAbi([
  'function getPerpetualInfo(uint256 perpId) view returns ((string name,string symbol,uint256 priceDecimals,uint256 lotDecimals,bytes32 linkFeedId,uint256 priceTolPer100K,uint256 marginTol,uint256 marginTolDecimals,uint256 refPriceMaxAgeSec,uint256 positionBalanceCNS,uint256 insuranceBalanceCNS,uint256 markPNS,uint256 markTimestamp,uint256 lastPNS,uint256 lastTimestamp,uint256 oraclePNS,uint256 oracleTimestampSec,uint256 longOpenInterestLNS,uint256 shortOpenInterestLNS,uint256 fundingStartBlock,int256 fundingRatePct100k,uint256 absFundingClampPctPer100K,uint256 status,uint256 basePricePNS,uint256 maxBidPriceONS,uint256 minBidPriceONS,uint256 maxAskPriceONS,uint256 minAskPriceONS,uint256 numOrders,bool ignOracle) perpetualInfo)',
]);

/**
 * The book an order will actually meet: Perpl's Exchange read now, not the API's copy of it (2026-10-06). The two agree
 * on a live network to within a block; on a fork they do not — the fork's resting orders stay where they were when it
 * was taken while the API moves on — and an IOC priced off the API's ask then sits below every ask on the fork and fills
 * nothing. A side with no resting order keeps the API's figure.
 */
export async function withChainBook(m: PerpMarket): Promise<PerpMarket> {
  try {
    const i = await publicClient.readContract({ address: net().exchange, abi: PERP_INFO_ABI, functionName: 'getPerpetualInfo', args: [BigInt(m.id)] });
    const scale = 10 ** Number(i.priceDecimals);
    const side = (ons: bigint) => (ons > 0n && ons < 2n ** 64n ? Number(i.basePricePNS + ons) / scale : null);
    return { ...m, bid: side(i.maxBidPriceONS) ?? m.bid, ask: side(i.minAskPriceONS) ?? m.ask, mark: i.markPNS > 0n ? Number(i.markPNS) / scale : m.mark };
  } catch {
    return m;
  }
}

async function market(perpId: number): Promise<PerpMarket> {
  const m = (await perplMarkets()).find((x) => x.id === perpId);
  if (!m) throw new PerplRefusal('unknown_market', `Perpl has no open market ${perpId}.`, 400);
  return withChainBook(m);
}

// ---------------------------------------------------------------- the desk record

type DeskRow = {
  owner: string;
  desk: string;
  operator: string;
  factory: string;
  create_tx: string;
  max_order_usd: string;
  max_day_usd: string;
  max_leverage_hdths: number;
};

async function deskRow(owner: Address): Promise<DeskRow | undefined> {
  return one<DeskRow>(`SELECT * FROM perpl_desks WHERE lower(owner) = lower($1) AND chain = current_setting('xorr.chain_key')`, [owner]);
}

export type DeskState = {
  network: string;
  exchange: Address;
  factory: Address;
  collateral: Address;
  owner: Address;
  /** Null until the owner has made one. */
  desk: Address | null;
  operator: Address;
  /** Read from the desk now: is xorr's key still allowed to trade? */
  operatorActive: boolean;
  /** Exchange selectors xorr's operator needs that the desk does not allow yet (the owner enables them). */
  allowlistMissing: { name: string; selector: Hex }[];
  /** Perpl's account id for the desk; 0 until the owner opens it with a deposit. */
  accountId: string;
  /** AUSD on Perpl for this account, and the part locked in positions/orders. */
  balance: number;
  locked: number;
  /** AUSD sitting in the desk contract, not yet on Perpl (sent but `createAccount` not called). */
  idle: number;
  /** AUSD and MON in the owner's own wallet. */
  wallet: { ausd: number; gas: number };
  positions: DeskPosition[];
  caps: { maxOrderUsd: number; maxDayUsd: number; maxLeverage: number; usedTodayUsd: number };
  createTx: string | null;
  explorer: string | null;
};

/** The operator functions this desk does not allow yet, read from the desk now. */
async function missingSelectors(desk: Address): Promise<{ name: string; selector: Hex }[]> {
  const checks = await Promise.all(
    Object.entries(OPERATOR_SELECTORS).map(async ([name, selector]) => ({
      name,
      selector,
      allowed: await publicClient.readContract({ address: desk, abi: DESK_ABI, functionName: 'operatorAllowlist', args: [selector] }),
    })),
  );
  return checks.filter((c) => !c.allowed).map(({ name, selector }) => ({ name, selector }));
}

async function usedToday(owner: Address): Promise<number> {
  const r = await one<{ usd: string | null }>(
    `SELECT sum(notional_usd)::text AS usd FROM perp_orders
       WHERE lower(owner) = lower($1) AND chain = current_setting('xorr.chain_key') AND status = 'filled'
         AND side IN ('open_long','open_short') AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    [owner],
  );
  return Number(r?.usd ?? 0);
}

/** Everything about the owner's desk, read from the chain now (the table only says which desk is theirs). */
export async function deskState(owner: Address): Promise<DeskState> {
  const n = net();
  const row = await deskRow(owner);
  const operator = operatorFor(owner).account.address;
  const [walletAusd, walletGas] = await Promise.all([
    publicClient.readContract({ address: n.collateral, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
    publicClient.getBalance({ address: owner }),
  ]);
  const base = {
    network: n.name,
    exchange: n.exchange,
    factory: n.factory,
    collateral: n.collateral,
    owner,
    operator,
    wallet: { ausd: Number(walletAusd) / 1e6, gas: Number(walletGas) / 1e18 },
    caps: {
      maxOrderUsd: Number(row?.max_order_usd ?? 250),
      maxDayUsd: Number(row?.max_day_usd ?? 1000),
      maxLeverage: (row?.max_leverage_hdths ?? 200) / 100,
      usedTodayUsd: await usedToday(owner),
    },
  };
  if (!row) {
    return { ...base, desk: null, operatorActive: false, allowlistMissing: [], accountId: '0', balance: 0, locked: 0, idle: 0, positions: [], createTx: null, explorer: null };
  }
  const desk = getAddress(row.desk);
  const allowlistMissing = await missingSelectors(desk);
  const [onChainOwner, active, accountId, idle] = await Promise.all([
    publicClient.readContract({ address: desk, abi: DESK_ABI, functionName: 'owner' }),
    publicClient.readContract({ address: desk, abi: DESK_ABI, functionName: 'isOperator', args: [getAddress(row.operator)] }),
    publicClient.readContract({ address: desk, abi: DESK_ABI, functionName: 'accountId' }),
    publicClient.readContract({ address: n.collateral, abi: erc20Abi, functionName: 'balanceOf', args: [desk] }),
  ]);
  if (getAddress(onChainOwner) !== getAddress(owner)) {
    throw new PerplRefusal('desk_owner_mismatch', `The desk ${desk} on record is owned by ${onChainOwner} on chain, not ${owner}.`, 409);
  }
  let balance = 0;
  let locked = 0;
  let positions: DeskPosition[] = [];
  if (accountId > 0n) {
    const acct = await publicClient.readContract({ address: n.exchange, abi: EXCHANGE_ABI, functionName: 'getAccountByAddr', args: [desk] });
    balance = Number(acct.balanceCNS) / 1e6;
    locked = Number(acct.lockedBalanceCNS) / 1e6;
    const markets = await perplMarkets();
    positions = (await Promise.all(markets.map((m) => readPosition(publicClient, n, m, accountId)))).filter((p): p is DeskPosition => p !== null);
  }
  return {
    ...base,
    desk,
    operatorActive: active,
    allowlistMissing,
    accountId: accountId.toString(),
    balance,
    locked,
    idle: Number(idle) / 1e6,
    positions,
    createTx: row.create_tx,
    explorer: explorerTx(row.create_tx),
  };
}

// ---------------------------------------------------------------- creating the desk

const SIG_TTL_SEC = 15 * 60;

/** What the owner signs to have Perpl's factory make their desk with xorr's key as its operator. */
export async function createTypedData(owner: Address) {
  const n = net();
  if (await deskRow(owner)) throw new PerplRefusal('desk_exists', 'This wallet already has a Perpl desk.');
  const operator = operatorFor(owner).account.address;
  const nonce = await publicClient.readContract({ address: n.factory, abi: FACTORY_ABI, functionName: 'nonces', args: [owner] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + SIG_TTL_SEC);
  return {
    domain: factoryDomain(n, chain.id),
    types: CREATE_TYPES,
    primaryType: 'Create' as const,
    message: { owner, operator, nonce: nonce.toString(), deadline: deadline.toString() },
  };
}

/** Submit the owner's signed `Create` with the operator's consent. Returns the desk and the transaction. */
export async function createDesk(p: { owner: Address; walletId: string; signature: Hex; nonce: string; deadline: string }) {
  const n = net();
  if (await deskRow(p.owner)) throw new PerplRefusal('desk_exists', 'This wallet already has a Perpl desk.');
  const op = operatorFor(p.owner);
  const deadline = BigInt(p.deadline);
  if (deadline < BigInt(Math.floor(Date.now() / 1000))) throw new PerplRefusal('signature_expired', 'The signature expired; sign again.', 400);
  const signer = await recoverTypedDataAddress({
    domain: factoryDomain(n, chain.id),
    types: CREATE_TYPES,
    primaryType: 'Create',
    message: { owner: p.owner, operator: op.account.address, nonce: BigInt(p.nonce), deadline },
    signature: p.signature,
  });
  if (getAddress(signer) !== getAddress(p.owner)) {
    throw new PerplRefusal('bad_signature', `The signature is from ${signer}, not ${p.owner}.`, 403);
  }
  const opNonce = await publicClient.readContract({ address: n.factory, abi: FACTORY_ABI, functionName: 'operatorNonces', args: [op.account.address] });
  const opSig = await op.account.signTypedData({
    domain: factoryDomain(n, chain.id),
    types: ASSIGN_OPERATOR_TYPES,
    primaryType: 'AssignOperator',
    message: { owner: p.owner, nonce: opNonce, deadline },
  });
  const args = [p.owner, op.account.address, deadline, p.signature, deadline, opSig] as const;
  // Monad bills the declared limit: estimate, then pad 10%.
  const gas = await publicClient.estimateContractGas({ account: delegateAccount, address: n.factory, abi: FACTORY_ABI, functionName: 'createWithSignature', args });
  const fees = await monadFees(publicClient, chain.id);
  const hash = await sendWhenSpendable(() =>
    walletClient.writeContract({ account: delegateAccount, chain, address: n.factory, abi: FACTORY_ABI, functionName: 'createWithSignature', args, gas: (gas * 110n) / 100n, ...fees }),
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== 'success') throw new PerplRefusal('create_reverted', `Perpl's factory reverted the desk creation (${hash}).`, 502);
  const created = receipt.logs
    .map((l) => {
      try {
        return decodeEventLog({ abi: FACTORY_ABI, data: l.data, topics: l.topics });
      } catch {
        return null;
      }
    })
    .find((e) => e?.eventName === 'DelegatedAccountCreated');
  if (!created || created.eventName !== 'DelegatedAccountCreated') throw new PerplRefusal('create_no_event', `No DelegatedAccountCreated in ${hash}.`, 502);
  const desk = getAddress(created.args.proxy);
  await query(
    `INSERT INTO perpl_desks (owner, desk, operator, factory, create_tx) VALUES ($1, $2, $3, $4, $5)`,
    [getAddress(p.owner), desk, op.account.address, n.factory, hash],
  );
  await append({
    walletId: p.walletId,
    agent: 'xorr',
    action: 'Opened a Perpl desk',
    detail: `Perpl's DelegatedAccount ${desk}: you own it and alone can withdraw; xorr's agent key ${op.account.address} can trade and can never withdraw.`,
    kind: 'risk',
    signature: hash,
    payload: { desk, operator: op.account.address, factory: n.factory, explorer: explorerTx(hash) },
  });
  // The operator pays for its own orders: give it gas now, not at the first order.
  await ensureAgentGas(`perpl:${p.owner.toLowerCase()}`).catch(() => undefined);
  return { desk, operator: op.account.address, txHash: hash, explorer: explorerTx(hash) };
}

// ---------------------------------------------------------------- resume: the operator's consent to be added back

/**
 * After the owner removed xorr's key, resuming is theirs to do: xorr's operator signs Perpl's `AssignOperator` consent for
 * this desk (the desk's own EIP-712 domain, nonce from the desk), and the owner sends `addOperator(operator, deadline, sig)`.
 */
export async function operatorConsent(owner: Address) {
  const row = await deskRow(owner);
  if (!row) throw new PerplRefusal('no_desk', 'Open a Perpl desk first.');
  const desk = getAddress(row.desk);
  const op = operatorFor(owner);
  const nonce = await publicClient.readContract({ address: desk, abi: DESK_ABI, functionName: 'operatorNonces', args: [op.account.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + SIG_TTL_SEC);
  const signature = await op.account.signTypedData({
    domain: { name: 'DelegatedAccount', version: '1', chainId: chain.id, verifyingContract: desk },
    types: ASSIGN_OPERATOR_TYPES,
    primaryType: 'AssignOperator',
    message: { owner, nonce, deadline },
  });
  return { desk, operator: op.account.address, deadline: deadline.toString(), signature };
}

// ---------------------------------------------------------------- caps

export async function setCaps(owner: Address, caps: { maxOrderUsd: number; maxDayUsd: number; maxLeverage: number }) {
  const row = await deskRow(owner);
  if (!row) throw new PerplRefusal('no_desk', 'Open a Perpl desk first.');
  await query(
    `UPDATE perpl_desks SET max_order_usd = $2, max_day_usd = $3, max_leverage_hdths = $4 WHERE lower(owner) = lower($1) AND chain = current_setting('xorr.chain_key')`,
    [owner, caps.maxOrderUsd, caps.maxDayUsd, Math.round(caps.maxLeverage * 100)],
  );
}

// ---------------------------------------------------------------- orders

const PERPL_ERRORS = parseAbi([
  'error TakerOrderSettlementFailed(uint256 perpId, uint256 accountId, uint256 entryPricePNS, uint256 collatPricePNS, uint256 pnlPricePNS, uint256 filledLotLNS, uint256 unfillableLotLNS, uint256 resultCode)',
  'error ExceedsLastExecutionBlock(uint256 lastExecutionBlock)',
  'error OnlyOwnerOrOperator()',
  'error SelectorNotAllowed(bytes4 selector)',
  'error AccountNotCreated()',
]);

/** A revert, by the name Perpl or the desk gave it. */
function revertName(err: unknown): string {
  const data = err instanceof BaseError ? (err.walk((e) => 'data' in (e as object)) as { data?: unknown } | null)?.data : undefined;
  if (typeof data === 'string' && data.startsWith('0x') && data.length >= 10) {
    try {
      const d = decodeErrorResult({ abi: PERPL_ERRORS, data: data as Hex });
      return `${d.errorName}(${(d.args ?? []).map(String).join(', ')})`;
    } catch {
      return `revert ${data.slice(0, 10)}`;
    }
  }
  const reverted = err instanceof BaseError ? err.walk((e) => e instanceof ContractFunctionRevertedError) : null;
  if (reverted instanceof ContractFunctionRevertedError) return reverted.data?.errorName ?? reverted.shortMessage;
  return err instanceof Error ? err.message.split('\n')[0]! : String(err);
}

export type PerpOrderResult = {
  id: string;
  status: 'filled' | 'reverted';
  txHash: Hex;
  explorer: string;
  market: string;
  side: PerpSide;
  lots: number;
  limitPrice: number;
  notionalUsd: number;
  position: DeskPosition | null;
};

/**
 * Place an order for the owner through their desk, as xorr's operator. Opens are held to the owner's caps; a close is
 * sized to the open position and is always allowed while the operator is active (getting out is never blocked by a cap).
 */
export async function placePerpOrder(p: {
  owner: Address;
  walletId: string;
  perpId: number;
  side: PerpSide;
  usd?: number;
  leverage?: number;
  placedBy: string;
  reason?: string;
}): Promise<PerpOrderResult> {
  const n = net();
  const row = await deskRow(p.owner);
  if (!row) throw new PerplRefusal('no_desk', 'Open a Perpl desk first.');
  const desk = getAddress(row.desk);
  const op = operatorFor(p.owner);
  const [active, accountId] = await Promise.all([
    publicClient.readContract({ address: desk, abi: DESK_ABI, functionName: 'isOperator', args: [op.account.address] }),
    publicClient.readContract({ address: desk, abi: DESK_ABI, functionName: 'accountId' }),
  ]);
  if (!active) throw new PerplRefusal('operator_removed', 'You removed xorr from this desk on chain, so no agent can trade it. Add it back to resume.');
  if (accountId === 0n) throw new PerplRefusal('account_not_opened', 'Fund the desk and open its Perpl account first.');
  const missing = await missingSelectors(desk);
  if (missing.length > 0) {
    throw new PerplRefusal('allowlist_stale', `Your desk does not let xorr's key call ${missing.map((m) => `${m.name} (${m.selector})`).join(', ')} yet — enable it on the desk (one transaction).`);
  }
  const m = await market(p.perpId);
  const opening = p.side === 'open_long' || p.side === 'open_short';
  let usd = p.usd ?? 0;
  const leverageHdths = Math.round((p.leverage ?? 2) * 100);
  if (opening) {
    if (!(usd > 0)) throw new PerplRefusal('bad_amount', 'Say how many dollars to trade.', 400);
    const maxOrder = Number(row.max_order_usd);
    const maxDay = Number(row.max_day_usd);
    const used = await usedToday(p.owner);
    if (usd > maxOrder) throw new PerplRefusal('order_cap', `$${usd} is over your $${maxOrder} per-order limit for agents on Perpl.`);
    if (used + usd > maxDay) throw new PerplRefusal('daily_cap', `That would take today's Perpl opens to $${(used + usd).toFixed(2)}, over your $${maxDay} daily limit. $${Math.max(0, maxDay - used).toFixed(2)} is left.`);
    if (leverageHdths > row.max_leverage_hdths) throw new PerplRefusal('leverage_cap', `${leverageHdths / 100}x is over the ${row.max_leverage_hdths / 100}x you allowed.`);
    if (leverageHdths > m.maxLeverage * 100) throw new PerplRefusal('leverage_market', `${m.name} opens at most ${m.maxLeverage}x on Perpl.`);
  } else {
    const pos = await readPosition(publicClient, n, m, accountId);
    const wantLong = p.side === 'close_long';
    if (!pos || pos.long !== wantLong) throw new PerplRefusal('no_position', `No ${wantLong ? 'long' : 'short'} ${m.name} position to close.`);
    const top = wantLong ? m.bid : m.ask;
    usd = pos.lots * (top ?? pos.entry);
  }
  const plan = planOrder(m, p.side, usd, leverageHdths);
  if (!opening) {
    // Close exactly what is open: the plan's lots come from the USD value, which rounds; the position's own lots do not.
    const pos = (await readPosition(publicClient, n, m, accountId))!;
    plan.lotLNS = BigInt(Math.round(pos.lots * 10 ** m.lotDecimals));
    plan.lots = pos.lots;
  }
  await ensureAgentGas(`perpl:${p.owner.toLowerCase()}`);
  const id = randomUUID();
  const head = await publicClient.getBlockNumber();
  const data = execOrderData(plan, head, BigInt(Date.now()));
  // The exact transaction, simulated first: a refusal is named here instead of being paid for on chain.
  let gas: bigint;
  try {
    gas = await publicClient.estimateGas({ account: op.account, to: desk, data });
  } catch (e) {
    const name = revertName(e);
    await query(
      `INSERT INTO perp_orders (id, owner, desk, perp_id, market, side, lots, limit_price, notional_usd, leverage_hdths, status, placed_by, reason, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'refused',$11,$12,$13)`,
      [id, getAddress(p.owner), desk, m.id, m.name, p.side, plan.lots, plan.limitPrice, plan.notionalUsd, leverageHdths, p.placedBy, p.reason ?? null, JSON.stringify({ revert: name })],
    );
    throw new PerplRefusal('perpl_refused', `Perpl would refuse this order: ${name}.`, 409);
  }
  const fees = await monadFees(publicClient, chain.id);
  let hash: Hex;
  try {
    // Up to ~90 s: MON a top-up just added can stay unspendable longer than the 3-block lag (measured >45 s once).
    hash = await sendWhenSpendable(() => op.wallet.sendTransaction({ account: op.account, chain, to: desk, data, gas: (gas * 110n) / 100n, ...fees }), { attempts: 30, waitMs: 3000 });
  } catch (e) {
    const raw = e instanceof BaseError ? `${e.shortMessage} ${e.details ?? ''}` : String(e);
    console.warn(`[perpl] order not sent for ${p.owner}: ${raw}`);
    if (isNotYetSpendable(e)) {
      throw new PerplRefusal('agent_gas_pending', "xorr's agent key was just given gas and Monad has not credited it yet, so the order was not sent. Try again in a minute.", 409);
    }
    throw new PerplRefusal('send_failed', `The order could not be sent: ${e instanceof BaseError ? e.shortMessage : String(e).split('\n')[0]}`, 502);
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  const status = receipt.status === 'success' ? 'filled' : 'reverted';
  const position = await readPosition(publicClient, n, m, accountId);
  await query(
    `INSERT INTO perp_orders (id, owner, desk, perp_id, market, side, lots, limit_price, notional_usd, leverage_hdths, status, tx_hash, placed_by, reason, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [id, getAddress(p.owner), desk, m.id, m.name, p.side, plan.lots, plan.limitPrice, plan.notionalUsd, leverageHdths, status, hash, p.placedBy, p.reason ?? null, JSON.stringify({ block: receipt.blockNumber.toString(), mark: m.mark })],
  );
  const verb = { open_long: 'Opened a long', open_short: 'Opened a short', close_long: 'Closed the long', close_short: 'Closed the short' }[p.side];
  await append({
    walletId: p.walletId,
    agent: p.placedBy === 'owner' ? 'You' : p.placedBy,
    action: `${verb} on ${m.name} (Perpl)`,
    detail: status === 'filled'
      ? `${plan.lots} ${m.name} at up to $${plan.limitPrice} (≈$${plan.notionalUsd.toFixed(2)}, ${leverageHdths / 100}x) through your Perpl desk.`
      : `The order was mined and reverted (${hash}).`,
    kind: status === 'filled' ? 'trade' : 'block',
    signature: hash,
    payload: { id, desk, perpId: m.id, side: p.side, lots: plan.lots, limitPrice: plan.limitPrice, notionalUsd: plan.notionalUsd, explorer: explorerTx(hash) },
  });
  // Top the agent's gas up now, between orders, so the next order never waits on MON Monad has not credited yet.
  void ensureAgentGas(`perpl:${p.owner.toLowerCase()}`).catch((e) => console.warn(`[perpl] gas top-up after order: ${e instanceof Error ? e.message.split('\n')[0] : e}`));
  return { id, status, txHash: hash, explorer: explorerTx(hash), market: m.name, side: p.side, lots: plan.lots, limitPrice: plan.limitPrice, notionalUsd: plan.notionalUsd, position };
}

export async function recentOrders(owner: Address, limit = 30) {
  return query(
    `SELECT id, perp_id, market, side, lots, limit_price, notional_usd, leverage_hdths, status, tx_hash, placed_by, reason, detail, created_at
       FROM perp_orders WHERE lower(owner) = lower($1) AND chain = current_setting('xorr.chain_key') ORDER BY created_at DESC LIMIT $2`,
    [owner, limit],
  );
}
