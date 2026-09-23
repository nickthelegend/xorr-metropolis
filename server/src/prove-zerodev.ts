/**
 * ZeroDev session keys on an Arbitrum One fork, end to end (PLAN.md P6.3, 2026-09-23).
 *
 *   FORK_RPC=http://127.0.0.1:8548 npx tsx server/src/prove-zerodev.ts
 *   FORK_RPC=https://arbitrum-fork-production.up.railway.app npx tsx server/src/prove-zerodev.ts
 *
 * Every key is generated fresh, so each run gets a new Kernel account and nothing depends on earlier runs. No ZeroDev
 * project is needed: this process is the bundler (`server/src/aa/bundle.ts`) and calls EntryPoint.handleOps itself; it
 * refuses any node that is not anvil. A refused operation is simulated (to decode the EntryPoint's reason) and then sent
 * anyway with a fixed gas limit, so every refusal is also a mined, reverted transaction with a hash.
 *
 * What it shows, in order — one Kernel v3.1 account, three agent keys:
 *
 *   1. The owner's first user operation (sudo, ECDSA) deploys the Kernel account.
 *   2. The account is given 200 USDC (fork storage write) and nothing else — no WETH.
 *   3. Agent A — owner signs the Enable of A's permission (cap 25 USDC/trade, 5 per day, 6 h expiry).
 *      a. A buys WETH with 20 USDC via SwapRouter02; the same operation installs the permission (enable mode). WETH lands
 *         in the Kernel account.
 *      b. A swaps with recipient = A's own address                       → refused by CallPolicy.
 *      c. A swaps 30 USDC (> 25 cap)                                     → refused by CallPolicy.
 *      d. A tries USDC.transfer to itself (a call it was never granted)  → refused by CallPolicy.
 *      e. A trades four more times (5 in the day), then a 6th            → refused by RateLimitPolicy.
 *   4. Agent C — a permission that expires 120 s from now: one trade passes; the fork's clock moves 180 s; the next
 *      trade is refused by TimestampPolicy (EntryPoint "AA22 expired or not due").
 *   5. Agent B — a fresh permission: one trade passes; the owner uninstalls it (one owner-signed user operation); B is
 *      refused both ways it could try — default mode (validator gone) and replaying the owner's Enable signature from the
 *      approval the backend still holds.
 */
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
  type LocalAccount,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arbitrum } from 'viem/chains';
import { sendUserOp, type BundleResult, type Call } from './aa/bundle.js';
import {
  AA_ADDRESSES,
  ARB,
  agentAccount,
  buyWethCalls,
  grantSessionKey,
  ownerKernelAccount,
  permissionState,
  type Granted,
  type SessionGrant,
} from './aa/kernel.js';
import { revokePermission } from './aa/revoke.js';
import { anvil, dealErc20, topUpNative } from './fork/anvil.js';

const RPC = process.env.FORK_RPC ?? 'http://127.0.0.1:8548';
const chain = { ...arbitrum, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC, { timeout: 60_000 }), cacheTime: 0 });

const node = await pub.request({ method: 'web3_clientVersion' });
if (!/^anvil\//i.test(String(node))) throw new Error(`${RPC} answers as "${node}", not anvil; this proof runs only on a fork`);
if ((await pub.getChainId()) !== 42161) throw new Error(`${RPC} is not a fork of Arbitrum One (chain id 42161)`);
if (process.env.BUNDLER_RPC) throw new Error('Unset BUNDLER_RPC: this proof self-bundles on the fork');

const USDC = (n: number) => BigInt(Math.round(n * 1e6));
const POLICY_NAMES = ['CallPolicy', 'RateLimitPolicy', 'TimestampPolicy'];
const quoterAbi = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);

const owner = privateKeyToAccount(generatePrivateKey());
const bundler = privateKeyToAccount(generatePrivateKey());
const agentA = privateKeyToAccount(generatePrivateKey());
const agentB = privateKeyToAccount(generatePrivateKey());
const agentC = privateKeyToAccount(generatePrivateKey());

let failures = 0;
const line = (s = '') => console.log(s);
const check = (ok: boolean, what: string) => {
  if (!ok) failures++;
  line(`   ${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

/** "PolicyFailed(1)" → "PolicyFailed(1) = RateLimitPolicy". */
const namePolicy = (s: string | undefined) =>
  (s ?? '').replace(/PolicyFailed\((\d+)\)/, (m, i: string) => `${m} = ${POLICY_NAMES[Number(i)] ?? `policy #${i}`}`);

function show(label: string, r: BundleResult) {
  line(`   ${label}`);
  line(`     userOpHash ${r.userOpHash}`);
  if (r.txHash) line(`     tx         ${r.txHash}`);
  if (r.success) line(`     included, success${r.actualGasCost !== undefined ? `, gas cost ${formatEther(r.actualGasCost)} ETH` : ''}`);
  if (r.refusal) line(`     refused:   ${namePolicy(r.refusal)}`);
  if (r.executionRevert) line(`     execution reverted: ${r.executionRevert}`);
}

const balances = async (who: Address) => {
  const [usdc, weth] = await Promise.all([
    pub.readContract({ address: ARB.USDC, abi: erc20Abi, functionName: 'balanceOf', args: [who] }),
    pub.readContract({ address: ARB.WETH, abi: erc20Abi, functionName: 'balanceOf', args: [who] }),
  ]);
  return { usdc, weth };
};

async function quote(amountIn: bigint): Promise<bigint> {
  const { result } = await pub.simulateContract({
    address: ARB.QuoterV2,
    abi: quoterAbi,
    functionName: 'quoteExactInputSingle',
    args: [{ tokenIn: ARB.USDC, tokenOut: ARB.WETH, amountIn, fee: 500, sqrtPriceLimitX96: 0n }],
  });
  return result[0];
}

/** A capped buy with a 1% slippage floor from QuoterV2. */
async function buy(amountIn: bigint, recipient: Address): Promise<Call[]> {
  return buyWethCalls({ amountIn, recipient, fee: 500, amountOutMinimum: ((await quote(amountIn)) * 99n) / 100n });
}

/** The agent's operation, deserialized fresh from the approval each time — as the backend would per job. */
async function asAgent(approval: string, key: LocalAccount, calls: Call[], submitRefused = true) {
  const account = await agentAccount(pub, approval, key);
  return sendUserOp({ client: pub, chain, account, calls, bundler, submitRefused });
}

const blockTime = async () => Number((await pub.getBlock()).timestamp);

async function grant(agent: LocalAccount, extra: Partial<SessionGrant> = {}): Promise<Granted> {
  const g: SessionGrant = {
    sessionKeyAddress: agent.address,
    perTradeCapUsdc: USDC(25),
    tradesPerDay: 5,
    expiresAt: (await blockTime()) + 6 * 3600,
    ...extra,
  };
  const granted = await grantSessionKey(pub, owner, g);
  const params = JSON.parse(Buffer.from(granted.approval, 'base64').toString()) as { enableSignature?: Hex };
  line(`   owner signed Enable for agent ${agent.address}`);
  line(`     permissionId ${granted.permissionId}  cap ${formatUnits(g.perTradeCapUsdc, 6)} USDC/trade, ${g.tradesPerDay}/day, expires ${new Date(g.expiresAt * 1000).toISOString()}`);
  line(`     enable signature ${params.enableSignature?.slice(0, 26)}…  (approval: ${granted.approval.length} chars, no key inside)`);
  return granted;
}

line(`ZeroDev session keys on ${RPC} (${node}, chain 42161)`);
line(`   owner ${owner.address}   bundler ${bundler.address}`);
line(`   EntryPoint ${AA_ADDRESSES.entryPoint}   Kernel factory ${AA_ADDRESSES.kernelFactory} (v0.3.1)`);
await topUpNative(RPC, bundler.address, parseEther('10'));

// 1. Deploy
line('\n1. Owner deploys the Kernel account (sudo validator = owner ECDSA)');
const ownerAccount = await ownerKernelAccount(pub, owner);
const kernel = ownerAccount.address;
line(`   Kernel account ${kernel} (code before: ${(await pub.getCode({ address: kernel })) ?? 'none'})`);
await topUpNative(RPC, kernel, parseEther('0.05')); // prefund for self-paid gas (no paymaster)
const deploy = await sendUserOp({ client: pub, chain, account: ownerAccount, calls: [{ to: owner.address, value: 0n, data: '0x' }], bundler });
show('owner op: deploy', deploy);
check(deploy.success && ((await pub.getCode({ address: kernel })) ?? '0x').length > 2, 'Kernel account deployed');

// 2. Fund
line('\n2. Fund the Kernel account with 200 USDC');
await dealErc20({ rpc: RPC, token: ARB.USDC, holder: kernel, amount: USDC(200) });
let bal = await balances(kernel);
line(`   Kernel holds ${formatUnits(bal.usdc, 6)} USDC, ${formatEther(bal.weth)} WETH`);
check(bal.usdc === USDC(200) && bal.weth === 0n, 'funded with USDC only');

// 3. Agent A
line('\n3. Agent A');
const gA = await grant(agentA);
line('\n3a. A buys WETH with 20 USDC (first op: enable mode installs the permission)');
const tA1 = await asAgent(gA.approval, agentA, await buy(USDC(20), kernel));
show('agent op: approve 20 USDC + exactInputSingle 20 USDC → WETH, recipient = Kernel', tA1);
const bal1 = await balances(kernel);
line(`   Kernel now ${formatUnits(bal1.usdc, 6)} USDC, ${formatEther(bal1.weth)} WETH; agent A holds ${formatEther((await balances(agentA.address)).weth)} WETH`);
check(tA1.success && bal1.usdc === USDC(180) && bal1.weth > 0n, 'swap passed; WETH landed in the Kernel account');
const stA = await permissionState(pub, kernel, gA.permissionId);
line(`   on-chain: permission ${gA.permissionId} signer ${stA.signer}, validation nonce ${stA.validationNonce}, account currentNonce ${stA.currentNonce}`);
check(stA.installed, 'permission installed on-chain by the enable-mode op');

line('\n3b. A swaps with recipient = A itself');
const tA2 = await asAgent(gA.approval, agentA, await buy(USDC(20), agentA.address));
show('agent op: exactInputSingle 20 USDC, recipient = agent', tA2);
check(!tA2.success && /CallViolatesParamRule/.test(tA2.refusal ?? ''), 'refused by CallPolicy (recipient rule)');

line('\n3c. A swaps 30 USDC (cap 25)');
const tA3 = await asAgent(gA.approval, agentA, await buy(USDC(30), kernel));
show('agent op: approve 30 + exactInputSingle 30 USDC', tA3);
check(!tA3.success && /CallViolatesParamRule/.test(tA3.refusal ?? ''), 'refused by CallPolicy (amount rule)');

line('\n3d. A calls USDC.transfer(A, 20 USDC) — never granted');
const tA4 = await asAgent(gA.approval, agentA, [
  { to: ARB.USDC, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [agentA.address, USDC(20)] }) },
]);
show('agent op: USDC.transfer to agent', tA4);
check(!tA4.success && /CallViolates/.test(tA4.refusal ?? ''), 'refused by CallPolicy (no permission for transfer)');

line('\n3e. A trades up to the daily limit (5), then once more');
for (let i = 2; i <= 5; i++) {
  const t = await asAgent(gA.approval, agentA, await buy(USDC(5), kernel));
  show(`agent op: trade ${i}/5, 5 USDC → WETH`, t);
  check(t.success, `trade ${i} of 5 passed`);
}
const tA6 = await asAgent(gA.approval, agentA, await buy(USDC(5), kernel));
show('agent op: trade 6, 5 USDC → WETH', tA6);
check(!tA6.success && /PolicyFailed\(1\)/.test(tA6.refusal ?? ''), 'refused by RateLimitPolicy');
bal = await balances(kernel);
line(`   Kernel now ${formatUnits(bal.usdc, 6)} USDC, ${formatEther(bal.weth)} WETH`);
check(bal.usdc === USDC(160), 'exactly 20 + 4×5 USDC spent; nothing from refused ops');

// 4. Agent C — expiry
line('\n4. Agent C — permission expiring in 120 s');
const gC = await grant(agentC, { expiresAt: (await blockTime()) + 120 });
const tC1 = await asAgent(gC.approval, agentC, await buy(USDC(5), kernel));
show('agent op: 5 USDC → WETH before expiry', tC1);
check(tC1.success, 'trade before expiry passed');
await anvil(RPC, 'evm_increaseTime', [180]);
await anvil(RPC, 'evm_mine', []);
line(`   fork clock moved +180 s (block time now ${new Date((await blockTime()) * 1000).toISOString()})`);
const tC2 = await asAgent(gC.approval, agentC, await buy(USDC(5), kernel));
show('agent op: 5 USDC → WETH after expiry', tC2);
check(!tC2.success && /AA22 expired/.test(tC2.refusal ?? ''), 'refused by TimestampPolicy (validUntil passed)');

// 5. Agent B — revoke
line('\n5. Agent B — owner uninstalls the permission');
const gB = await grant(agentB);
const tB1 = await asAgent(gB.approval, agentB, await buy(USDC(5), kernel));
show('agent op: 5 USDC → WETH while granted', tB1);
check(tB1.success, 'trade while granted passed');
const agentBCached = await agentAccount(pub, gB.approval, agentB); // an account object that already knows it is enabled
await agentBCached.getNonce();
const rev = await revokePermission({ client: pub, chain, owner, approval: gB.approval, sessionKeyAddress: agentB.address, bundler });
show('owner op: uninstallValidation(permission B)', rev);
const stB = await permissionState(pub, kernel, gB.permissionId);
line(`   on-chain: permission ${gB.permissionId} signer ${stB.signer}; account currentNonce ${stB.currentNonce}, validNonceFrom ${stB.validNonceFrom}`);
check(rev.success && !stB.installed, 'permission B uninstalled');
const tB2 = await sendUserOp({ client: pub, chain, account: agentBCached, calls: await buy(USDC(5), kernel), bundler, submitRefused: true });
show('agent op (default mode, validator assumed installed): 5 USDC → WETH', tB2);
line('     (Kernel.validateUserOp reverts before any policy runs: the permission\'s signer slot is address(0) after uninstall)');
check(!tB2.success && !!tB2.refusal, 'refused after uninstall (default mode)');
const tB3 = await asAgent(gB.approval, agentB, await buy(USDC(5), kernel));
show('agent op (enable mode, replaying the owner Enable signature): 5 USDC → WETH', tB3);
check(!tB3.success && !!tB3.refusal, 'refused after uninstall (enable-signature replay)');

const stA2 = await permissionState(pub, kernel, gA.permissionId);
line(`   agent A's permission after B's revoke: ${stA2.installed ? 'still installed' : 'gone'}`);
check(stA2.installed, 'revoking B leaves A untouched');

bal = await balances(kernel);
line(`\nKernel ${kernel} ends with ${formatUnits(bal.usdc, 6)} USDC and ${formatEther(bal.weth)} WETH.`);
line(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

