/**
 * Who is signed in, as Privy knows them — web. See `usePrivyIdentity.native.ts`.
 */
import { usePrivy } from '@privy-io/react-auth';
import { useMera } from './mera/session';

export function usePrivyIdentity(): { email: string | null; name: string | null } {
  const { user } = usePrivy();
  // A passkey account has no email and no social handle: it is its passkey.
  const mera = useMera();
  if (mera.signedIn) return { email: null, name: 'Passkey account' };
  const email = user?.email?.address ?? null;
  const handle = user?.twitter?.username;
  return { email, name: email ?? user?.google?.email ?? (handle ? `@${handle}` : null) };
}
