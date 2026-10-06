/**
 * The welcome screen's hero: xorr's own coin — the X on brushed black — from xorr.finance's art (`landing/public/media`).
 *
 * It was the landing film of a SOL coin leading BTC, ETH, tokenized stocks and USDC, with "Tokenized US stocks on
 * Solana" under it. This build trades Robinhood Chain Stock Tokens and hedges on Arbitrum, so the first screen shows the
 * brand's mark rather than any one chain's: chain-agnostic, as every main screen is. A still on every platform, web
 * included — a film of one chain's coin is exactly what had to go.
 *
 * Faded into the screen's black at the top and bottom so the wordmark and the headline sit on the art rather than on a
 * rectangle.
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '@/ui';
import { COIN_FOCUS, HeroFades } from './coinHeroParts';

const COIN = require('../../assets/landing/coin-x.webp');

export function CoinHero({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.frame, style]} accessible={false}>
      <Image source={COIN} accessibilityLabel="" style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={COIN_FOCUS} />
      <HeroFades />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: colors.bg },
});
