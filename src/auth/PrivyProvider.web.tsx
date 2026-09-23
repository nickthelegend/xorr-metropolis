/**
 * Privy on web.
 *
 * `@privy-io/expo` is a native-only SDK — it reads the app's bundle identifier and throws on
 * react-native-web. The web SDK is a separate package, so the provider is platform-split rather
 * than forced into one implementation. Metro picks `.web.tsx` for web and `.native.tsx` for
 * iOS/Android automatically; nothing else in the app knows the difference.
 */
import React from 'react';
import { PrivyProvider as WebProvider } from '@privy-io/react-auth';
import { activeChain, supportedChains } from '@/chain';
import { colors } from '@/ui';

const APP_ID = process.env.EXPO_PUBLIC_PRIVY_APP_ID;

if (!APP_ID) {
  throw new Error('EXPO_PUBLIC_PRIVY_APP_ID is required — the app has no offline login path.');
}

export function AppPrivyProvider({ children }: { children: React.ReactNode }) {
  return (
    <WebProvider
      appId={APP_ID!}
      config={{
        // A wallet is created on login for anyone who does not already have one, which is what
        // makes "sign in and you own a wallet" a single step rather than two. One EVM wallet: the
        // grant, the approvals and a withdrawal are all signed on this build's chain.
        embeddedWallets: {
          ethereum: { createOnLogin: 'users-without-wallets' },
          solana: { createOnLogin: 'off' },
        },
        // The same ways in as the onboarding screen offers (`src/auth/socialLogins.ts`); each is switched on per app in
        // Privy's dashboard, and one that is not simply does not appear here.
        loginMethods: ['email', 'google', 'twitter', 'wallet'],
        // Follows EXPO_PUBLIC_XORR_CHAIN — see src/chain.ts for what hardcoding this cost.
        defaultChain: activeChain,
        supportedChains,
        appearance: {
          theme: 'dark',
          accentColor: colors.ink,
          showWalletLoginFirst: false,
          /*
           * "Continue with a wallet" lists Ethereum wallets only: the app signs on an EVM chain (Robinhood Chain or
           * Arbitrum), and a Solana wallet could sign nothing here. Coinbase Wallet is not offered — its Smart Wallet
           * SDK refuses chains it does not support and probes cross-origin on every screen (the X Layer build's note).
           */
          walletList: ['detected_ethereum_wallets', 'metamask', 'rainbow', 'wallet_connect'],
          walletChainType: 'ethereum-only',
        },
      }}
    >
      {children}
    </WebProvider>
  );
}

export const PRIVY_APP_ID = APP_ID;
export const SURFACE = colors.bg;
