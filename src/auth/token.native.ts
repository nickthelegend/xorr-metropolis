import { getAccessToken } from '@privy-io/expo';
import { meraToken } from './mera/session';

/**
 * The token the executor verifies on every request: a Mera passkey session's own when the person signed in with a
 * passkey (`auth/passkey-session.ts` on the executor), otherwise Privy's.
 */
export async function accessToken(): Promise<string | null> {
  return meraToken() ?? getAccessToken().catch(() => null);
}
