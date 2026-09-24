/** The notes key from the signed-in passkey: its own salt, one prompt, held for the signing window (`notes.ts`). */
import { getPasskeyPrfOutput } from '@category-labs/mera';
import { noteKeyFrom, notesSalt } from './notes';
import { passkeyTarget, SIGNING_WINDOW_MS } from './session';

let cached: { key: CryptoKey; until: number } | null = null;

/** The notes key, asking the passkey once (its own salt) and holding it for the same window as signing. */
export async function notesKey(): Promise<CryptoKey> {
  if (cached && cached.until > Date.now()) return cached.key;
  const got = await getPasskeyPrfOutput({ ...passkeyTarget(), prfSalt: await notesSalt() });
  cached = { key: await noteKeyFrom(got.prfOutput), until: Date.now() + SIGNING_WINDOW_MS };
  return cached.key;
}

export function forgetNotesKey(): void {
  cached = null;
}
