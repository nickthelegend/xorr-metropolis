import { isMeraError } from '@category-labs/mera';

/**
 * A passkey failure in words a person can act on — or '' when nothing went wrong (the prompt was closed).
 *
 * Mera names its failures by code; the one that matters most is PRF: the account is derived from the passkey's PRF
 * output, and a passkey provider that does not offer PRF cannot make an account at all, whatever else it supports.
 */
export function passkeyFailure(e: unknown): string {
  if (isMeraError(e)) {
    switch (e.code) {
      case 'PRF_UNAVAILABLE':
        return 'This passkey provider cannot derive an account (it has no WebAuthn PRF). Use Chrome with Google Password Manager, Safari 18 or later with iCloud Keychain, or a security key that supports PRF.';
      case 'PASSKEY_OPERATION_FAILED':
        // Cancelled, timed out or refused by the platform: nothing was created and nothing changed.
        return /cancel|abort|not allowed|NotAllowed/i.test(e.message) ? '' : `The passkey prompt did not complete: ${e.message}`;
      case 'CRYPTO_UNAVAILABLE':
        return 'This browser cannot generate the randomness a passkey needs.';
      default:
        return e.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}
