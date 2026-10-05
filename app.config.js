/**
 * app.json, plus the passkey domain when a build names one (Mera on the phone, `src/auth/mera/platform.native.ts`).
 *
 * A native passkey belongs to a domain that vouches for the app: iOS needs the `webcredentials:` associated domain in the
 * entitlements, and the domain must serve the files in `docs/passkey-domain/`. Without EXPO_PUBLIC_MERA_RP_ID the build
 * carries no such entitlement and offers no passkey sign-in.
 */
module.exports = ({ config }) => {
  const rp = process.env.EXPO_PUBLIC_MERA_RP_ID;
  if (!rp) return config;
  return { ...config, ios: { ...config.ios, associatedDomains: [`webcredentials:${rp}`] } };
};
