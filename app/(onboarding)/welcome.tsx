/**
 * Screen 1 — Splash. screens.md Group B.
 *
 * Lives at /welcome, NOT at the group index: both (onboarding) and (tabs) previously
 * declared an index route, so expo-router resolved "/" to whichever it found first and the
 * Home tab rendered the splash. The tabs group owns "/" now.
 *
 * It opens on xorr's own coin (`CoinHero`: the X, from xorr.finance's art) under the XORR. wordmark, with the tagline
 * as the one headline and one short line under it. No chain is named here: the main screens are chain-agnostic, and the
 * network is named only where money moves.
 *
 * No balance appears here, invented or otherwise: there is no account yet to have one, and the app's own route sweep
 * asserts the prototype's figures are gone.
 */
import React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { brand } from '@/design/brand';
import { onMonad } from '@/chain';
import { TRADE_ROUTE } from '@/nav/buildRoutes';
import { CoinHero } from '@/design/CoinHero';
import { Button, Fill, Press, Screen, signIn, Text, colors, size, space } from '@/ui';
import { Rise } from '@/ui/Rise';
import { useStore } from '@/state/store';

const WORDMARK = require('../../assets/brand/xorr-wordmark.png');
/** The wordmark art is 833×166; drawn at the landing header's height. */
const WORDMARK_H = 18;
const WORDMARK_W = Math.round((WORDMARK_H * 833) / 166);

export default function Splash() {
  const howSeen = useStore((st) => st.howSeen);
  const router = useRouter();
  return (
    <Screen gutter="none">
      <Fill>
        <Rise index={0} style={{ flex: 1 }}>
          <CoinHero style={{ flex: 1 }} />
          <View style={{ position: 'absolute', top: space.s8, left: 0, right: 0, alignItems: 'center' }}>
            <Image
              source={WORDMARK}
              accessibilityLabel={brand.WORDMARK}
              style={{ width: WORDMARK_W, height: WORDMARK_H }}
              contentFit="contain"
            />
          </View>
        </Rise>
      </Fill>

      <View style={{ paddingHorizontal: space.gutter }}>
        <Rise index={1}>
          <Text variant="onboardingTitle" align="center">
            {brand.TAGLINE}
          </Text>
          {/* What it trades and the claim that separates it: someone deciding in five seconds needs the nouns. */}
          <Text
            variant="secondary"
            color={colors.ink55}
            align="center"
            style={{ marginTop: space.s10 }}
          >
            {onMonad ? brand.SUBLINE_MONAD : brand.SUBLINE}
          </Text>
        </Rise>

        <Rise index={2} style={{ marginTop: space.s26 }}>
          {/* The three-step explainer first, once on this device (ROADMAP-WIN F2); after that, straight on. */}
          <Button label="Get started" onPress={() => router.push(howSeen ? '/goals' : '/how')} testID="welcome-start" />
          {/* A wallet that already exists goes straight to the email step, not through the questions a new one answers. */}
          <Button label="Sign in" variant="ghost" onPress={signIn} style={{ marginTop: space.s10 }} />
          {/*
            A way in that costs nothing: the market reads live without a session and is the most convincing thing here,
            so it is offered before the ask. It is the Trade tab's list: Stock Tokens, or on Monad the crypto and perps
            markets (`/xstocks` does not exist there).
          */}
          <Button
            label="See the market first"
            variant="ghost"
            onPress={() => router.push(TRADE_ROUTE)}
            style={{ marginTop: space.s4 }}
            testID="welcome-see-market"
          />
          {/*
            The two documents the sentence names, as links. It was plain text, so the first screen asked for agreement
            to documents it gave no way to read. Each link keeps a full-size touch area without growing the line.
          */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: space.s12 }}>
            <Text variant="footnote" color={colors.ink55}>
              {'By continuing you agree to the '}
            </Text>
            <Press
              onPress={() => router.push('/legal/terms')}
              accessibilityRole="link"
              accessibilityLabel="Read the Terms"
              hitHeight={size.hit}
            >
              <Text variant="footnote" color={colors.ink}>
                Terms
              </Text>
            </Press>
            <Text variant="footnote" color={colors.ink55}>
              {' and '}
            </Text>
            <Press
              onPress={() => router.push('/legal/privacy')}
              accessibilityRole="link"
              accessibilityLabel="Read the Privacy Policy"
              hitHeight={size.hit}
            >
              <Text variant="footnote" color={colors.ink}>
                Privacy Policy
              </Text>
            </Press>
            <Text variant="footnote" color={colors.ink55}>
              .
            </Text>
          </View>
        </Rise>
      </View>
    </Screen>
  );
}
