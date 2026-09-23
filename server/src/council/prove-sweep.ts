/**
 * The agents' council sweep, once, on real inputs (2026-09-23). A fresh owner on the Robinhood node gets USDG, signs a
 * real grant (and the approvals the trade path needs), hires Momentum Scout; then one `councilSweep` tick runs and the
 * resulting round — proposal, votes, decision, tx hash — is printed from the database.
 *
 * Run: set -a; . ./.env.robinhood-fork; . ./.env.railway-robinhood-fork; set +a; DATABASE_URL=... npx tsx src/council/prove-sweep.ts
 */
import 'dotenv/config';
import { createWalletClient, erc20Abi, http, maxUint256, parseUnits, toHex, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { chain, rpcUrl, ADDRESSES } from '../evm/chains.js';
import { publicClient, delegateAccount } from '../evm/client.js';
import { DELEGATION_ABI } from '../evm/delegation.js';
import { anvil, dealErc20 } from '../fork/anvil.js';
import { query } from '../db/index.js';
import { councilSweep } from './sweep.js';
import { roundsFor, setCouncilExecutor } from './convene.js';
import { councilExecutor } from '../executor/council-executor.js';

// The executor registers its trade path at boot (index.ts); a standalone run registers the same one.
setCouncilExecutor(councilExecutor);

const DELEGATION = process.env.DELEGATION_ADDRESS as Address;
const SWAP_ROUTER: Address = '0xcaf681a66d020601342297493863e78c959e5cb2';

const owner = privateKeyToAccount(generatePrivateKey());
await anvil(rpcUrl, 'anvil_setBalance', [owner.address, toHex(10n ** 18n)]);
await dealErc20({ rpc: rpcUrl, token: ADDRESSES.usdcBase, holder: owner.address, amount: parseUnits('1000', 6) });
const w = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
const wait = (hash: `0x${string}`) => publicClient.waitForTransactionReceipt({ hash });
await wait(await w.writeContract({ address: ADDRESSES.usdcBase, abi: erc20Abi, functionName: 'approve', args: [DELEGATION, maxUint256] }));
const grant = await w.writeContract({
  address: DELEGATION,
  abi: DELEGATION_ABI,
  functionName: 'grant',
  args: [delegateAccount.address, parseUnits('200', 6), BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400), [SWAP_ROUTER]],
});
await wait(grant);
const walletId = `prove-sweep-${owner.address.toLowerCase()}`;
await query(`INSERT INTO wallets (id, user_id, address, kind, cluster) VALUES ($1, $2, $3, 'embedded', 'robinhood-fork')`, [walletId, `prove-sweep:${owner.address}`, owner.address]);
await query(`INSERT INTO agents (id, wallet_id, persona_id, name) VALUES ($1, $2, 'momentum-scout', 'Momentum Scout')`, [`${walletId}-ms`, walletId]);
console.log(`owner ${owner.address}: $200/day grant ${grant}; Momentum Scout hired`);

const executed = await councilSweep();
console.log(`sweep executed ${executed} trade(s)`);
for (const r of await roundsFor(walletId)) {
  console.log(`round ${r.id} ${r.convenedBy}: ${r.proposal.side} $${r.proposal.usd} ${r.proposal.symbol} → ${r.decision} (${r.summary}) outcome=${r.outcome} ${r.txHash ?? ''}`);
  for (const v of r.votes) console.log(`   ${v.persona.padEnd(13)} ${v.vote.padEnd(7)} ${v.reason}`);
  if (r.outcomeDetail) console.log(`   ${r.outcomeDetail}`);
}

process.exit(0);
