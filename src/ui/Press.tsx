/**
 * Press.tsx — the one press behaviour.
 *
 * A control gives under the thumb (2026-10-06): it settles to `pressScale` and dims a little while the finger is down,
 * and comes back when it lifts. The old feedback was an instant opacity blink, which on a black screen of flat cards was
 * close to no feedback at all — part of why the app read as stale. Every row, card and button goes through here, so this
 * one change is felt on every screen. Under reduced motion the change is instant.
 *
 * There is no hover state anywhere in this app: a hover style on a touch surface fires on web and on a stylus and nowhere
 * else, so it is a second visual language only some users ever see.
 *
 * `android_ripple={null}` is deliberate. The Material ripple draws a coloured circle that ignores the component's own
 * radius and reads as a second selection signal — on a trading surface a stray highlight is exactly the kind of ambiguity
 * design.md rules out.
 */
import React from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { easeOut, useReducedMotion } from './motion';
import { duration, size } from './tokens';

/** The pressed opacity. One value, everywhere. */
export const PRESSED_OPACITY = 0.85;
/** How far a control settles under the thumb. */
export const PRESSED_SCALE = 0.97;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressProps extends Omit<PressableProps, 'style' | 'android_ripple'> {
  style?: StyleProp<ViewStyle>;
  /**
   * The control's rendered height. If it is under the 44pt minimum, the touch area is
   * grown symmetrically to reach it — the circle stays 26px, the target becomes 44.
   */
  hitHeight?: number;
  /** Same, for width. Used by the stepper circles and the switch. */
  hitWidth?: number;
  /** How far it settles while pressed; 1 keeps it still (a keypad digit, a list that scrolls under the thumb). */
  pressScale?: number;
}

/** Grow the touch area to `size.hit` without changing the drawn box. */
export function hitSlopFor(
  width?: number,
  height?: number,
): { top: number; bottom: number; left: number; right: number } {
  const v = height !== undefined && height < size.hit ? (size.hit - height) / 2 : 0;
  const h = width !== undefined && width < size.hit ? (size.hit - width) / 2 : 0;
  return { top: v, bottom: v, left: h, right: h };
}

export const Press = React.forwardRef<React.ComponentRef<typeof Pressable>, PressProps>(
  function Press({ style, hitHeight, hitWidth, hitSlop, disabled, pressScale = PRESSED_SCALE, onPressIn, onPressOut, ...rest }, ref) {
    const reduced = useReducedMotion();
    const down = useSharedValue(0);
    const give = useAnimatedStyle(() => ({
      opacity: 1 - down.value * (1 - PRESSED_OPACITY),
      transform: [{ scale: 1 - down.value * (1 - pressScale) }],
    }));
    const settle = (to: number, ms: number) => {
      down.value = withTiming(to, { duration: reduced ? 0 : ms, easing: easeOut });
    };
    return (
      <AnimatedPressable
        ref={ref}
        disabled={disabled}
        android_ripple={null}
        hitSlop={hitSlop ?? hitSlopFor(hitWidth, hitHeight)}
        onPressIn={(e: GestureResponderEvent) => {
          if (!disabled) settle(1, duration.press);
          onPressIn?.(e);
        }}
        onPressOut={(e: GestureResponderEvent) => {
          settle(0, duration.base);
          onPressOut?.(e);
        }}
        style={[style, give]}
        {...rest}
      />
    );
  },
);
