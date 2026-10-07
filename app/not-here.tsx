/**
 * A screen this build does not have.
 *
 * Screens that read a chain or venue this build is not on are hidden (`src/nav/buildRoutes.ts`); a link or bookmark that
 * still reaches one lands here and says so, rather than drawing a screen that reads the wrong chain.
 */
import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Fill, HeaderBar, Screen, Text, colors, space } from '@/ui';
import { TRADE_ROUTE } from '@/nav/buildRoutes';
import { onMonad } from '@/chain';

export default function NotHere() {
  return (
    <Screen>
      <HeaderBar
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        title={<Text variant="screenTitle">Not here</Text>}
      />
      <Fill style={{ justifyContent: 'center', gap: space.s12 }}>
        <Text variant="onboardingTitle" align="center">
          Not in this app yet
        </Text>
        <Text variant="body" color={colors.ink55} align="center">
          That screen has nothing behind it here.
        </Text>
        <View style={{ marginTop: space.s16, gap: space.s10 }}>
          {/* Where this build trades — Monad lists no stocks, so "Trade stocks" there pointed at a screen that is also not here. */}
          <Button label={onMonad ? 'See the markets' : 'Trade stocks'} onPress={() => router.replace(TRADE_ROUTE)} testID="nothere-trade" />
          <Button label="Go to your wallet" variant="ghost" onPress={() => router.replace('/')} testID="nothere-home" />
        </View>
      </Fill>
    </Screen>
  );
}
