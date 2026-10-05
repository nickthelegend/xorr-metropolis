/**
 * Where Mera runs, on the phone (the Agora mobile path): the platform passkey API through Mera's React Native client
 * (`react-native-passkey`), a passkey domain as the relying party, and the Keychain / Keystore for who is signed in.
 *
 * A native passkey belongs to a domain that vouches for the app: `webcredentials:<domain>` in the iOS entitlements (app
 * config `associatedDomains`) with the domain serving `/.well-known/apple-app-site-association`, and on Android the
 * domain's `/.well-known/assetlinks.json` naming the app's package and signing certificate. The files to serve are in
 * `docs/passkey-domain/`. Until the build names a domain (`EXPO_PUBLIC_MERA_RP_ID`), passkeys are not offered here —
 * a button that cannot work is worse than none.
 */
import * as SecureStore from 'expo-secure-store';
import { Passkey } from 'react-native-passkey';
import { reactNativeWebAuthnClient } from '@category-labs/mera/react-native-webauthn-client';
import type { WebAuthnClient } from '@category-labs/mera';

const RP_ID = process.env.EXPO_PUBLIC_MERA_RP_ID;

export const meraPlatform: {
  rpId: () => string;
  webAuthnClient: WebAuthnClient | undefined;
  supported: () => boolean;
  read: (key: string) => string | null;
  write: (key: string, value: string | null) => void;
} = {
  rpId: () => {
    if (!RP_ID) throw new Error('This build names no passkey domain (EXPO_PUBLIC_MERA_RP_ID).');
    return RP_ID;
  },
  webAuthnClient: reactNativeWebAuthnClient,
  supported: () => {
    try {
      return Boolean(RP_ID) && Passkey.isSupported();
    } catch {
      return false;
    }
  },
  read: (key) => SecureStore.getItem(key),
  write: (key, value) => {
    if (value === null) void SecureStore.deleteItemAsync(key);
    else SecureStore.setItem(key, value);
  },
};
