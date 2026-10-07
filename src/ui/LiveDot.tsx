/**
 * LiveDot.tsx — a status dot that breathes while the thing it reports is live (2026-10-06).
 *
 * The old policy banned a pulsing status dot ("a distraction the user can't act on"). The owner's verdict on the result
 * was that the app had no life, and a live state that looks exactly like a dead one is part of why: "armed" and "live" are
 * the two facts on these screens that are *happening*, and a still dot cannot say that. So a dot may pulse — only when
 * `pulse` is set, which callers pass for a live, healthy state and never for a warning, a stop or an unknown. A ring leaves
 * the dot and fades; the dot itself never moves or changes colour. Under reduced motion there is no ring.
 */
import React, { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from './motion';
import { duration } from './tokens';

/** How far the ring travels, as a multiple of the dot. */
const RING_TO = 2.6;

export function LiveDot({ color, size = 7, pulse = false, style }: { color: string; size?: number; pulse?: boolean; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  const on = pulse && !reduced;
  useEffect(() => {
    if (!on) {
      cancelAnimation(t);
      t.value = 0;
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: duration.pulse * 2, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(t);
  }, [on, t]);
  const ring = useAnimatedStyle(() => ({
    opacity: on ? 0.55 * (1 - t.value) : 0,
    transform: [{ scale: 1 + t.value * (RING_TO - 1) }],
  }));
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, ring]}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, boxShadow: `0px 0px ${size}px ${color}` }} />
    </View>
  );
}
