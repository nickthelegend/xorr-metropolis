/**
 * Where the coin sits in the hero, and the fades that sink the art into the screen.
 *
 * A file of its own, with no `.web` variant: when `CoinHero` had a web half, importing these from `./CoinHero` there
 * imported itself, and the welcome screen died with "Maximum call stack size exceeded". Keep it separate.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { alpha, colors } from '@/ui';

/** Where the coin sits in the frame, so a portrait crop keeps it. */
export const COIN_FOCUS = { left: '45%', top: '45%' } as const;

/** Black in from the top for the wordmark, and down into the screen at the bottom for the headline. */
export function HeroFades() {
  return (
    <>
      <LinearGradient
        colors={[colors.bg, alpha(colors.bg, 0)]}
        locations={[0, 0.24]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={[alpha(colors.bg, 0), colors.bg]}
        locations={[0.52, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </>
  );
}
