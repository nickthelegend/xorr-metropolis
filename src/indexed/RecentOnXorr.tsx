/**
 * RecentOnXorr.tsx — what an empty screen will show, shown with real fills (ROADMAP-WIN W3, 2026-10-08).
 *
 * A new account's History and Runs were honest and empty: nothing to watch until the first trade. Under the empty
 * state, until the account has its own, this shows the latest fills on xorr — everyone's, and labelled so — read from
 * Envio's index of the chain (`/indexed/recent`), and Monad's blocks going final under them. Nothing here is the
 * reader's, and nothing is invented: a read that fails shows nothing rather than a placeholder row.
 */
import React from 'react';
import { View } from 'react-native';
import { SheetCard, Text, colors, radius, space } from '@/ui';
import { shortAddress, when } from '@/format';
import { useAsync } from '@/data/useAsync';
import { fillWords, recent } from '@/data/recent';
import { CommitStrip } from '@/speed/CommitStrip';

export function RecentOnXorr({ count = 5 }: { count?: number }) {
  const r = useAsync(() => recent.fills(), []);
  const fills = r.data?.slice(0, count) ?? [];
  return (
    <View style={{ gap: space.s10 }}>
      {fills.length ? (
        <SheetCard bordered borderRadius={radius.panel} padding={space.s16} testID="recent-on-xorr">
          <Text variant="eyebrow">On xorr just now</Text>
          <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s4 }}>
            Everyone’s fills, not yours · Envio
          </Text>
          <View style={{ marginTop: space.s12, gap: space.s10 }}>
            {fills.map((f) => (
              <View key={`${f.tx}:${f.kind}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s10 }}>
                <View style={{ flex: 1 }}>
                  <Text variant="secondarySm" color={colors.ink}>
                    {fillWords(f)}
                  </Text>
                  <Text variant="footnoteSm" color={colors.ink40}>
                    {`${shortAddress(f.owner)} · block ${f.block.toLocaleString('en-US')}`}
                  </Text>
                </View>
                <Text variant="footnoteSm" color={colors.ink55}>
                  {when(Date.parse(f.at))}
                </Text>
              </View>
            ))}
          </View>
        </SheetCard>
      ) : null}
      <SheetCard bordered borderRadius={radius.panel} padding={space.s16}>
        <CommitStrip count={4} />
      </SheetCard>
    </View>
  );
}
