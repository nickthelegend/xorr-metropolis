/**
 * GMX hedges through the product's own functions, on the hosted Arbitrum fork (2026-09-23): a fresh owner signs exactly
 * the setup `hedgeSetup` returns, then `openHedge` has the hedge agent's own wallet open a $25 × 2 short ETH for the
 * owner, the fork keeper executes it, the position is read back as the OWNER's, and `closeHedge` closes it.
 *
 * Run: set -a; . ./.env.arbitrum-fork; . ./.env.railway-arbitrum-fork; set +a; DATABASE_URL=... npx tsx src/venues/gmx/prove-hedge.ts
 */
import 'dotenv/config';
import { createWalletClient, erc20Abi, formatUnits, http, parseUnits, toHex, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { chain, rpcUrl } from '../../evm/chains.js';
import { publicClient } from '../../evm/client.js';
import { anvil, dealErc20 } from '../../fork/anvil.js';
import { TOKENS } from './constants.js';
import { accountPositions } from './tracker.js';
import { closeHedge, hedgeSetup, hedgerAddress, openHedge } from './actions.js';

const owner = privateKeyToAccount(generatePrivateKey());
await anvil(rpcUrl, 'anvil_setBalance', [owner.address, toHex(10n ** 18n)]);
await dealErc20({ rpc: rpcUrl, token: TOKENS.USDC.address as `0x${string}`, holder: owner.address, amount: parseUnits('500', 6) });
const w = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
console.log(`owner ${owner.address} (500 USDC); hedge agent wallet ${hedgerAddress()}`);

const setup = await hedgeSetup(owner.address);
for (const s of setup.toSign) {
  const h = await w.sendTransaction({ to: s.tx.to, data: s.tx.data as Hex, value: BigInt(s.tx.value) });
  await publicClient.waitForTransactionReceipt({ hash: h });
  console.log(`owner signed: ${s.label} — ${h}`);
}
const after = await hedgeSetup(owner.address);
console.log(`subaccount active=${after.subaccount.active} max=${after.subaccount.maxAllowedCount}; still to sign: ${after.toSign.length}`);

const open = await openHedge({ owner: owner.address, marketId: 'ETH-USD', isLong: false, collateralUsd: 25, leverage: 2 });
console.log(`open short: created ${open.createdTx} key ${open.key} → ${open.status}${open.executedTx ? ` (executed ${open.executedTx} by ${open.keeper})` : ''}${open.reason ? ` ${open.reason}` : ''}`);
const pos = await accountPositions(publicClient, owner.address);
for (const p of pos) console.log(`position OWNER ${p.account}: ${p.marketId} ${p.isLong ? 'long' : 'short'} $${p.sizeUsd.toFixed(2)} entry $${p.entryPrice?.toFixed(2)}`);
const agentPos = await accountPositions(publicClient, hedgerAddress());
console.log(`agent positions: ${agentPos.length}`);
const close = await closeHedge({ owner: owner.address, marketId: 'ETH-USD', isLong: false });
console.log(`close: created ${close.createdTx} → ${close.status}${close.executedTx ? ` (executed ${close.executedTx})` : ''}`);
const usdc = await publicClient.readContract({ address: TOKENS.USDC.address as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [owner.address] });
console.log(`owner USDC after: ${formatUnits(usdc, 6)}; open positions: ${(await accountPositions(publicClient, owner.address)).length}`);
const ok = open.status === 'executed' && close.status === 'executed' && pos.some((p) => !p.isLong) && agentPos.length === 0;
console.log(ok ? 'ALL CHECKS PASSED' : 'CHECKS FAILED');
process.exit(ok ? 0 : 1);
