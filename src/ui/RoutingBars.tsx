/**
 * RoutingBars.tsx — what routing was worth on one fill, drawn (2026-10-06).
 *
 * Every order is measured on Kuru's book and on Uniswap through the contract, and the better one fills. That was one
 * sentence of footnote text under the receipt — the most interesting fact on the screen, set in its smallest type. Two
 * bars now: what each venue measured, the chosen one lit in the accent, the other in grey, on a scale that starts near
 * the smaller figure so a 0.2% edge is visible rather than two identical full bars. The exact sentence stays beneath,
 * because a bar shows a difference and a number says it.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { venueNaming } from './fillVenue';
import { arrival, useReducedMotion } from './motion';
import { Text } from './Text';
import { colors, duration, gradient, space } from './tokens';

const BAR_H = 10;

function Bar({ share, lit, index }: { share: number; lit: boolean; index: number }) {
  const reduced = useReducedMotion();
  const w = useSharedValue(reduced ? share : 0);
  React.useEffect(() => {
    w.value = withDelay(reduced ? 0 : 200 + index * 120, withTiming(share, arrival(duration.draw, reduced)));
  }, [share, reduced, index, w]);
  const grow = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={{ height: BAR_H, borderRadius: BAR_H / 2, backgroundColor: colors.control, overflow: 'hidden' }}>
      <Animated.View style={[{ height: BAR_H, borderRadius: BAR_H / 2, overflow: 'hidden' }, grow]}>
        {lit ? (
          <LinearGradient colors={gradient.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.ink28 }]} />
        )}
      </Animated.View>
    </View>
  );
}

export function RoutingBars({
  venue,
  compared,
  unit,
}: {
  venue: string | null | undefined;
  compared: { venue: string; units: number; chosenUnits: number };
  unit: string;
}) {
  const chosen = venueNaming(venue)?.label ?? venue ?? 'Chosen';
  const other = venueNaming(compared.venue)?.label ?? compared.venue;
  const hi = Math.max(compared.chosenUnits, compared.units);
  const lo = Math.min(compared.chosenUnits, compared.units);
  // A floor a little under the smaller figure: two bars of 99.8% and 100% would look the same.
  const floor = Math.max(0, lo - Math.max((hi - lo) * 3, hi * 0.002));
  const share = (v: number) => (hi > floor ? 0.25 + 0.75 * ((v - floor) / (hi - floor)) : 1);
  const n = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 2 : 6 });
  const rows = [
    { name: chosen, units: compared.chosenUnits, lit: true, tag: 'Filled here' },
    { name: other, units: compared.units, lit: false, tag: 'Measured' },
  ];
  return (
    <View style={{ gap: space.s14 }}>
      {rows.map((r, i) => (
        <View key={r.name} style={{ gap: space.s6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Text variant="rowPrimary" color={r.lit ? colors.ink : colors.ink55}>
              {r.name}
              <Text variant="secondarySm" color={r.lit ? colors.accentHi : colors.ink40}>{`  ${r.tag}`}</Text>
            </Text>
            <Text variant="secondary" color={r.lit ? colors.ink : colors.ink55} figure="units">
              {`${n(r.units)} ${unit}`}
            </Text>
          </View>
          <Bar share={share(r.units)} lit={r.lit} index={i} />
        </View>
      ))}
    </View>
  );
}

