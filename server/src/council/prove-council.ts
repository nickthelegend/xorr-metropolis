/**
 * The council, end to end on real inputs (PLAN.md P3, 2026-09-23).
 *
 * On the settlement chain named by XORR_CHAIN (a Robinhood Chain node): a fresh owner is given USDG and gas, signs a real
 * `XorrDelegation.grant` ($100/day for 7 days, venue = Uniswap's SwapRouter02) and gets a wallet row. Then three rounds are
 * convened on live data — Robinhood's session and quote, the stock's Chainlink rounds, the pool's quote, GMX funding and
 * open interest, and the owner's grant read back from the chain:
 *
 *   1. $50 of NVDA — within the cap;
 *   2. $500 of NVDA — over today's cap, which the Risk Keeper must veto;
 *   3. $50 of NVDA after the owner revokes on-chain — which the Risk Keeper must veto.
 *
 * Each round, its votes and reasons are printed as the database holds them. With COUNCIL_EXECUTE=1 the first round is
 * sent through the registered trade path (when one is registered); otherwise it is a dry run.
 *
 * Run: set -a; . ./.env.robinhood-fork; . ./.env.railway-robinhood-fork; set +a; DATABASE_URL=... npx tsx src/council/prove-council.ts
 */
import 'dotenv/config';
import { createWalletClient, erc20Abi, http, parseUnits, toHex, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { chain, rpcUrl, CHAIN_KEY, ADDRESSES } from '../evm/chains.js';
import { publicClient, delegateAccount } from '../evm/client.js';
import { DELEGATION_ABI } from '../evm/delegation.js';
import { anvil, dealErc20 } from '../fork/anvil.js';
import { one } from '../db/index.js';
import { convene, type CouncilRound } from './convene.js';

const DELEGATION = process.env.DELEGATION_ADDRESS as Address;
const SWAP_ROUTER: Address = '0xcaf681a66d020601342297493863e78c959e5cb2';

function show(title: string, r: CouncilRound) {
  console.log(`\n── ${title}: round ${r.id} — ${r.decision.toUpperCase()} (${r.summary}) outcome=${r.outcome}${r.txHash ? ` tx=${r.txHash}` : ''}`);
  for (const v of r.votes) console.log(`   ${v.persona.padEnd(13)} ${v.vote.padEnd(7)} ${v.confidence.toFixed(2)}  ${v.reason}`);
  if (r.outcomeDetail) console.log(`   outcome: ${r.outcomeDetail}`);
}

async function main() {
  if (!CHAIN_KEY.startsWith('robinhood')) throw new Error(`Run on a Robinhood Chain key; XORR_CHAIN=${CHAIN_KEY}`);
  const owner = privateKeyToAccount(generatePrivateKey());
  await anvil(rpcUrl, 'anvil_setBalance', [owner.address, toHex(10n ** 18n)]);
  await dealErc20({ rpc: rpcUrl, token: ADDRESSES.usdcBase, holder: owner.address, amount: parseUnits('1000', 6) });
  const w = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400);
  const approve = await w.writeContract({ address: ADDRESSES.usdcBase, abi: erc20Abi, functionName: 'approve', args: [DELEGATION, parseUnits('700', 6)] });
  await publicClient.waitForTransactionReceipt({ hash: approve });
  const grant = await w.writeContract({
    address: DELEGATION,
    abi: DELEGATION_ABI,
    functionName: 'grant',
    args: [delegateAccount.address, parseUnits('100', 6), expiresAt, [SWAP_ROUTER]],
  });
  await publicClient.waitForTransactionReceipt({ hash: grant });
  console.log(`owner ${owner.address}: 1000 USDG, approve ${approve}, grant $100/day × 7d to ${delegateAccount.address} ${grant}`);

  const wallet = await one<{ id: string }>(
    `INSERT INTO wallets (id, user_id, address, kind, cluster) VALUES ($1, $2, $3, 'embedded', $4) RETURNING id`,
    [`prove-council-${owner.address.toLowerCase()}`, `prove-council:${owner.address}`, owner.address, CHAIN_KEY],
  );
  if (!wallet) throw new Error('wallet row not written');
  const execute = process.env.COUNCIL_EXECUTE === '1';

  show('1. $50 NVDA', await convene({ walletId: wallet.id, owner: owner.address, proposal: { side: 'buy', symbol: 'NVDA', usd: 50 }, convenedBy: 'prove', dryRun: !execute }));
  show('2. $500 NVDA', await convene({ walletId: wallet.id, owner: owner.address, proposal: { side: 'buy', symbol: 'NVDA', usd: 500 }, convenedBy: 'prove', dryRun: true }));
  const revoke = await w.writeContract({ address: DELEGATION, abi: DELEGATION_ABI, functionName: 'revoke' });
  await publicClient.waitForTransactionReceipt({ hash: revoke });
  console.log(`\nowner revoked on-chain: ${revoke}`);
  show('3. $50 NVDA after revoke', await convene({ walletId: wallet.id, owner: owner.address, proposal: { side: 'buy', symbol: 'NVDA', usd: 50 }, convenedBy: 'prove', dryRun: true }));
  process.exit(0);
}

await main();
