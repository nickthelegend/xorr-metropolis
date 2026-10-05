# The passkey domain — Mera on the phone

A passkey belongs to a domain (its relying party). In the browser that is the page's host. In the phone app it is a
domain that vouches for the app, so a passkey made in the app is the same passkey the web app at that domain uses — one
account on every device (Mera's stateless test).

To turn on passkey sign-in in the phone app (`src/auth/mera/platform.native.ts`):

1. **Serve these two files** from the domain, over HTTPS, with `Content-Type: application/json` and no redirect:
   - `/.well-known/apple-app-site-association` — replace `APPLE_TEAM_ID` with the Apple developer team's id;
   - `/.well-known/assetlinks.json` — replace `ANDROID_SIGNING_CERT_SHA256` with the SHA-256 fingerprint of the key that
     signs the Android build (`keytool -list -v -keystore …`, or EAS credentials).
2. **Build with the domain named**: `EXPO_PUBLIC_MERA_RP_ID=xorr.finance` (`app.config.js` then adds
   `webcredentials:xorr.finance` to the iOS entitlements), as a development build — Expo Go carries no native passkey module.
   `npx expo prebuild && npx expo run:ios` (or `run:android`).
3. Requirements Mera states: iOS 18+, Android 9+, a PRF-capable passkey provider (iCloud Keychain, Google Password
   Manager, 1Password).

Without step 2 the app offers no passkey button at all; with it but without step 1, the platform refuses the ceremony and
the app says so (`mera/failure.ts`).
