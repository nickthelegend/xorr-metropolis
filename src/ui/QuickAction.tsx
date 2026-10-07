/**
 * QuickAction.tsx — the round actions under a balance, and the avatar at the top of a screen (2026-10-06).
 *
 * Home said what you had and then made you look for what to do with it. A row of four round actions under the balance —
 * add funds, trade, perps, the council — is the most familiar shape a wallet has, and it puts the next step where the eye
 * already is. The first in a row may be `primary`: the accent's gradient and its light. The rest are glass.
 *
 * `Avatar` is the account's initial on the accent's gradient. It was a white disc, the brightest thing on Home and the
 * least important.
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, type IconName } from '@/design/Icon';
import { Press } from './Press';
import { Text } from './Text';
import { border, colors, glow, gradient, space } from './tokens';

const ACTION = 54;

export function QuickAction({
  icon,
  label,
  onPress,
  primary = false,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  primary?: boolean;
  testID?: string;
}) {
  return (
    <Press
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ alignItems: 'center', gap: space.s8, flex: 1 }}
    >
      <View
        style={[
          { width: ACTION, height: ACTION, borderRadius: ACTION / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
          primary ? { boxShadow: glow.primary, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderTopColor: 'rgba(255,255,255,0.35)' } : border.card,
        ]}
      >
        <LinearGradient
          colors={primary ? gradient.primary : gradient.card}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { borderRadius: ACTION / 2 }]}
        />
        {/* In a View: on the web an SVG is not positioned, so the gradient (absolute) would paint over it. */}
        <View>
          <Icon name={icon} size={22} color={primary ? colors.ink : colors.accentHi} />
        </View>
      </View>
      <Text variant="secondarySm" color={colors.ink70} numberOfLines={1}>
        {label}
      </Text>
    </Press>
  );
}

export function QuickActions({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s8 }, style]}>{children}</View>;
}

export function Avatar({ initial, size = 40 }: { initial: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: glow.soft,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.14)',
      }}
    >
      <LinearGradient
        colors={gradient.primary}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
      />
      <Text variant={size >= 60 ? 'screenTitle' : 'rowPrimary'} color={colors.ink}>
        {initial}
      </Text>
    </View>
  );
}
