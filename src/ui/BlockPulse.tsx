/**
 * BlockPulse.tsx — the chain's clock, read from the chain (FEATURES-100 #24, 2026-09-24).
 *
 * Monad makes a block every 400 ms. This asks the node for its head once a second and shows the number, with a dot that
 * brightens each time the number moves — so a desk that trades on-chain says, quietly, that the chain under it is live.
 * A read that fails shows nothing rather than a stale number: a counter frozen on its last good value would claim a
 * chain that had stopped was still moving.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { chainAccess } from '@/wallet/chainAccess';
import { Text } from './Text';
import { duration, timing, useReducedMotion } from './motion';
import { colors, space } from './tokens';

/** How often the head is asked for. Faster than this and the reads outnumber what a person can see change. */
const POLL_MS = 1_000;

export function BlockPulse({ label }: { label: string }) {
  const [block, setBlock] = useState<bigint | null>(null);
  const last = useRef<bigint | null>(null);
  const glow = useSharedValue(0.35);
  const reduced = useReducedMotion();

  useEffect(() => {
    let alive = true;
    const read = () =>
      chainAccess.getBlockNumber().then(
        (n) => {
          if (!alive) return;
          if (last.current !== null && n !== last.current && !reduced) {
            glow.value = withSequence(withTiming(1, timing(duration.fast, false)), withTiming(0.35, timing(duration.slow, false)));
          }
          last.current = n;
          setBlock(n);
        },
        () => {
          if (alive) setBlock(null);
        },
      );
    void read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [glow, reduced]);

  const dot = useAnimatedStyle(() => ({ opacity: glow.value }));
  if (block === null) return null;
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.s6 }}
      accessibilityLabel={`${label}, block ${block.toString()}`}
    >
      <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.up }, dot]} />
      <Text variant="footnote" color={colors.ink55}>
        {`${label} · block ${Number(block).toLocaleString('en-US')}`}
      </Text>
    </View>
  );
}
