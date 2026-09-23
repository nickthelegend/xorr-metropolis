/**
 * Perpl, read live (FEATURES-100 #18, 2026-09-24).
 *
 * The protocol's side of the risk picture: every open market on Perpl mainnet with its mark, how wide the book is, how
 * much is open, and who is paying funding — the same funding the council's perps desk votes on. Read from Perpl's public
 * context through `/monad/perpl` on each visit; nothing here is kept or smoothed. The wallet's side — positions,
 * liquidation distance — is the desk (`/perps`), where a person can act on it.
 *
 * Open interest is shown in dollars at the mark: a count of BTC beside a count of MON compares nothing.
 */
import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useGoBack } from '@/nav/useGoBack';
import { Button, ErrorState, HeaderBar, LoadingRows, Screen, SheetCard, Text, colors, money, price, radius, size, space } from '@/ui';
import { CHAIN_KEY } from '@/chain';
import { percent } from '@/format';
import { useAsync } from '@/data/useAsync';
import { perps, type PerplLiveMarket } from '@/data/perps';

/** Countries by the codes Perpl's geo-block list uses (its public context, 2026-09-24). Unknown codes are shown as sent. */
const COUNTRY: Readonly<Record<string, string>> = {
  BY: 'Belarus',
  CU: 'Cuba',
  GB: 'the UK',
  IR: 'Iran',
  KP: 'North Korea',
  RU: 'Russia',
  SY: 'Syria',
  UA: 'Ukraine',
  US: 'the US',
};

/** Who pays, in words, from funding per hour. Positive: longs pay shorts. */
function whoPays(pctPerHour: number | null | undefined): { text: string; tone: string } {
  if (pctPerHour === null || pctPerHour === undefined) return { text: 'Funding not stated', tone: colors.ink40 };
  if (pctPerHour === 0) return { text: 'Funding flat', tone: colors.ink55 };
  const rate = `${percent(Math.abs(pctPerHour), { digits: 4, explicitSign: false })}/h`;
  // In ink, not green or red: those are profit and loss, and a funding direction is neither.
  return { text: pctPerHour > 0 ? `Longs pay ${rate}` : `Shorts pay ${rate}`, tone: colors.ink65 };
}

const oiUsd = (m: PerplLiveMarket) => (m.openInterest !== null && m.mark !== null ? m.openInterest * m.mark : null);
const spreadBps = (m: PerplLiveMarket) =>
  m.bid !== null && m.ask !== null && m.bid > 0 && m.ask >= m.bid ? ((m.ask - m.bid) / ((m.ask + m.bid) / 2)) * 10_000 : null;

export default function PerplLive() {
  const goBack = useGoBack();
  const router = useRouter();
  const live = useAsync(() => perps.live(), []);

  const markets = useMemo(
    () => (live.data?.markets ?? []).filter((m) => m.open).sort((a, b) => (oiUsd(b) ?? -1) - (oiUsd(a) ?? -1)),
    [live.data],
  );
  const totalOi = markets.reduce((sum, m) => sum + (oiUsd(m) ?? 0), 0);
  const longsPay = markets.filter((m) => (m.fundingPctPerHour ?? 0) > 0).length;
  const shortsPay = markets.filter((m) => (m.fundingPctPerHour ?? 0) < 0).length;
  const blocked = (live.data?.geoBlock ?? []).map((c) => COUNTRY[c] ?? c);

  return (
    <Screen gutter="none">
      <View style={{ paddingHorizontal: space.gutter }}>
        <HeaderBar onBack={goBack} title={<Text variant="screenTitle">Perpl</Text>} />
        <Text variant="secondary" color={colors.ink55} style={{ marginTop: space.s6 }}>
          Monad’s perps exchange, read live from mainnet.
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.gutter, gap: space.s12, paddingBottom: space.s44 }}>
        {live.error ? <ErrorState error={live.error} onRetry={live.reload} /> : null}
        {!live.data && !live.error ? <LoadingRows count={4} height={size.rowLg} /> : null}

        {live.data ? (
          <SheetCard bordered borderRadius={radius.panel} padding={space.s14}>
            <Text variant="footnote" color={colors.ink55}>
              OPEN INTEREST
            </Text>
            <Text variant="screenTitle" style={{ marginTop: space.s4 }}>
              {money(totalOi, { decimals: 0 })}
            </Text>
            <Text variant="secondarySm" color={colors.ink55} style={{ marginTop: space.s6 }}>
              {`Across ${markets.length} open markets. Longs pay funding on ${longsPay}, shorts on ${shortsPay}.`}
            </Text>
          </SheetCard>
        ) : null}

        {markets.map((m) => {
          const pays = whoPays(m.fundingPctPerHour);
          const oi = oiUsd(m);
          const spread = spreadBps(m);
          return (
            <SheetCard key={m.id} bordered borderRadius={radius.panel} padding={space.s14}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text variant="rowPrimary">{m.name}</Text>
                <Text variant="rowPrimary">{m.mark !== null ? price(m.mark) : '—'}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.s6 }}>
                <Text variant="footnote" color={pays.tone}>
                  {pays.text}
                </Text>
                <Text variant="footnote" color={colors.ink55}>
                  {`${oi !== null ? `${money(oi, { decimals: 0 })} open` : 'Open interest not stated'}${spread !== null ? ` · ${spread.toLocaleString('en-US', { maximumFractionDigits: 1 })} bps wide` : ''}`}
                </Text>
              </View>
            </SheetCard>
          );
        })}

        {blocked.length > 0 ? (
          <Text variant="footnote" color={colors.ink55}>
            {`Perpl does not offer trading in ${blocked.join(', ')}.`}
          </Text>
        ) : null}
        <Text variant="footnote" color={colors.ink40}>
          From Perpl’s public market context. Funding is per hour; positive means longs pay shorts.
        </Text>
        {/* Trading is on the desk, where Perpl runs on this build's chain: Monad testnet. */}
        {CHAIN_KEY === 'monad-testnet' ? <Button label="Trade on your desk" onPress={() => router.push('/perps')} /> : null}
      </ScrollView>
    </Screen>
  );
}
