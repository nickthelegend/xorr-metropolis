/**
 * Stand up a demo-ready fork of Monad, Arbitrum One or Robinhood Chain (XORR_CHAIN=monad-fork | arbitrum-fork |
 * robinhood-fork) in one command (PLAN.md P0.5).
 *
 * A fork of a mainnet is the only environment where every piece of this product is real at once with no real money:
 * Circle's USDC and the venues and pools it trades in all exist there with their real state. But a fresh fork has none
 * of OUR contracts and no spendable balance, so this:
 *
 *   1. checks the node is anvil forking the chain XORR_CHAIN names (143 for Monad),
 *   2. deploys `XorrDelegation` (settlement token = the chain's USDC, or USDG on Robinhood) and `XorrAuditAnchor`
 *      from a fresh key,
 *   3. gives the delegate key the chain's gas token (MON on Monad, ETH elsewhere),
 *   4. funds the wallet to demo with — `argv[2]` or `OWNER_ADDRESS` — with 25,000 USDC and gas,
 *   5. writes the addresses to `.env.fork` (or `FORK_ENV_FILE`).
 *
 * The USDC is Circle's own token, sent in an ordinary transfer from a fork-only reserve whose balance is written to the
 * token's storage (`fork/anvil.ts`, the technique of Foundry's `deal`) — taking it from a pool would move the prices the
 * demo trades against. Nothing is mocked.
 *
 * Run:  cd server && npx tsx src/fork-bootstrap-evm.ts [walletAddressToFund]
 * Needs: `forge build` first (it deploys from contracts/out), and anvil forking the chain:
 *        anvil --fork-url https://rpc.monad.xyz --chain-id 143      (or infra/monad-fork/entrypoint.sh)
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseEther,
  parseUnits,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { CHAIN_KEY, chain as registryChain, ADDRESSES, SETTLEMENT_SYMBOL } from './evm/chains.js';
import { FORK_USDC_RESERVE, anvil, dealErc20 } from './fork/anvil.js';
import { deployKuruVenue } from './fork/kuru-venue.js';

const RPC = process.env.FORK_RPC ?? 'http://127.0.0.1:8545';
/**
 * The settlement token of the fork named by XORR_CHAIN: Circle's native USDC on an Arbitrum fork, Paxos USDG on a
 * Robinhood Chain fork. Read from the registry so the contract, the executor and this script cannot disagree.
 */
if (!CHAIN_KEY.endsWith('-fork')) throw new Error(`XORR_CHAIN=${CHAIN_KEY} is not a fork key (monad-fork, arbitrum-fork, robinhood-fork).`);
const USDC: Address = ADDRESSES.usdcBase;
const DEMO_USDC = parseUnits('25000', 6);
const GAS_ETH = parseEther('10');
/** The gas token by name: MON on Monad, ETH on the others. Read from viem's chain so it cannot drift. */
const GAS = registryChain.nativeCurrency.symbol;

const chain = { ...registryChain, rpcUrls: { default: { http: [RPC] }, public: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
/**
 * A fork pulls state from the chain's public RPC the first time a transaction touches it, and that RPC rate-limits: a
 * deploy can wait on its upstream for minutes. Anvil mines on arrival, so a slow receipt is a slow upstream, not a lost
 * transaction — wait for it rather than failing at viem's default.
 */
const RECEIPT = { timeout: 600_000, pollingInterval: 1_000 } as const;

async function artifact(name: string): Promise<{ abi: unknown[]; bytecode: Hex }> {
  const file = new URL(`../../contracts/out/${name}.sol/${name}.json`, import.meta.url);
  const json = JSON.parse(await fs.readFile(file, 'utf8')) as { abi: unknown[]; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

async function main() {
  const asked = process.argv[2] ?? process.env.OWNER_ADDRESS;
  if (asked && !isAddress(asked)) throw new Error(`${asked} is not an address.`);
  const fundTarget = asked ? getAddress(asked) : undefined;
  if (!fundTarget) {
    console.log(
      'No wallet to fund. Pass one as an argument or set OWNER_ADDRESS; the contracts will still deploy,\n' +
        'but nothing will be able to trade on this fork.\n',
    );
  }

  const node = String(await anvil(RPC, 'web3_clientVersion', []));
  if (!/^anvil\//i.test(node)) throw new Error(`${RPC} answers as "${node}", not anvil. This only bootstraps a fork.`);
  const id = await pub.getChainId();
  if (id !== registryChain.id) {
    throw new Error(`${RPC} is chain ${id}, not ${registryChain.name} (${registryChain.id}).`);
  }
  const code = await pub.getCode({ address: USDC });
  if (!code || code === '0x') throw new Error(`No ${SETTLEMENT_SYMBOL} contract at ${USDC} on this node — it is not a fork of ${registryChain.name}.`);
  console.log(`fork ${RPC}  chain ${id}  block ${await pub.getBlockNumber()}\n`);

  // A fresh key per bootstrap — never anvil's well-known accounts, whose keys are public.
  const deployer = privateKeyToAccount(generatePrivateKey());
  await anvil(RPC, 'anvil_setBalance', [deployer.address, toHex(GAS_ETH)]);
  const wallet = createWalletClient({ account: deployer, chain, transport: http(RPC) });

  const delegationArt = await artifact('XorrDelegation');
  const delegationHash = await wallet.deployContract({
    abi: delegationArt.abi as never,
    bytecode: delegationArt.bytecode,
    // The settlement token: what the daily cap is counted in, and what a close may not sell.
    args: [USDC] as never,
  });
  const delegation = (await pub.waitForTransactionReceipt({ hash: delegationHash, ...RECEIPT })).contractAddress as Address;
  console.log(`XorrDelegation   ${delegation}`);

  const anchorArt = await artifact('XorrAuditAnchor');
  const anchorHash = await wallet.deployContract({ abi: anchorArt.abi as never, bytecode: anchorArt.bytecode } as never);
  const anchor = (await pub.waitForTransactionReceipt({ hash: anchorHash, ...RECEIPT })).contractAddress as Address;
  console.log(`XorrAuditAnchor  ${anchor}`);

  // Kuru on a Monad fork: the adapter that lets the delegation fill on Kuru's book (`contracts/src/KuruVenue.sol`).
  const kuruVenue = CHAIN_KEY === 'monad-fork' ? await deployKuruVenue(wallet as never, pub as never) : undefined;
  if (kuruVenue) console.log(`KuruVenue        ${kuruVenue}`);

  /*
   * The bot's key must hold gas on this chain or every scheduled run dies at signing — with an error that reads as the
   * USER being short. The executor's own client says which key that is, so the two cannot disagree.
   */
  const { delegateAccount } = await import('./evm/client.js');
  await anvil(RPC, 'anvil_setBalance', [delegateAccount.address, toHex(GAS_ETH)]);
  console.log(`delegate funded  ${delegateAccount.address}`);
  const deployedDelegate = process.env.XORR_DELEGATE_ADDRESS;
  if (deployedDelegate && isAddress(deployedDelegate) && deployedDelegate.toLowerCase() !== delegateAccount.address.toLowerCase()) {
    await anvil(RPC, 'anvil_setBalance', [deployedDelegate, toHex(GAS_ETH)]);
    console.log(`delegate funded  ${deployedDelegate} (the deployed executor's)`);
  }

  if (fundTarget) {
    // The reserve is given Circle's USDC by storage write, then pays the demo wallet in an ordinary transfer.
    await dealErc20({ rpc: RPC, token: USDC, holder: FORK_USDC_RESERVE, amount: DEMO_USDC * 100n });
    await anvil(RPC, 'anvil_impersonateAccount', [FORK_USDC_RESERVE]);
    await anvil(RPC, 'anvil_setBalance', [FORK_USDC_RESERVE, toHex(parseEther('1'))]);
    try {
      const reserve = createWalletClient({ account: FORK_USDC_RESERVE, chain, transport: http(RPC) });
      const h = await reserve.writeContract({ address: USDC, abi: erc20Abi, functionName: 'transfer', args: [fundTarget, DEMO_USDC] });
      await pub.waitForTransactionReceipt({ hash: h, ...RECEIPT });
    } finally {
      await anvil(RPC, 'anvil_stopImpersonatingAccount', [FORK_USDC_RESERVE]).catch(() => undefined);
    }
    await anvil(RPC, 'anvil_setBalance', [fundTarget, toHex(GAS_ETH)]);
    const bal = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [fundTarget] });
    console.log(`\nfunded ${fundTarget}\n  ${formatUnits(bal, 6)} ${SETTLEMENT_SYMBOL} + ${formatUnits(GAS_ETH, 18)} ${GAS} for gas`);
  }

  const envPath = path.resolve(process.cwd(), process.env.FORK_ENV_FILE ?? '.env.fork');
  await fs.writeFile(
    envPath,
    [
      '# Generated by server/src/fork-bootstrap-evm.ts. Regenerate whenever the fork restarts — a fresh anvil has none of',
      '# these contracts.',
      `XORR_CHAIN=${CHAIN_KEY}`,
      `FORK_RPC=${RPC}`,
      // The APP must sign on the chain the executor settles on, or every user-signed transaction goes elsewhere.
      `EXPO_PUBLIC_XORR_CHAIN=${CHAIN_KEY}`,
      `EXPO_PUBLIC_CHAIN_RPC=${RPC}`,
      `DELEGATION_ADDRESS=${delegation}`,
      `EXPO_PUBLIC_DELEGATION_ADDRESS=${delegation}`,
      `ANCHOR_ADDRESS=${anchor}`,
      ...(kuruVenue ? [`KURU_VENUE_ADDRESS=${kuruVenue}`] : []),
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  console.log(`\nwrote ${envPath}`);
  console.log('\nstart the executor against it:');
  console.log('  cd server && set -a && . ./.env.fork && set +a && npx tsx src/index.ts');
}

await main();
