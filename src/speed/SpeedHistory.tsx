/**
 * SpeedHistory.tsx — a wallet's recent fills, timed (ROADMAP-WIN W5, 2026-10-08).
 *
 * The speed receipt is one fill's; this is the last twenty side by side, as the Runs screen opens: a bar per fill, as
 * tall as its time to executed, the median, how many came back with their receipt from the send
 * (eth_sendRawTransactionSync), and how far the gas each declared sat over the gas it used — what Monad bills.
 * Every figure is the executor's record of the wallet's own fills; with none, nothing is drawn.
 */
import React from 'react';
import { View } from 'react-native';
import { Press, SheetCard, Text, colors, radius, space } from '@/ui';
import { useAsync } from '@/data/useAsync';
import { headroomPct, median, msWords, speed, speedBarHeight } from '@/data/speed';
import { CHAIN_KEY } from '@/chain';

const BAR_MAX = 64;

export function SpeedHistory() {
  const r = useAsync(() => speed.history(), []);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const fills = r.data ?? [];
  if (!fills.length) return null;
  const top = Math.max(...fills.map((f) => f.executedMs));
  const mid = median(fills.map((f) => f.executedMs));
  const synced = fills.filter((f) => f.sync).length;
  const over = headroomPct(fills);
  return (
    <SheetCard bordered tone="accent" borderRadius={radius.panel} padding={space.s16} style={{ marginBottom: space.s12 }} testID="speed-history">
      <Text variant="eyebrow">Your fills, timed</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: space.s8, marginTop: space.s6 }}>
        <Text variant="titleLg">{msWords(mid) ?? '—'}</Text>
        <Text variant="secondarySm" color={colors.ink55}>
          median execution time
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: BAR_MAX, marginTop: space.s12 }} accessibilityLabel={`${fills.length} fills, from ${msWords(Math.min(...fills.map((f) => f.executedMs)))} to ${msWords(top)}`}>
        {fills.map((f) => (
          <View
            key={f.id}
            style={{
              flex: 1,
              maxWidth: 18,
              height: speedBarHeight(f.executedMs, top, BAR_MAX),
              borderRadius: 3,
              backgroundColor: f.sync ? colors.accent : colors.ink28,
            }}
          />
        ))}
      </View>
      <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s10 }}>
        {`Across your last ${fills.length} ${fills.length === 1 ? 'trade' : 'trades'}${CHAIN_KEY === 'monad-fork' ? ' · local fork' : ''}`}
      </Text>
      <Press
        onPress={() => setDetailsOpen((open) => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: detailsOpen }}
        accessibilityLabel={detailsOpen ? 'Hide execution details' : 'Show execution details'}
        style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}
        testID="speed-history-details"
      >
        <Text variant="secondarySm" color={colors.ink70}>{detailsOpen ? 'Hide details' : 'Execution details'}</Text>
      </Press>
      {detailsOpen && <Text variant="footnote" color={colors.ink55}>
        {[
          `${synced} of ${fills.length} came back with their receipt from the send (eth_sendRawTransactionSync)`,
          over !== null ? `gas declared ${over}% over the gas used (median) — Monad bills the declared` : null,
          CHAIN_KEY === 'monad-fork' ? 'on the local fork, which mines a block a second' : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>}
    </SheetCard>
  );
}
