/**
 * Proof: an agent trades GMX V2 perps in its OWNER's account, within limits the owner set on-chain
 * (PLAN.md P2.4–P2.6, 2026-09-23). Anvil forks of Arbitrum One only.
 *
 *   1. A fresh owner key gets ETH and 1,000 USDC (Circle's USDC, balance written the way Foundry's `deal` does).
 *   2. The owner approves USDC to GMX's Router, then in ONE transaction registers the agent as a subaccount with
 *      maxAllowedCount = 2 and a one-hour expiry, and sends it ETH for execution fees.
 *   3. The agent opens a $50-collateral 2× long on ETH/USD [ETH-USDC] for the owner (SubaccountRouter.createOrder).
 *   4. The tracker reads the order: pending.
 *   5. The fork keeper executes it at GMX's live price (labelled — see venues/gmx/keeper.ts).
 *   6. The position is read back: owned by the OWNER; the agent has none.
 *   7. The agent closes it (MarketDecrease); the fork keeper executes; the USDC is back with the owner.
 *   8. The agent's third action is refused: MaxSubaccountActionCountExceeded.
 *   9. The owner raises the count but sets expiry a few seconds out; after it passes: SubaccountApprovalExpired.
 *  10. The owner removes the agent: SubaccountNotAuthorized.
 *
 * No time travel (the hosted fork is shared): expiry is waited out in real time.
 *
 * Run:  cd server && FORK_RPC=http://127.0.0.1:8547 npx tsx src/prove-gmx.ts
 * Env:  DELEGATE_PRIVATE_KEY (optional agent key; generated otherwise), GMX_UI_FEE_RECEIVER, GMX_REFERRAL_CODE,
 *       GMX_PROVE_DB=1 to also write gmx_orders through DATABASE_URL.
 */
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { arbitrum } from 'viem/chains';
import { dealErc20, topUpNative } from './fork/anvil.js';
import { rawPriceOf } from './venues/gmx/api.js';
import { subaccountRouterAbi } from './venues/gmx/abis.js';
import { GMX, KEYS, MARKETS, TOKENS } from './venues/gmx/constants.js';
import { assertArbitrumAnvilFork, forkExecuteOrder } from './venues/gmx/keeper.js';
import {
  acceptablePrice,
  buildAgentOrder,
  buildCollateralApproval,
  buildRemoveSubaccount,
  buildSubaccountSetup,
  estimateExecutionFee,
  gmxRevertName,
  orderKeyFromReceipt,
  readSubaccount,
  referralCodeFromEnv,
  uiFeeReceiverFromEnv,
  type TxRequest,
} from './venues/gmx/orders.js';
import { accountPositions, orderStatus, type OrderState } from './venues/gmx/tracker.js';

const RPC = process.env.FORK_RPC ?? 'http://127.0.0.1:8545';
const chain = { ...arbitrum, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const RECEIPT = { timeout: 600_000, pollingInterval: 500 } as const;
const ETH_MARKET = MARKETS.find((m) => m.id === 'ETH-USD')!;
const USDC = TOKENS.USDC.address;
const SLIPPAGE_BPS = 100;
const COLLATERAL = parseUnits('50', 6);
const LEVERAGE = 2n;

const txs: [string, Hex][] = [];
function log(step: string, detail = ''): void {
  console.log(`\n== ${step}${detail ? `\n   ${detail}` : ''}`);
}

async function send(who: PrivateKeyAccount, label: string, req: TxRequest, gasPrice?: bigint): Promise<Hex> {
  const wallet = createWalletClient({ chain, transport: http(RPC), account: who });
  // Simulate first, so a refusal is reported by GMX's error name, not as a bare revert.
  try {
    await pub.call({ account: who, to: req.to, data: req.data, value: req.value });
  } catch (e) {
    throw Object.assign(new Error(`${label} would revert${gmxRevertName(e) ? ` with ${gmxRevertName(e)}` : ''}`), { cause: e, gmx: gmxRevertName(e) });
  }
  const hash = await wallet.sendTransaction({ to: req.to, data: req.data, value: req.value, ...(gasPrice ? { gasPrice } : {}) });
  const r = await pub.waitForTransactionReceipt({ hash, ...RECEIPT });
  if (r.status !== 'success') throw new Error(`${label} ${hash} reverted`);
  txs.push([label, hash]);
  console.log(`   tx ${label}: ${hash} (block ${r.blockNumber})`);
  return hash;
}

async function expectRefusal(who: PrivateKeyAccount, label: string, req: TxRequest, expected: string): Promise<string> {
  try {
    await pub.call({ account: who, to: req.to, data: req.data, value: req.value });
  } catch (e) {
    const name = gmxRevertName(e);
    if (name !== expected) throw new Error(`${label}: expected ${expected}, got ${name ?? (e instanceof Error ? e.message.split('\n')[0] : String(e))}`);
    console.log(`   refused as expected: ${name}`);
    return name;
  }
  throw new Error(`${label}: expected ${expected}, but the call succeeded`);
}

function showState(s: OrderState): void {
  console.log(`   order ${s.key}: ${s.status}${s.tx ? ` (tx ${s.tx})` : ''}${s.reason ? ` — ${s.reason}` : ''}`);
}

async function main() {
  await assertArbitrumAnvilFork(RPC);
  const block = await pub.getBlock();
  log('fork', `${RPC} — anvil, chain 42161, block ${block.number}, time ${new Date(Number(block.timestamp) * 1000).toISOString()}`);

  const owner = privateKeyToAccount(generatePrivateKey());
  const agent = privateKeyToAccount((process.env.DELEGATE_PRIVATE_KEY as Hex | undefined) ?? generatePrivateKey());
  log('keys', `owner ${owner.address} (generated)\n   agent ${agent.address} (${process.env.DELEGATE_PRIVATE_KEY ? 'DELEGATE_PRIVATE_KEY' : 'generated'})`);
  console.log(`   uiFeeReceiver ${uiFeeReceiverFromEnv()}  referralCode ${referralCodeFromEnv()}`);

  const db = process.env.GMX_PROVE_DB === '1' ? await import('./venues/gmx/store.js') : undefined;

  // 1. Fund the owner.
  await topUpNative(RPC, owner.address, parseEther('1'));
  await dealErc20({ rpc: RPC, token: USDC, holder: owner.address, amount: parseUnits('1000', 6) });
  const usdc = () => pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [owner.address] });
  log('1. owner funded', `ETH ${formatEther(await pub.getBalance({ address: owner.address }))}, USDC ${formatUnits(await usdc(), 6)}`);

  // 2. Owner: approve USDC to the Router; register the agent with limits.
  log('2. owner approves USDC to GMX Router and registers the agent (maxAllowedCount 2, expires in 1h)');
  await send(owner, 'owner approve USDC → Router', buildCollateralApproval(USDC));
  const expiresAt = (await pub.getBlock()).timestamp + 3600n;
  await send(owner, 'owner SubaccountRouter.multicall(addSubaccount, setMaxAllowedCount=2, setExpiresAt, sendNativeToken)', buildSubaccountSetup({
    subaccount: agent.address,
    maxAllowedCount: 2n,
    expiresAt,
    fundSubaccountWei: parseEther('0.1'),
  }));
  const sub = await readSubaccount(pub, owner.address, agent.address);
  console.log(`   on-chain: active=${sub.active} max=${sub.maxAllowedCount} used=${sub.actionCount} expiresAt=${sub.expiresAt}; agent ETH ${formatEther(await pub.getBalance({ address: agent.address }))}`);

  // 3. Agent opens a $50-collateral 2x long ETH for the owner.
  const price = await rawPriceOf(TOKENS.WETH.address);
  const sizeDeltaUsd = COLLATERAL * 10n ** 24n * LEVERAGE; // USDC 6dp → USD 30dp, × leverage
  const openFee = await estimateExecutionFee(pub, { kind: 'increase' });
  const openReq = buildAgentOrder({
    account: owner.address,
    market: ETH_MARKET.marketToken,
    collateralToken: USDC,
    kind: 'increase',
    isLong: true,
    sizeDeltaUsd,
    collateralDeltaAmount: COLLATERAL,
    acceptablePrice: acceptablePrice(price, true, true, SLIPPAGE_BPS),
    executionFee: openFee.feeWei,
  });
  log('3. agent opens $50 × 2 long ETH/USD [ETH-USDC] for the owner',
    `GMX mark (tickers) $${(Number(price.max) / 1e12).toFixed(2)}; acceptable ≤ $${(Number(acceptablePrice(price, true, true, SLIPPAGE_BPS)) / 1e12).toFixed(2)}; execution fee ${formatEther(openFee.feeWei)} ETH (gasLimit ${openFee.gasLimit} × ${openFee.txGasPrice} wei)`);
  const usdcBeforeOpen = await usdc();
  const openTx = await send(agent, 'agent SubaccountRouter.multicall(sendWnt, createOrder MarketIncrease long)', openReq, openFee.txGasPrice);
  const openReceipt = await pub.getTransactionReceipt({ hash: openTx });
  const openKey = orderKeyFromReceipt(openReceipt);
  console.log(`   order key ${openKey}; owner USDC ${formatUnits(usdcBeforeOpen, 6)} → ${formatUnits(await usdc(), 6)} (pulled by the Router from the OWNER)`);
  if (db) await db.recordGmxOrder({ key: openKey, owner: owner.address, market: ETH_MARKET.marketToken, isLong: true, kind: 'increase', sizeUsd: 100, collateralUsd: 50, createdTx: openTx });

  // 4. Tracker: pending.
  log('4. tracker');
  const pendingOpen = await orderStatus(pub, openKey, { fromBlock: openReceipt.blockNumber });
  showState(pendingOpen);
  if (pendingOpen.status !== 'pending') throw new Error(`expected pending, got ${pendingOpen.status}`);
  if (pendingOpen.order?.account !== owner.address) throw new Error('the order is not the owner\'s');
  if (db) await db.applyGmxOrderState(pendingOpen);

  // 5. Fork keeper executes.
  log('5. fork keeper executes the open');
  const exec1 = await forkExecuteOrder({ rpc: RPC, key: openKey });
  console.log(`   ${exec1.label}`);
  console.log(`   keeper ${exec1.keeper}; providers ${exec1.providers.join(', ')}`);
  for (const p of exec1.prices) console.log(`   price ${p.symbol} $${p.usd.toFixed(4)} (${p.source})`);
  for (const f of exec1.refreshedFeeds) console.log(`   stale Chainlink feed ${f.symbol} ${f.feed} (${f.ageSeconds}s > ${f.heartbeat}s) refreshed: ${f.tx}`);
  console.log(`   tx fork-keeper setPrices: ${exec1.setPricesTx}\n   tx fork-keeper executeOrder: ${exec1.executeTx} → ${exec1.outcome}`);
  txs.push(['fork keeper setPrices (open)', exec1.setPricesTx], ['fork keeper executeOrder (open)', exec1.executeTx]);
  const afterOpen = await orderStatus(pub, openKey, { fromBlock: openReceipt.blockNumber });
  showState(afterOpen);
  if (afterOpen.status !== 'executed') throw new Error(`open order ${afterOpen.status}${afterOpen.reason ? `: ${afterOpen.reason}` : ''}`);
  if (db) await db.applyGmxOrderState(afterOpen);

  // 6. Position belongs to the owner.
  log('6. positions');
  const ownerPositions = await accountPositions(pub, owner.address);
  const agentPositions = await accountPositions(pub, agent.address);
  for (const p of ownerPositions) {
    console.log(`   OWNER ${p.account}: ${p.marketId} ${p.isLong ? 'long' : 'short'} size $${p.sizeUsd.toFixed(2)} (${formatUnits(p.sizeInTokens, 18)} ETH), collateral ${p.collateralAmount} ${p.collateralSymbol}, entry $${p.entryPrice?.toFixed(2)}`);
  }
  console.log(`   agent ${agent.address}: ${agentPositions.length} positions`);
  const pos = ownerPositions.find((p) => p.market === ETH_MARKET.marketToken && p.isLong);
  if (!pos || pos.account !== owner.address) throw new Error('no owner position after execution');
  if (agentPositions.length !== 0) throw new Error('the agent holds a position');

  // 7. Agent closes.
  const closePrice = await rawPriceOf(TOKENS.WETH.address);
  const closeFee = await estimateExecutionFee(pub, { kind: 'decrease' });
  log('7. agent closes the position (MarketDecrease, full size)',
    `acceptable ≥ $${(Number(acceptablePrice(closePrice, true, false, SLIPPAGE_BPS)) / 1e12).toFixed(2)}; execution fee ${formatEther(closeFee.feeWei)} ETH`);
  const closeTx = await send(agent, 'agent SubaccountRouter.multicall(sendWnt, createOrder MarketDecrease long)', buildAgentOrder({
    account: owner.address,
    market: ETH_MARKET.marketToken,
    collateralToken: USDC,
    kind: 'decrease',
    isLong: true,
    sizeDeltaUsd: pos.sizeInUsdRaw,
    collateralDeltaAmount: 0n,
    acceptablePrice: acceptablePrice(closePrice, true, false, SLIPPAGE_BPS),
    executionFee: closeFee.feeWei,
  }), closeFee.txGasPrice);
  const closeReceipt = await pub.getTransactionReceipt({ hash: closeTx });
  const closeKey = orderKeyFromReceipt(closeReceipt);
  if (db) await db.recordGmxOrder({ key: closeKey, owner: owner.address, market: ETH_MARKET.marketToken, isLong: true, kind: 'decrease', sizeUsd: pos.sizeUsd, collateralUsd: 0, createdTx: closeTx });
  showState(await orderStatus(pub, closeKey, { fromBlock: closeReceipt.blockNumber }));
  const usdcBeforeClose = await usdc();
  const exec2 = await forkExecuteOrder({ rpc: RPC, key: closeKey });
  console.log(`   tx fork-keeper setPrices: ${exec2.setPricesTx}\n   tx fork-keeper executeOrder: ${exec2.executeTx} → ${exec2.outcome}`);
  txs.push(['fork keeper setPrices (close)', exec2.setPricesTx], ['fork keeper executeOrder (close)', exec2.executeTx]);
  const afterClose = await orderStatus(pub, closeKey, { fromBlock: closeReceipt.blockNumber });
  showState(afterClose);
  if (afterClose.status !== 'executed') throw new Error(`close order ${afterClose.status}${afterClose.reason ? `: ${afterClose.reason}` : ''}`);
  if (db) await db.applyGmxOrderState(afterClose);
  const left = await accountPositions(pub, owner.address);
  console.log(`   owner positions now ${left.length}; owner USDC ${formatUnits(usdcBeforeClose, 6)} → ${formatUnits(await usdc(), 6)} (collateral ± PnL − fees, paid to the OWNER)`);
  if (left.length !== 0) throw new Error('position still open after close');

  // 8. Count used up.
  log('8. agent tries a third action (count 2 of 2 used)');
  const third = () => buildAgentOrder({
    account: owner.address,
    market: ETH_MARKET.marketToken,
    collateralToken: USDC,
    kind: 'increase',
    isLong: true,
    sizeDeltaUsd,
    collateralDeltaAmount: COLLATERAL,
    acceptablePrice: acceptablePrice(closePrice, true, true, SLIPPAGE_BPS),
    executionFee: openFee.feeWei,
  });
  const used = await readSubaccount(pub, owner.address, agent.address);
  console.log(`   on-chain: used=${used.actionCount} max=${used.maxAllowedCount}`);
  await expectRefusal(agent, 'third order', third(), 'MaxSubaccountActionCountExceeded');

  // 9. Expiry.
  const soon = (await pub.getBlock()).timestamp + 5n;
  log('9. owner raises the count to 10 but sets expiry 5 seconds out', `expiresAt ${soon}`);
  await send(owner, 'owner SubaccountRouter.multicall(setMaxAllowedCount=10, setExpiresAt=+5s)', {
    to: GMX.subaccountRouter,
    value: 0n,
    data: encodeFunctionData({
      abi: subaccountRouterAbi,
      functionName: 'multicall',
      args: [[
        encodeFunctionData({ abi: subaccountRouterAbi, functionName: 'setMaxAllowedSubaccountActionCount', args: [agent.address, KEYS.SUBACCOUNT_ORDER_ACTION, 10n] }),
        encodeFunctionData({ abi: subaccountRouterAbi, functionName: 'setSubaccountExpiresAt', args: [agent.address, KEYS.SUBACCOUNT_ORDER_ACTION, soon] }),
      ]],
    }),
  });
  for (;;) {
    const now = (await pub.getBlock()).timestamp;
    if (now > soon + 1n) break;
    await new Promise((r) => setTimeout(r, 2_000));
    // Anvil stamps the next block with wall-clock time; mining one moves 'latest' past the expiry without time travel.
    await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_mine', params: [] }) });
  }
  await expectRefusal(agent, 'order after expiry', third(), 'SubaccountApprovalExpired');

  // 10. Revoke.
  log('10. owner removes the agent');
  await send(owner, 'owner SubaccountRouter.removeSubaccount', buildRemoveSubaccount(agent.address));
  await expectRefusal(agent, 'order after removal', third(), 'SubaccountNotAuthorized');

  log('PASS — every transaction');
  for (const [label, hash] of txs) console.log(`   ${hash}  ${label}`);
  if (db) {
    const rows = await db.listGmxOrders(owner.address);
    console.log('\n   gmx_orders rows:');
    for (const r of rows) console.log(`   ${r.key} ${r.kind} ${r.status} size $${r.size_usd} created ${r.created_tx} executed ${r.executed_tx}`);
    const { pool } = await import('./db/index.js');
    await pool.end();
  }
}

main().catch((e) => {
  console.error('\nFAIL:', e instanceof Error ? e.message : e);
  if (e instanceof Error && e.cause) console.error(String((e.cause as Error).message ?? e.cause).split('\n').slice(0, 8).join('\n'));
  process.exit(1);
});
