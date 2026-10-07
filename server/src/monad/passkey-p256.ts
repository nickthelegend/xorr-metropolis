/**
 * A passkey's signature, checked by Monad's P256VERIFY precompile (2026-10-07; MONAD-TECH item 4).
 *
 * A passkey signs with P-256. Checking one on chain used to mean a Solidity verifier at hundreds of thousands of gas;
 * Monad carries P256VERIFY as a precompile at 0x0100 (EIP-7951, 6,900 gas). xorr's account comes from the same
 * passkey through Mera (its PRF output derives the signing key), and this proves the passkey itself to the chain:
 *
 *   1. the app asks for a challenge, and the passkey signs it (a WebAuthn assertion, Face ID or the device's own);
 *   2. here the assertion is checked to be over that challenge, and its message is rebuilt as WebAuthn defines it:
 *      sha256(authenticatorData ‖ sha256(clientDataJSON));
 *   3. the passkey's public key is recovered from the signature — one signature fits two keys, so the first check asks
 *      for two assertions and keeps the key both fit (the app remembers it, so later checks need one);
 *   4. the chain is asked, by eth_call to 0x0100 on Monad mainnet and on the executor's chain, whether the signature is
 *      valid — and, as a control, whether the same signature over a different message is (it must not be).
 *
 * Nothing is stored here beyond the outstanding challenges, which expire in two minutes and are used once.
 */
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha2';
import { randomBytes } from 'node:crypto';
import { concatBytes } from '@noble/hashes/utils';
import { bytesToHex, hexToBytes, type Hex, type PublicClient } from 'viem';
import { p256Input, p256Point, p256Verify } from './native.js';

const CHALLENGE_TTL_MS = 120_000;
const challenges = new Map<string, number>();

const b64url = {
  encode: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
  decode: (s: string) => new Uint8Array(Buffer.from(s, 'base64url')),
};

/** A fresh challenge for one assertion: 32 random bytes, base64url, usable once within two minutes. */
export function issueChallenge(now = Date.now()): { challenge: string; expiresAt: number } {
  for (const [c, exp] of challenges) if (exp < now) challenges.delete(c);
  const challenge = b64url.encode(randomBytes(32));
  challenges.set(challenge, now + CHALLENGE_TTL_MS);
  return { challenge, expiresAt: now + CHALLENGE_TTL_MS };
}

/** Takes a challenge if it was issued here and has not expired or been used. */
export function takeChallenge(challenge: string, now = Date.now()): boolean {
  const exp = challenges.get(challenge);
  if (exp === undefined) return false;
  challenges.delete(challenge);
  return exp >= now;
}

/** One WebAuthn assertion, its three byte strings base64url as the browser gives them. */
export type Assertion = { authenticatorData: string; clientDataJSON: string; signature: string };

/** The message a WebAuthn assertion signs: sha256(authenticatorData ‖ sha256(clientDataJSON)). */
export function assertionHash(a: Assertion): Uint8Array {
  return sha256(concatBytes(b64url.decode(a.authenticatorData), sha256(b64url.decode(a.clientDataJSON))));
}

/** What the assertion says it is: its type, its challenge, its origin. */
export function clientData(a: Assertion): { type: string; challenge: string; origin: string } {
  const j = JSON.parse(new TextDecoder().decode(b64url.decode(a.clientDataJSON))) as { type?: string; challenge?: string; origin?: string };
  return { type: String(j.type ?? ''), challenge: String(j.challenge ?? ''), origin: String(j.origin ?? '') };
}

/** The (up to two) public keys a P-256 signature over `hash` fits, uncompressed. */
export function candidateKeys(hash: Uint8Array, derSignature: Uint8Array): Hex[] {
  const sig = p256.Signature.fromDER(derSignature);
  const out: Hex[] = [];
  for (const bit of [0, 1]) {
    try {
      out.push(bytesToHex(sig.addRecoveryBit(bit).recoverPublicKey(hash).toRawBytes(false)));
    } catch {
      // that recovery bit has no point on the curve
    }
  }
  return out;
}

/** The one key two signatures by the same passkey both fit; undefined when they share none. */
export function keyFromTwo(a: Assertion, b: Assertion): Hex | undefined {
  const first = candidateKeys(assertionHash(a), b64url.decode(a.signature));
  const second = new Set(candidateKeys(assertionHash(b), b64url.decode(b.signature)));
  const both = first.filter((k) => second.has(k));
  return both.length === 1 ? both[0] : undefined;
}

export type PasskeyCheck = {
  publicKey: Hex;
  origin: string;
  /** The 160-byte input sent to 0x0100. */
  input: Hex;
  /** Checked here, with the same curve maths, before the chain is asked. */
  offChain: boolean;
  /** The chain's answer on each network; null when the call could not be made. */
  mainnet: { valid: boolean | null; tamperedValid: boolean | null };
  executor: { valid: boolean | null; tamperedValid: boolean | null };
};

export class PasskeyCheckError extends Error {
  constructor(
    readonly code: 'bad_challenge' | 'bad_assertion' | 'no_key',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Check one or two assertions. With two, the key is recovered; with one, `publicKey` (from an earlier check) must be one
 * the signature fits. The last assertion is the one the chain is asked about.
 */
export async function checkPasskey(
  p: { assertions: Assertion[]; publicKey?: Hex },
  clients: { mainnet: Pick<PublicClient, 'call'>; executor: Pick<PublicClient, 'call'> },
  now = Date.now(),
): Promise<PasskeyCheck> {
  if (p.assertions.length < 1 || p.assertions.length > 2) throw new PasskeyCheckError('bad_assertion', 'Send one or two assertions.');
  let origin = '';
  for (const a of p.assertions) {
    let cd: ReturnType<typeof clientData>;
    try {
      cd = clientData(a);
    } catch {
      throw new PasskeyCheckError('bad_assertion', 'The assertion’s client data is not JSON.');
    }
    if (cd.type !== 'webauthn.get') throw new PasskeyCheckError('bad_assertion', `An assertion is webauthn.get, not ${cd.type || 'nothing'}.`);
    if (!takeChallenge(cd.challenge, now)) throw new PasskeyCheckError('bad_challenge', 'That challenge was not issued here, has expired, or was used.');
    origin = cd.origin;
  }
  const last = p.assertions[p.assertions.length - 1]!;
  const hash = assertionHash(last);
  const der = b64url.decode(last.signature);
  let publicKey: Hex | undefined;
  if (p.assertions.length === 2) publicKey = keyFromTwo(p.assertions[0]!, last);
  else if (p.publicKey && candidateKeys(hash, der).includes(p.publicKey.toLowerCase() as Hex)) publicKey = p.publicKey.toLowerCase() as Hex;
  if (!publicKey) throw new PasskeyCheckError('no_key', 'The passkey’s public key could not be fixed: sign twice for the first check.');

  const sig = p256.Signature.fromDER(der);
  const { x, y } = p256Point(hexToBytes(publicKey));
  const input = p256Input(bytesToHex(hash), sig.r, sig.s, x, y);
  const tampered = p256Input(bytesToHex(sha256(hash)), sig.r, sig.s, x, y);
  const offChain = p256.verify(sig.toCompactRawBytes(), hash, hexToBytes(publicKey), { prehash: false, lowS: false });
  const ask = async (c: Pick<PublicClient, 'call'>) => ({
    valid: await p256Verify(c, input).catch(() => null),
    tamperedValid: await p256Verify(c, tampered).catch(() => null),
  });
  const [mainnet, executor] = await Promise.all([ask(clients.mainnet), ask(clients.executor)]);
  return { publicKey, origin, input, offChain, mainnet, executor };
}
