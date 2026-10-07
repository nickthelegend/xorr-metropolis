import { describe, expect, it } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha2';
import { concatBytes } from '@noble/hashes/utils';
import { bytesToHex } from 'viem';
import { assertionHash, candidateKeys, checkPasskey, issueChallenge, keyFromTwo, PasskeyCheckError, type Assertion } from './passkey-p256.js';

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');

/** A WebAuthn assertion as a platform authenticator makes one: client data over the challenge, signed with P-256. */
function assert(key: Uint8Array, challenge: string, type = 'webauthn.get'): Assertion {
  const authenticatorData = new Uint8Array(37).fill(5);
  const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type, challenge, origin: 'http://localhost:8092' }));
  const hash = sha256(concatBytes(authenticatorData, sha256(clientDataJSON)));
  const sig = p256.sign(hash, key, { prehash: false });
  return { authenticatorData: b64(authenticatorData), clientDataJSON: b64(clientDataJSON), signature: b64(sig.toDERRawBytes()) };
}

/** A chain whose 0x0100 checks the input the way EIP-7951 defines it: hash ‖ r ‖ s ‖ qx ‖ qy. */
const chain = {
  call: async ({ data }: { to?: string; data?: `0x${string}` }) => {
    const word = (i: number) => data!.slice(2 + i * 64, 2 + (i + 1) * 64);
    const pub = Buffer.from(`04${word(3)}${word(4)}`, 'hex');
    const sig = new p256.Signature(BigInt(`0x${word(1)}`), BigInt(`0x${word(2)}`));
    const ok = p256.verify(sig.toCompactRawBytes(), Buffer.from(word(0), 'hex'), pub, { prehash: false, lowS: false });
    return { data: ok ? (`0x${'0'.repeat(63)}1` as `0x${string}`) : ('0x' as `0x${string}`) };
  },
} as never;

describe('a passkey checked by P256VERIFY', () => {
  const key = p256.utils.randomPrivateKey();
  const pub = bytesToHex(p256.getPublicKey(key, false));

  it('one signature fits two keys, one of them the passkey’s; two signatures fix it', () => {
    const a = assert(key, issueChallenge().challenge);
    const b = assert(key, issueChallenge().challenge);
    expect(candidateKeys(assertionHash(a), Buffer.from(a.signature, 'base64url'))).toContain(pub);
    expect(keyFromTwo(a, b)).toBe(pub);
  });

  it('two assertions: the key is recovered, the chain accepts the signature and refuses it over another message', async () => {
    const r = await checkPasskey({ assertions: [assert(key, issueChallenge().challenge), assert(key, issueChallenge().challenge)] }, { mainnet: chain, executor: chain });
    expect(r.publicKey).toBe(pub);
    expect(r.offChain).toBe(true);
    expect(r.mainnet).toEqual({ valid: true, tamperedValid: false });
    expect(r.executor).toEqual({ valid: true, tamperedValid: false });
    expect(r.input.length).toBe(2 + 160 * 2);
  });

  it('one assertion with the key remembered from before', async () => {
    const r = await checkPasskey({ assertions: [assert(key, issueChallenge().challenge)], publicKey: pub }, { mainnet: chain, executor: chain });
    expect(r.mainnet.valid).toBe(true);
  });

  it('a key the signature does not fit is refused, not checked', async () => {
    const other = bytesToHex(p256.getPublicKey(p256.utils.randomPrivateKey(), false));
    await expect(checkPasskey({ assertions: [assert(key, issueChallenge().challenge)], publicKey: other }, { mainnet: chain, executor: chain })).rejects.toBeInstanceOf(PasskeyCheckError);
  });

  it('a challenge not issued here, or used twice, is refused', async () => {
    await expect(checkPasskey({ assertions: [assert(key, 'made-up')], publicKey: pub }, { mainnet: chain, executor: chain })).rejects.toMatchObject({ code: 'bad_challenge' });
    const c = issueChallenge().challenge;
    await checkPasskey({ assertions: [assert(key, c)], publicKey: pub }, { mainnet: chain, executor: chain });
    await expect(checkPasskey({ assertions: [assert(key, c)], publicKey: pub }, { mainnet: chain, executor: chain })).rejects.toMatchObject({ code: 'bad_challenge' });
  });

  it('an expired challenge is refused', async () => {
    const c = issueChallenge(0).challenge;
    await expect(checkPasskey({ assertions: [assert(key, c)], publicKey: pub }, { mainnet: chain, executor: chain }, 10 * 60_000)).rejects.toMatchObject({ code: 'bad_challenge' });
  });

  it('a registration is not an assertion', async () => {
    await expect(checkPasskey({ assertions: [assert(key, issueChallenge().challenge, 'webauthn.create')], publicKey: pub }, { mainnet: chain, executor: chain })).rejects.toMatchObject({ code: 'bad_assertion' });
  });
});
