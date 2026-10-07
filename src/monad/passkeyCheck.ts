/**
 * "Check my passkey on Monad" (MONAD-TECH item 4): the passkey signs the executor's challenge, and Monad's P256VERIFY
 * precompile checks the signature (`server/src/monad/passkey-p256.ts`).
 *
 * A WebAuthn assertion, made here with the browser's own API because Mera's ceremony returns its PRF output and not the
 * signature. One P-256 signature fits two public keys, so the first check signs twice and the server keeps the key both
 * fit; the key is remembered on this device (it is public), so later checks sign once. Web only: the native app's
 * passkey module does not hand back the assertion.
 */
import { monad, type Assertion, type PasskeyCheck } from '@/data/monad';

const KEY = 'xorr.p256.publicKey';

const b64url = {
  encode(buf: ArrayBuffer): string {
    let s = '';
    for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(s: string): Uint8Array<ArrayBuffer> {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

export function passkeyCheckSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && typeof navigator?.credentials?.get === 'function';
}

async function assertOnce(): Promise<Assertion> {
  const { challenge } = await monad.p256Challenge();
  const cred = (await navigator.credentials.get({
    publicKey: { challenge: b64url.decode(challenge), rpId: window.location.hostname, userVerification: 'required', timeout: 60_000 },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('The passkey was not used.');
  const r = cred.response as AuthenticatorAssertionResponse;
  return { authenticatorData: b64url.encode(r.authenticatorData), clientDataJSON: b64url.encode(r.clientDataJSON), signature: b64url.encode(r.signature) };
}

function remembered(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Sign with the passkey (twice the first time) and have Monad check it. */
export async function checkPasskeyOnMonad(): Promise<PasskeyCheck> {
  const publicKey = remembered();
  const result = publicKey
    ? await monad.p256Verify({ assertions: [await assertOnce()], publicKey }).catch(async () => {
        // A key remembered from another passkey on this device: fix this one's from two signatures.
        return monad.p256Verify({ assertions: [await assertOnce(), await assertOnce()] });
      })
    : await monad.p256Verify({ assertions: [await assertOnce(), await assertOnce()] });
  try {
    localStorage.setItem(KEY, result.publicKey);
  } catch {
    // remembering is a convenience; the next check signs twice
  }
  return result;
}
