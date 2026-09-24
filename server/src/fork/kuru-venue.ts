/**
 * Deploy xorr's `KuruVenue` adapter on a Monad fork and record it in `.env.fork` as `KURU_VENUE_ADDRESS`.
 *
 * `fork-bootstrap-evm.ts` calls `deployKuruVenue` with its own deployer on every new fork; run on its own it deploys to the
 * fork that is already running (the grant must then allow the new venue — `fork-grant.ts` reads it from the same list).
 *
 * Run: cd server && set -a && . ./.env.fork && set +a && npx tsx src/fork/kuru-venue.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPublicClient, createWalletClient, http, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/** WMON on Monad mainnet (and so on its fork): what the adapter wraps bought MON into. */
export const WMON_MONAD: Address = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';

async function artifact(name: string): Promise<{ abi: unknown[]; bytecode: Hex }> {
  const file = new URL(`../../../contracts/out/${name}.sol/${name}.json`, import.meta.url);
  const json = JSON.parse(await fs.readFile(file, 'utf8')) as { abi: unknown[]; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

export async function deployKuruVenue(wallet: WalletClient, pub: PublicClient): Promise<Address> {
  const art = await artifact('KuruVenue');
  const hash = await wallet.deployContract({
    abi: art.abi as never,
    bytecode: art.bytecode,
    args: [WMON_MONAD] as never,
    account: wallet.account!,
    chain: wallet.chain,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash, pollingInterval: 500, timeout: 120_000 });
  if (!receipt.contractAddress) throw new Error(`KuruVenue deployment ${hash} created no contract`);
  return receipt.contractAddress;
}

/** Replace (or add) one `KEY=value` line in an env file, leaving every other line as it was. */
export async function setEnvLine(file: string, key: string, value: string): Promise<void> {
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  const lines = text.split('\n').filter((l) => !l.startsWith(`${key}=`));
  const end = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  lines.splice(end, 0, `${key}=${value}`);
  await fs.writeFile(file, lines.join('\n'), { mode: 0o600 });
}

// Run directly (not imported by the bootstrap). A path with a space ("Extreme SSD") is %20 in the module URL.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rpc = process.env.FORK_RPC ?? 'http://127.0.0.1:8545';
  // anvil's first default account: a public, fork-only key with a balance on every anvil node.
  const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
  const pub = createPublicClient({ transport: http(rpc) }) as PublicClient;
  const chainId = await pub.getChainId();
  if (chainId !== 143) throw new Error(`${rpc} answers chain ${chainId}; KuruVenue is for a fork of Monad (143).`);
  const wallet = createWalletClient({ account, chain: { id: 143, name: 'Monad fork', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc) });
  const venue = await deployKuruVenue(wallet, pub);
  const envFile = path.resolve(process.cwd(), process.env.FORK_ENV_FILE ?? '.env.fork');
  await setEnvLine(envFile, 'KURU_VENUE_ADDRESS', venue);
  console.log(`KuruVenue        ${venue}\nwrote KURU_VENUE_ADDRESS to ${envFile}`);
}
