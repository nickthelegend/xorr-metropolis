/**
 * The Stock Token catalog — what tokenized shares exist here, and what each one costs.
 *
 * Each row's large number is what a token costs in its pool: what a buy actually pays. The line under it names a mark
 * for the listed share when the executor has one, so the two are visibly different quantities.
 *
 * The trading session sits in the header when every row that reports one agrees, and on the row when they do not; a
 * halted stock says so on its row. Neither is drawn when the executor did not report it.
 *
 * `No price` is a row, never a placeholder number: a screen that dropped unpriced rows would answer "there is nothing
 * to trade", which is a different and untrue thing.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useGoBack } from '@/nav/useGoBack';
import {
  AssetMark,
  EmptyState,
  ErrorState,
  Fill,
  HeaderBar,
  LoadingRows,
  Pill,
  PillRow,
  Row,
  Screen,
  Text,
  colors,
  pnlTone,
  size,
  space,
} from '@/ui';
import { assetGradient } from '@/design/gradients';
import { percent, price as fmtPrice } from '@/format';
import { useAsync } from '@/data/useAsync';
import { logoProps, useLogos } from '@/data/useLogos';
import { system, type XStockRow } from '@/data/system';
import { SessionChip } from '@/ui/StockStatus';
import { sessionLabel } from '@/markets/stockTokens';
import {
  ALL_SECTORS,
  bySector,
  isTradable,
  secondaryLine,
  sectorOptions,
  unpricedNote,
} from '@/markets/catalog';

export default function XStocks() {
  const goBack = useGoBack();
  const router = useRouter();
  const { data, loading, error, reload } = useAsync(() => system.xstocks(), []);
  const [sector, setSector] = useState<string>(ALL_SECTORS);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const sectors = useMemo(() => sectorOptions(data?.sectors ?? []), [data]);
  const shown = useMemo(() => bySector(rows, sector), [rows, sector]);

  const symbols = useMemo(() => shown.map((r) => r.symbol), [shown]);
  const logos = useLogos(symbols);
  const note = unpricedNote(shown);
  /** One session for the whole list, when every row that reported one agrees. */
  const sessions = useMemo(() => [...new Set(rows.map((r) => r.session).filter((x) => sessionLabel(x)))], [rows]);
  const listSession = sessions.length === 1 ? sessions[0] : undefined;

  return (
    <Screen gutter="none">
      <View style={{ paddingHorizontal: space.gutter }}>
        <HeaderBar
          onBack={goBack}
          title={<Text variant="screenTitle">Stocks</Text>}
          right={listSession ? <SessionChip session={listSession} testID="xstocks-session" /> : undefined}
        />
        <Text variant="secondary" color={colors.ink55} style={{ marginTop: space.s8 }}>
          Stock Tokens, priced by the pools that hold them.
        </Text>
      </View>

      {/* §5: pills never shrink to fit — the row scrolls. */}
      {sectors.length > 1 ? (
        <PillRow style={{ marginTop: space.s16 }} contentPadding={space.gutter}>
          {sectors.map((s) => (
            <Pill key={s} label={s} selected={s === sector} onPress={() => setSector(s)} />
          ))}
        </PillRow>
      ) : null}

      <Fill style={{ marginTop: space.s12, paddingHorizontal: space.gutter }}>
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <LoadingRows count={8} height={size.rowLg} />
        ) : rows.length === 0 ? (
          <EmptyState text="No Stock Tokens on this network." />
        ) : shown.length === 0 ? (
          <EmptyState text={`Nothing listed under ${sector}.`} />
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: space.s30 }}
          >
            {note ? (
              <Text variant="secondarySm" color={colors.warn} style={{ paddingVertical: space.s10 }}>
                {/*
                  Said out loud rather than left to be counted. Every row unpriced means the feed is
                  unreachable or these mints are not the ones this deployment knows — two different
                  faults that look identical from a quiet list.
                */}
                {note}
              </Text>
            ) : null}

            {shown.map((s) => (
              <XStockListRow
                key={s.address || s.symbol}
                row={s}
                logos={logos}
                ownSession={!listSession}
                /*
                 * An unpriced row does not lead anywhere. It is worth listing — the asset exists and
                 * cannot be priced here — but an order ticket opened on it would have no number to
                 * put in front of someone before they commit money.
                 */
                onPress={isTradable(s) ? () => router.push(`/xstock/${s.symbol}`) : undefined}
              />
            ))}
          </ScrollView>
        )}
      </Fill>
    </Screen>
  );
}

function XStockListRow({
  row,
  logos,
  onPress,
  ownSession,
}: {
  row: XStockRow;
  logos: ReturnType<typeof useLogos>;
  onPress?: () => void;
  /** Name this row's session, because the list's rows do not share one. */
  ownSession?: boolean;
}) {
  const session = ownSession ? sessionLabel(row.session) : undefined;
  const secondary = [row.halted === true ? 'Halted' : undefined, session, secondaryLine(row, fmtPrice)]
    .filter(Boolean)
    .join(' · ');
  return (
    <Row
      height={size.rowLg}
      onPress={onPress}
      // Market prices, not this person's money: they stay legible while balances are hidden.
      figure="market"
      left={
        <AssetMark
          gradient={assetGradient(row.symbol)}
          {...logoProps(logos, row.symbol)}
          size={size.mark}
        />
      }
      title={row.symbol}
      secondary={secondary}
      value={
        row.price === null || row.price === undefined ? (
          /*
            Never a placeholder number. A dash or a zero here would be read as a price, and the
            whole point of the row is that nobody could tell us what this one costs.
          */
          <Text variant="rowPrimary" color={colors.ink55}>
            No price
          </Text>
        ) : (
          fmtPrice(row.price)
        )
      }
      /*
       * Null is "not reported" and zero is "did not move". A delta for the first would be a claim
       * the feed never made, so only the second gets one — and `pnlTone` puts a move of nothing in
       * neutral rather than green, since it is neither a gain nor a loss.
       */
      delta={row.price != null && row.change24hPct != null ? percent(row.change24hPct) : undefined}
      deltaTone={row.change24hPct != null ? pnlTone(row.change24hPct) : undefined}
    />
  );
}
