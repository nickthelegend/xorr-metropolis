/**
 * The passkey account: from a passkey's PRF output to an EVM key, on the device, the way Mera recommends.
 *
 * PRF output (32 bytes, the same every time for the same passkey and salt) → BIP-39 entropy → a 24-word phrase → the
 * standard path `m/44'/60'/0'/0/0`. The same passkey gives the same account on any device, nothing is stored, and the
 * phrase is the one MetaMask or any BIP-39 wallet would derive the same address from — so a person is never locked into
 * this app. The key only ever lives in a Mera signing session (`session.web.ts`), which zeroes it when it ends.
 */
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';

/** The standard first Ethereum account: what a BIP-39 wallet shows first for the same phrase. */
export const ACCOUNT_PATH = "m/44'/60'/0'/0/0";

/** The recovery phrase a passkey's PRF output stands for. Shown to no one by default; it is what makes the account portable. */
export function phraseFromPrf(prfOutput: Uint8Array): string {
  if (prfOutput.length !== 32) throw new Error(`A passkey PRF output is 32 bytes, not ${prfOutput.length}.`);
  return entropyToMnemonic(prfOutput, wordlist);
}

/** The account's private key. The caller hands it straight to a Mera session and zeroes its own copy. */
export function privateKeyFromPrf(prfOutput: Uint8Array): Uint8Array {
  const seed = mnemonicToSeedSync(phraseFromPrf(prfOutput));
  const key = HDKey.fromMasterSeed(seed).derive(ACCOUNT_PATH).privateKey;
  seed.fill(0);
  if (!key) throw new Error('The passkey did not derive a key.');
  return key;
}
