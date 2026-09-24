import { getAccessToken } from '@privy-io/react-auth';
import { meraToken } from './mera/session';

/**
 * The token the executor verifies on every request: a Mera passkey session's own (`auth/passkey-session.ts` on the
 * executor) when the person signed in with a passkey, otherwise Privy's.
 */
export async function accessToken(): Promise<string | null> {
  return meraToken() ?? getAccessToken().catch(() => null);
}
