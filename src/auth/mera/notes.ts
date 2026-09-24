/**
 * Private notes: a second key from the same passkey (Mera's "one passkey, many keys").
 *
 * The wallet's key is the passkey's PRF output under Mera's default salt. This one is the PRF output under
 * `sha256("xorr.notes.v1")` — a different, independent 32 bytes from the same passkey — imported as an AES-256-GCM key
 * that cannot be exported. Notes are sealed on the device; the executor stores the IV and the ciphertext and can read
 * neither. The same passkey on another device evaluates the same salt to the same key, so a note written on a laptop
 * opens on a phone, and on nothing else.
 */

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The notes namespace: its own PRF salt, so this key is never the wallet's. */
export async function notesSalt(): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('xorr.notes.v1')));
}

/** An AES-256-GCM key from 32 bytes of PRF output, not extractable. The bytes are zeroed once imported. */
export async function noteKeyFrom(prfOutput: Uint8Array): Promise<CryptoKey> {
  if (prfOutput.length !== 32) throw new Error(`A PRF output is 32 bytes, not ${prfOutput.length}.`);
  const raw = new Uint8Array(prfOutput);
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  raw.fill(0);
  prfOutput.fill(0);
  return key;
}

export type SealedNote = { iv: string; ciphertext: string };

export async function sealNote(key: CryptoKey, text: string): Promise<SealedNote> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
  return { iv: b64(iv), ciphertext: b64(ct) };
}

/** Opens a note, or throws: a key from another passkey (or a changed byte) fails GCM's check rather than reading garbage. */
export async function openNote(key: CryptoKey, note: SealedNote): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(note.iv) }, key, unb64(note.ciphertext));
  return new TextDecoder().decode(pt);
}
