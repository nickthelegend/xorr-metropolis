/**
 * Perpl risk, read live (FEATURES-100 #18, 2026-09-24; the risk tool, 2026-10-05).
 *
 * Perpl's "Analytics / Risk Tool" bounty, on public data only. Per open market: who pays funding now and what it has cost
 * a long over the window (each funding payment drawn, above the line when longs paid), where the price went, how much is
 * open and how wide the book is. Above them, what deserves a look first — crowded funding, big moves, wide books, stale
 * marks — and, on the testnet build with a desk, your own positions: how far each is from liquidation and what it pays in
 * funding an hour at the current rate. Everything is read through `/monad/perpl/risk` (Perpl's public context, funding
 * history and hourly candles) on each visit; nothing here is kept or smoothed.
 *
 * The network is the build's: Perpl testnet on the testnet build, where the desks trade; Perpl mainnet otherwise.
 * Open interest is shown in dollars at the mark: a count of BTC beside a count of MON compares nothing.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useGoBack } from '@/nav/useGoBack';
import { Button, ErrorState, HeaderBar, LoadingRows, Screen, Segmented, SheetCard, Tag, Text, colors, money, price, radius, size, space, Glow } from '@/ui';
import { CHAIN_KEY, PERPL_DESK_HERE } from '@/chain';
import { percent } from '@/format';
import { useAuth } from '@/auth/useAuth';
import { useAsync } from '@/data/useAsync';
import { perps, type DeskPosition, type PerplMarketRisk } from '@/data/perps';
import { aprOf, bucket, fundingPerHourUsd, riskAlerts, type RiskAlert } from '@/data/perplRisk';
import { useNow } from '@/state/useNow';

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

type Win = '24' | '168';
const WINDOWS = [
  { value: '24', label: '24h' },
  { value: '168', label: '7 days' },
] as const satisfies readonly { value: Win; label: string }[];
const windowWords = (hours: number) => (hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours}h`);

const ON_TESTNET = CHAIN_KEY === 'monad-testnet';
const ON_FORK = CHAIN_KEY === 'monad-fork';

/** Who pays, in words, from funding per hour. Positive: longs pay shorts. */
function whoPays(pctPerHour: number | null): string {
  if (pctPerHour === null) return 'Funding not stated';
  if (pctPerHour === 0) return 'Funding flat';
  const rate = `${percent(Math.abs(pctPerHour), { digits: 4, explicitSign: false })}/h`;
  return pctPerHour > 0 ? `Longs pay ${rate}` : `Shorts pay ${rate}`;
}

/** What a long paid over the window, in words: the share of its notional, and that pace for a year. */
function longsPaid(m: PerplMarketRisk, hours: number): string | null {
  const { longsPaidPct, aprPct } = m.funding;
  if (longsPaidPct === null || aprPct === null) return null;
  const share = percent(Math.abs(longsPaidPct), { digits: 3, explicitSign: false });
  const year = percent(Math.abs(aprPct), { digits: 1, explicitSign: false });
  if (longsPaidPct === 0) return `No funding changed hands in ${windowWords(hours)}`;
  return longsPaidPct > 0
    ? `Longs paid ${share} in ${windowWords(hours)} · ${year} a year`
    : `Longs were paid ${share} in ${windowWords(hours)} · ${year} a year`;
}

function ageOf(at: string | null, now: number): { text: string; stale: boolean } | null {
  if (!at) return null;
  const sec = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  const text = sec < 60 ? `${sec}s ago` : sec < 3600 ? `${Math.round(sec / 60)} min ago` : `${Math.round(sec / 3600)} h ago`;
  return { text, stale: sec > 60 };
}

const usdPerHour = (n: number) => `${money(Math.abs(n), { decimals: Math.abs(n) < 1 ? 3 : 2 })}/h`;

/**
 * Each funding payment in the window as a bar: above the line when longs paid, below when shorts did, scaled to the
 * window's largest. In ink, not green or red: those are profit and loss, and a funding direction is neither.
 */
function FundingStrip({ values, label }: { values: number[]; label: string }) {
  const bars = bucket(values, 48);
  if (bars.length < 2) return null;
  const maxAbs = Math.max(...bars.map((v) => Math.abs(v))) || 1;
  const half = 14;
  return (
    <View accessible accessibilityLabel={label} style={{ flexDirection: 'row', gap: 1, marginTop: space.s10 }}>
      {bars.map((v, i) => {
        const h = v === 0 ? 0 : Math.max(1, Math.round((Math.abs(v) / maxAbs) * half));
        return (
          <View key={i} style={{ flex: 1 }}>
            <View style={{ height: half, justifyContent: 'flex-end' }}>
              {v > 0 ? <View style={{ height: h, backgroundColor: colors.ink65 }} /> : null}
            </View>
            <View style={{ height: 1, backgroundColor: colors.ink28 }} />
            <View style={{ height: half }}>{v < 0 ? <View style={{ height: h, backgroundColor: colors.ink35 }} /> : null}</View>
          </View>
        );
      })}
    </View>
  );
}

function Alerts({ alerts }: { alerts: RiskAlert[] }) {
  return (
    <SheetCard bordered borderRadius={radius.panel} padding={space.s14}>
      <Text variant="footnote" color={colors.ink55}>
        WORTH A LOOK
      </Text>
      {alerts.length === 0 ? (
        <Text variant="secondarySm" color={colors.ink65} style={{ marginTop: space.s6 }}>
          Nothing stands out: no crowded funding, big moves, wide books or stale marks.
        </Text>
      ) : (
        alerts.map((a) => (
          <View key={a.key} style={{ flexDirection: 'row', gap: space.s8, marginTop: space.s8, alignItems: 'flex-start' }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 6, backgroundColor: a.level === 'high' ? colors.warn : colors.ink40 }} />
            <Text variant="secondarySm" color={a.level === 'high' ? colors.warn : colors.ink70} style={{ flex: 1 }}>
              {a.text}
            </Text>
          </View>
        ))
      )}
    </SheetCard>
  );
}

/** One of your positions, read from the chain by the desk: distance to liquidation, drawn, and its funding now. */
function PositionRisk({ p, market }: { p: DeskPosition; market: PerplMarketRisk | undefined }) {
  const d = p.liqDistance;
  const tone = d === null ? colors.ink40 : d < 0.1 ? colors.down : d < 0.25 ? colors.warn : colors.up;
  const fill = d === null ? 0 : Math.max(0.04, Math.min(1, d / 0.5));
  const fund = fundingPerHourUsd(p, market);
  return (
    <SheetCard bordered borderRadius={radius.panel} padding={space.s14}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', gap: space.s8, alignItems: 'center' }}>
          <Text variant="rowPrimary">{p.market}</Text>
          <Tag small label={p.long ? 'Long' : 'Short'} tone={p.long ? 'up' : 'down'} />
        </View>
        <Text variant="rowPrimary">{p.mark !== null ? price(p.mark) : '—'}</Text>
      </View>
      {d !== null ? (
        <>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.neutralBg, overflow: 'hidden', marginTop: space.s10 }}>
            <View style={{ width: `${fill * 100}%`, height: 6, backgroundColor: tone }} />
          </View>
          <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s4 }}>
            {`Liquidation ${p.liquidation !== null ? price(p.liquidation) : '—'} · ${percent(d * 100, { digits: 1, explicitSign: false })} away`}
          </Text>
        </>
      ) : (
        <Text variant="footnote" color={colors.ink40} style={{ marginTop: space.s6 }}>
          Liquidation price not readable for this position.
        </Text>
      )}
      <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s4 }}>
        {fund === null ? 'Funding: no current rate' : fund === 0 ? 'Funding: flat now' : fund > 0 ? `Pays ${usdPerHour(fund)} in funding at the current rate` : `Earns ${usdPerHour(fund)} in funding at the current rate`}
      </Text>
    </SheetCard>
  );
}

function MarketCard({ m, hours, now }: { m: PerplMarketRisk; hours: number; now: number }) {
  const age = ageOf(m.at, now);
  const paid = longsPaid(m, hours);
  const pts = m.funding.points.map((p) => p.pctPerHour);
  return (
    <SheetCard bordered borderRadius={radius.panel} padding={space.s14}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text variant="rowPrimary">{m.name}</Text>
        <Text variant="rowPrimary">{m.mark !== null ? price(m.mark) : '—'}</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.s6, gap: space.s8 }}>
        <Text variant="footnote" color={colors.ink65}>
          {whoPays(m.fundingNowPctPerHour)}
        </Text>
        <Text variant="footnote" color={colors.ink55}>
          {`${m.oiUsd !== null ? `${money(m.oiUsd, { decimals: 0 })} open` : 'Open interest not stated'}${m.spreadBps !== null ? ` · ${m.spreadBps.toLocaleString('en-US', { maximumFractionDigits: 1 })} bps wide` : ''}`}
        </Text>
      </View>
      <FundingStrip values={pts} label={`${m.name} funding over ${windowWords(hours)}: ${paid ?? 'no history'}`} />
      <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s6 }}>
        {paid ?? `No funding history in ${windowWords(hours)}`}
      </Text>
      {m.price ? (
        <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s4 }}>
          {`Price ${percent(m.price.changePct, { digits: 2 })} in ${windowWords(hours)} · ${price(m.price.low)}–${price(m.price.high)} · ${m.price.trades.toLocaleString('en-US')} trades`}
        </Text>
      ) : null}
      {age ? (
        <Text variant="footnoteSm" color={age.stale ? colors.warn : colors.ink40} style={{ marginTop: space.s4 }}>
          {age.stale ? `Stale: Perpl last updated this ${age.text}` : `Updated ${age.text}`}
        </Text>
      ) : null}
    </SheetCard>
  );
}

export default function PerplRisk() {
  const goBack = useGoBack();
  const router = useRouter();
  const [win, setWin] = useState<Win>('24');
  const hours = Number(win);
  const risk = useAsync(() => perps.risk(hours), [hours]);
  const { authenticated } = useAuth();
  // Your side of the risk: only where the desk trades (Perpl testnet), and only signed in — the desk is yours.
  const withDesk = PERPL_DESK_HERE && authenticated;
  const desk = useAsync(() => (withDesk ? perps.desk() : Promise.resolve(null)), [withDesk]);
  // Ticks every 5 s so "Updated 3s ago" keeps counting, and a render never reads the clock itself (lint, CI).
  const now = useNow(5_000);

  const markets = useMemo(() => risk.data?.markets ?? [], [risk.data]);
  const positions = useMemo(() => desk.data?.positions ?? [], [desk.data]);
  const byId = useMemo(() => new Map(markets.map((m) => [m.id, m])), [markets]);
  const alerts = useMemo(() => riskAlerts(markets, hours, now, positions), [markets, hours, now, positions]);
  const totalOi = markets.reduce((sum, m) => sum + (m.oiUsd ?? 0), 0);
  const longsPay = markets.filter((m) => (m.fundingNowPctPerHour ?? 0) > 0).length;
  const shortsPay = markets.filter((m) => (m.fundingNowPctPerHour ?? 0) < 0).length;
  const crowdedYear = markets.length > 0 ? Math.max(...markets.map((m) => Math.abs(aprOf(m.fundingNowPctPerHour ?? 0)))) : 0;
  const blocked = (risk.data?.geoBlock ?? []).map((c) => COUNTRY[c] ?? c);

  return (
    <Screen gutter="none">
      <View style={{ paddingHorizontal: space.gutter }}>
        <HeaderBar onBack={goBack} title={<Text variant="screenTitle">Perpl risk</Text>} />
        <Text variant="secondary" color={colors.ink55} style={{ marginTop: space.s6 }}>
          {ON_TESTNET
            ? 'Monad’s perps exchange on testnet, where your desk trades. Read live.'
            : ON_FORK && PERPL_DESK_HERE
              ? 'Monad’s perps exchange, read live from mainnet; your desk trades its book on this fork.'
              : 'Monad’s perps exchange, read live from mainnet.'}
        </Text>
        <Segmented options={WINDOWS} value={win} onChange={setWin} style={{ marginTop: space.s16 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: space.gutter, gap: space.s12, paddingBottom: space.s44 }}>
        {risk.error ? <ErrorState error={risk.error} onRetry={risk.reload} /> : null}
        {!risk.data && !risk.error ? <LoadingRows count={4} height={size.rowLg} /> : null}

        {risk.data ? (
          <>
            <SheetCard bordered borderRadius={radius.panel} padding={space.s16} tone="accent">
              <Glow strength={0.25} style={{ top: -30, left: -40, right: 140, bottom: 10 }} />
              <Text variant="footnote" color={colors.eyebrow}>
                OPEN INTEREST
              </Text>
              <Text variant="heroBalance" style={{ marginTop: space.s4 }}>
                {money(totalOi, { decimals: 0 })}
              </Text>
              <Text variant="secondarySm" color={colors.ink55} style={{ marginTop: space.s6 }}>
                {`Across ${markets.length} open markets. Longs pay funding on ${longsPay}, shorts on ${shortsPay}.${crowdedYear > 0 ? ` The most crowded pays ${percent(crowdedYear, { digits: 0, explicitSign: false })} a year at its current rate.` : ''}`}
              </Text>
            </SheetCard>
            <Alerts alerts={alerts} />
          </>
        ) : null}

        {positions.length > 0 ? (
          <>
            <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s8 }}>
              YOUR POSITIONS
            </Text>
            {positions.map((p) => (
              <PositionRisk key={p.perpId} p={p} market={byId.get(p.perpId)} />
            ))}
          </>
        ) : null}

        {markets.length > 0 ? (
          <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s8 }}>
            MARKETS · MOST CROWDED FIRST
          </Text>
        ) : null}
        {markets.map((m) => (
          <MarketCard key={m.id} m={m} hours={hours} now={now} />
        ))}

        {blocked.length > 0 ? (
          <Text variant="footnote" color={colors.ink55}>
            {`Perpl does not offer trading in ${blocked.join(', ')}.`}
          </Text>
        ) : null}
        <Text variant="footnote" color={colors.ink40}>
          {`From Perpl’s public API${risk.data ? ` (${risk.data.network})` : ''}: market context, every funding payment and hourly candles. Bars above the line are payments longs made; below, payments shorts made. Funding is per hour.`}
        </Text>
        {PERPL_DESK_HERE ? <Button label="Trade on your desk" onPress={() => router.push('/perps')} /> : null}
      </ScrollView>
    </Screen>
  );
}
