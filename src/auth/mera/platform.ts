/**
 * Where Mera runs, on the web: the browser's own WebAuthn (Mera's default client), the page's host as the relying party,
 * and the browser's storage for who is signed in. The phone's version is `platform.native.ts`.
 */
import type { WebAuthnClient } from '@category-labs/mera';

export const meraPlatform: {
  /** The passkey's relying party: the domain the passkey belongs to. */
  rpId: () => string;
  /** The WebAuthn client Mera runs its ceremonies through; undefined is Mera's browser default. */
  webAuthnClient: WebAuthnClient | undefined;
  supported: () => boolean;
  read: (key: string) => string | null;
  write: (key: string, value: string | null) => void;
} = {
  rpId: () => window.location.hostname,
  webAuthnClient: undefined,
  supported: () => typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function',
  read: (key) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(key)),
  write: (key, value) => {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  },
};
