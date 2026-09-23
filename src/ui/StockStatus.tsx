/**
 * What the executor knows about a Stock Token right now, in as few words as it takes (PLAN.md P4.4).
 *
 * A session chip (Market / Extended / Overnight / Closed), a halt banner, and one line each for the Chainlink print, the
 * pool's price, the gap between them and the multiplier. Every piece is drawn only when the executor reported it: the
 * row's own fields decide, `src/markets/stockTokens.ts` words them, and a field that did not arrive draws nothing.
 */
import React from 'react';
import { useNow } from '@/state/useNow';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { XStockRow } from '@/data/system';
import { price as fmtPrice } from '@/format';
import {
  chainlinkLine,
  deviationLine,
  haltSentence,
  multiplierLine,
  poolLine,
  sessionLabel,
  sessionOpen,
} from '@/markets/stockTokens';
import { Tag } from './Tag';
import { Text } from './Text';
import { colors, radius, space } from './tokens';

/** Why a Stock Token cannot be ordered now, from what the executor reported; undefined when nothing it said stops it. */
export function stockBlock(row: Pick<XStockRow, 'halted' | 'session' | 'symbol'>): string | undefined {
  if (row.halted === true) return haltSentence(row);
  if (row.session === 'closed') return 'Trading is closed. Orders open with the next session.';
  return undefined;
}

/** The session as a chip, or nothing when no session was reported. */
export function SessionChip({ session, testID }: { session: XStockRow['session']; testID?: string }) {
  const label = sessionLabel(session);
  if (!label) return null;
  return <Tag label={label} sentence tone={sessionOpen(session) ? "up" : "neutral"} radius={radius.full} testID={testID} />;
}

export function StockStatus({
  row,
  light,
  style,
  testID,
}: {
  row: XStockRow;
  /** On the light sheet (the ticket) rather than the black screens. */
  light?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const muted = light ? colors.sheet.muted : colors.ink55;
  const now = useNow();
  const halt = haltSentence(row);
  const closed = row.session === 'closed' && !halt ? stockBlock(row) : undefined;
  const clLine = chainlinkLine(row, fmtPrice, now);
  // One line under the chip: the pool, how far it sits from Chainlink, and what one token stands for.
  const detail = [poolLine(row, fmtPrice), deviationLine(row.deviationBps), multiplierLine(row.multiplier)]
    .filter(Boolean)
    .join(' · ');
  const chip = sessionLabel(row.session);
  // Robinhood's own notices: an announced dividend or split, and a scheduled multiplier change. Shown only as sent.
  const notices = [
    ...(Array.isArray(row.corporateActions) ? row.corporateActions.filter((n) => typeof n === 'string' && n.length > 0) : []),
    ...(row.pendingMultiplier?.multiplier
      ? [`Multiplier changes to ${row.pendingMultiplier.multiplier}${row.pendingMultiplier.effectiveTime ? ` on ${row.pendingMultiplier.effectiveTime.slice(0, 10)}` : ''}`]
      : []),
  ];
  if (!chip && !halt && !clLine && !detail && notices.length === 0) return null;

  return (
    <View style={[{ gap: space.s6 }, style]} testID={testID}>
      {chip || clLine ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s8, flexWrap: 'wrap' }}>
          {chip ? <SessionChip session={row.session} testID={testID ? `${testID}-session` : undefined} /> : null}
          {clLine ? (
            <Text variant="footnote" color={muted} figure="market">
              {clLine}
            </Text>
          ) : null}
        </View>
      ) : null}
      {halt ? (
        <View
          accessibilityRole="alert"
          style={{ backgroundColor: colors.down, borderRadius: radius.note, paddingVertical: space.s8, paddingHorizontal: space.s12 }}
          testID={testID ? `${testID}-halt` : undefined}
        >
          <Text variant="footnote" color={colors.ink}>
            {halt}
          </Text>
        </View>
      ) : null}
      {closed ? (
        <Text variant="footnote" color={muted}>
          {closed}
        </Text>
      ) : null}
      {detail ? (
        <Text variant="footnote" color={muted} figure="market">
          {detail}
        </Text>
      ) : null}
      {notices.map((n) => (
        <Text key={n} variant="footnote" color={light ? colors.sheet.ink : colors.ink} testID={testID ? `${testID}-notice` : undefined}>
          {n}
        </Text>
      ))}
    </View>
  );
}
