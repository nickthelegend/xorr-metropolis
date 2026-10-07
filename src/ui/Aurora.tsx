/**
 * Aurora.tsx — light on a black screen (2026-10-06).
 *
 * The app is true black and stays so. What it lacked was any light: every screen was the same flat black from edge to
 * edge, so nothing had depth and nothing drew the eye. Two pieces fix that without a grey anywhere:
 *
 *   <Aurora />  the ambient light at the top of every screen — the accent's violet falling into blue, from above, fading to
 *               black well before the content. `Screen` draws it; a screen never does.
 *   <Glow />    a pool of light behind the one figure a screen is about — a balance, a verdict, a position's P&L.
 *
 * Both are SVG radial gradients (React Native has no CSS radial gradient) in the shape's own box — so a circle stretches to
 * the box it fills, on the web and the phone alike — drawn behind the content, deaf to touches, and
 * static: light that moves is a thing to look at, and this is the room, not the subject. Gradient ids are per instance
 * because the web keeps earlier screens mounted, and a gradient referenced from a hidden screen's SVG does not paint.
 */
import React, { useId } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colors } from './tokens';

/** How far down the ambient light reaches. Past the header, never into a list. */
const AURORA_H = 340;

export function Aurora({ intensity = 1 }: { intensity?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: AURORA_H }}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id={`a${id}`} cx="18%" cy="0%" r="85%" fx="18%" fy="0%">
            <Stop offset="0" stopColor={colors.aurora1} stopOpacity={0.34 * intensity} />
            <Stop offset="0.55" stopColor={colors.aurora1} stopOpacity={0.08 * intensity} />
            <Stop offset="1" stopColor={colors.aurora1} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`b${id}`} cx="92%" cy="6%" r="70%" fx="92%" fy="6%">
            <Stop offset="0" stopColor={colors.aurora2} stopOpacity={0.24 * intensity} />
            <Stop offset="0.6" stopColor={colors.aurora2} stopOpacity={0.05 * intensity} />
            <Stop offset="1" stopColor={colors.aurora2} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#a${id})`} />
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#b${id})`} />
      </Svg>
    </View>
  );
}

export interface GlowProps {
  /** The light's colour. The accent unless the figure is a P&L, which takes `up` or `down`. */
  color?: string;
  /** How bright at its centre, 0–1. */
  strength?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A pool of light behind a figure. Place it absolutely inside the figure's container (it fills its parent by default) and
 * put the figure after it.
 */
export function Glow({ color = colors.aurora1, strength = 0.42, style }: GlowProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, style]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id={`g${id}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={strength} />
            <Stop offset="0.5" stopColor={color} stopOpacity={strength * 0.35} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx="50%" cy="50%" rx="50%" ry="50%" fill={`url(#g${id})`} />
      </Svg>
    </View>
  );
}
