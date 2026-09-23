/**
 * Individual agents, end to end on the hosted Robinhood node (2026-09-23).
 *
 *   1. A fresh owner, funded with USDG and gas, approves the delegation and signs:
 *        grant(desk, $100/day, 7d, [SwapRouter02])            — the onboarding permission (the owner's own orders);
 *        grantAgent(Momentum Scout's wallet, $200/day, 7d)    — each agent its own permission, cap and end date;
 *        grantAgent(Earnings Desk's wallet,  $150/day, 7d)
 *        grantAgent(Yield Keeper's wallet,   $100/day, 3d)
 *      and hires the three agents.
 *   2. One `councilSweep` tick: each agent proposes from its own strategy, the council votes, and each approved round is
 *      executed SIGNED BY THAT AGENT'S OWN WALLET. For every trade, the receipt's `from` and the `Spent` event's
 *      `delegate` are checked against the agent, and each agent's own daily tally is read back from the chain.
 *   3. The owner revokes one agent: that agent's next spend is refused on-chain (PolicyRevoked) while another agent still
 *      trades. Then the owner stops every agent at once: every agent is refused.
 *
 * Run: set -a; . ./.env.robinhood-fork.v2; . ./.env.railway-robinhood-fork; set +a; DATABASE_URL=... npx tsx src/council/prove-agents.ts
 */
import 'dotenv/config';
import { createWalletClient, decodeEventLog, erc20Abi, formatUnits, http, maxUint256, parseAbi, parseUnits, toHex, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { chain, rpcUrl, ADDRESSES } from '../evm/chains.js';
import { publicClient, delegateAccount } from '../evm/client.js';
import { DELEGATION_ABI } from '../evm/delegation.js';
import { agentActor, agentAddress, ensureAgentGas } from '../evm/agents.js';
import { anvil, dealErc20 } from '../fork/anvil.js';
import { query } from '../db/index.js';
import { councilSweep } from './sweep.js';
import { roundsFor, setCouncilExecutor } from './convene.js';
import { councilExecutor } from '../executor/council-executor.js';

setCouncilExecutor(councilExecutor);
const DELEGATION = process.env.DELEGATION_ADDRESS as Address;
const ROUTER: Address = '0xcaf681a66d020601342297493863e78c959e5cb2';
const STOCKS: Record<string, Address> = {
  NVDA: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC',
  TSLA: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d',
  AAPL: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9',
  SPY: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C',
};
const spentEvent = parseAbi(['event Spent(address indexed owner, address indexed delegate, address indexed venue, address token, uint256 amount, uint256 spentToday)']);
const HIRED = [
  { id: 'momentum-scout', name: 'Momentum Scout', cap: 200, days: 7 },
  { id: 'earnings-desk', name: 'Earnings Desk', cap: 150, days: 7 },
  { id: 'yield-keeper', name: 'Yield Keeper', cap: 100, days: 3 },
] as const;
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures++;
};

const owner = privateKeyToAccount(generatePrivateKey());
const w = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
const wait = (hash: Hex) => publicClient.waitForTransactionReceipt({ hash });
const day = (d: number) => BigInt(Math.floor(Date.now() / 1000) + d * 86_400);

await anvil(rpcUrl, 'anvil_setBalance', [owner.address, toHex(10n ** 18n)]);
await dealErc20({ rpc: rpcUrl, token: ADDRESSES.usdcBase, holder: owner.address, amount: parseUnits('2000', 6) });
await wait(await w.writeContract({ address: ADDRESSES.usdcBase, abi: erc20Abi, functionName: 'approve', args: [DELEGATION, maxUint256] }));
for (const t of Object.values(STOCKS)) await wait(await w.writeContract({ address: t, abi: erc20Abi, functionName: 'approve', args: [DELEGATION, maxUint256] }));
const deskGrant = await w.writeContract({ address: DELEGATION, abi: DELEGATION_ABI, functionName: 'grant', args: [delegateAccount.address, parseUnits('100', 6), day(7), [ROUTER]] });
await wait(deskGrant);
console.log(`owner ${owner.address} — 2,000 USDG; desk grant ${deskGrant}`);
for (const a of HIRED) {
  const h = await w.writeContract({ address: DELEGATION, abi: DELEGATION_ABI, functionName: 'grantAgent', args: [agentAddress(a.id), parseUnits(String(a.cap), 6), day(a.days)] });
  await wait(h);
  console.log(`   ${a.name.padEnd(15)} wallet ${agentAddress(a.id)}  grantAgent $${a.cap}/day × ${a.days}d  ${h}`);
}
const agentsOnChain = (await publicClient.readContract({ address: DELEGATION, abi: DELEGATION_ABI, functionName: 'agentsOf', args: [owner.address] })) as Address[];
check(agentsOnChain.length === 4, `agentsOf(owner) lists the desk and three agents (${agentsOnChain.length})`);

const walletId = `prove-agents-${owner.address.toLowerCase()}`;
await query(`INSERT INTO wallets (id, user_id, address, kind, cluster) VALUES ($1, $2, $3, 'embedded', 'robinhood-fork')`, [walletId, `prove-agents:${owner.address}`, owner.address]);
for (const a of HIRED) await query(`INSERT INTO agents (id, wallet_id, persona_id, name) VALUES ($1, $2, $3, $4)`, [`${walletId}-${a.id}`, walletId, a.id, a.name]);

console.log('\n── one scheduler tick: every hired agent takes its turn');
const executed = await councilSweep();
console.log(`   ${executed} trade(s) executed`);
const rounds = await roundsFor(walletId);
for (const r of rounds.reverse()) {
  const agentId = r.convenedBy.replace(/^agent:/, '');
  console.log(`\n   ${agentId}: ${r.proposal.side} $${r.proposal.usd} ${r.proposal.symbol} → ${r.decision} (${r.summary}) ${r.outcome}${r.txHash ? ` ${r.txHash}` : ''}`);
  if (r.outcomeDetail) console.log(`     ${r.outcomeDetail}`);
  if (r.outcome !== 'executed' || !r.txHash) continue;
  const receipt = await publicClient.getTransactionReceipt({ hash: r.txHash as Hex });
  check(receipt.from.toLowerCase() === agentAddress(agentId).toLowerCase(), `signed by ${agentId}'s own wallet (${receipt.from})`);
  const spent = receipt.logs
    .filter((l) => l.address.toLowerCase() === DELEGATION.toLowerCase())
    .map((l) => { try { return decodeEventLog({ abi: spentEvent, data: l.data, topics: l.topics }); } catch { return null; } })
    .find((e) => e?.eventName === 'Spent');
  check(spent?.args.delegate.toLowerCase() === agentAddress(agentId).toLowerCase(), `Spent event names ${agentId} as the agent`);
  const bal = await publicClient.readContract({ address: STOCKS[r.proposal.symbol]!, abi: erc20Abi, functionName: 'balanceOf', args: [owner.address] });
  check(bal > 0n, `${r.proposal.symbol} landed in the OWNER's wallet (${formatUnits(bal, 18)})`);
}

console.log('\n── each agent\'s own tally, from the chain');
for (const a of HIRED) {
  const spentBy = (await publicClient.readContract({ address: DELEGATION, abi: DELEGATION_ABI, functionName: 'spentTodayBy', args: [owner.address, agentAddress(a.id)] })) as bigint;
  const left = (await publicClient.readContract({ address: DELEGATION, abi: DELEGATION_ABI, functionName: 'remainingTodayFor', args: [owner.address, agentAddress(a.id)] })) as bigint;
  console.log(`   ${a.name.padEnd(15)} spent $${formatUnits(spentBy, 6)} of $${a.cap}; $${formatUnits(left, 6)} left`);
}

/** Try a $5 buy of SPY as `agentId`, straight at the contract, and name the refusal. */
async function tryAsAgent(agentId: string): Promise<string> {
  await ensureAgentGas(agentId);
  const actor = agentActor(agentId);
  try {
    await publicClient.simulateContract({
      account: actor.account,
      address: DELEGATION,
      abi: DELEGATION_ABI,
      functionName: 'spend',
      args: [owner.address, ADDRESSES.usdcBase, ROUTER, parseUnits('5', 6), STOCKS.SPY!, 1n, '0x'],
    });
    return 'allowed';
  } catch (e) {
    const m = (e as Error).message.match(/(PolicyRevoked|NotDelegate|PolicyExpired|DailyCapExceeded|VenueCallFailed|[A-Z][A-Za-z]+\(\))/);
    return m?.[1] ?? (e as Error).message.slice(0, 120);
  }
}

console.log('\n── revoke one agent');
const revokeOne = await w.writeContract({ address: DELEGATION, abi: DELEGATION_ABI, functionName: 'revokeAgent', args: [agentAddress('yield-keeper')] });
await wait(revokeOne);
console.log(`   owner revokeAgent(Yield Keeper) ${revokeOne}`);
const yk = await tryAsAgent('yield-keeper');
const ms = await tryAsAgent('momentum-scout');
check(yk === 'PolicyRevoked', `Yield Keeper refused on-chain: ${yk}`);
check(ms !== 'PolicyRevoked' && ms !== 'NotDelegate', `Momentum Scout still has its permission (its call reaches the venue: ${ms})`);

console.log('\n── stop every agent at once');
const stopAll = await w.writeContract({ address: DELEGATION, abi: DELEGATION_ABI, functionName: 'revoke' });
await wait(stopAll);
console.log(`   owner revoke() ${stopAll}`);
for (const a of HIRED) {
  const r = await tryAsAgent(a.id);
  check(r === 'PolicyRevoked', `${a.name} refused on-chain: ${r}`);
}
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
