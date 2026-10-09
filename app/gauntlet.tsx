/**
 * The gauntlet (docs/ROADMAP-WIN.md F5, 2026-10-07).
 *
 * The strategy library was a list on Home with one line above it: "313 tested · 10 survived". The research behind that
 * line — what each strategy had to get through, and where the other 303 fell — was the strongest thing about it and
 * nowhere on screen. This is that research as a page:
 *
 *   the funnel: 313 backtested, then out of sample, the parameter sweep, double commission and the other assets, each
 *   stage's survivors counted from the book's own failures (`server/src/strategies/library.ts`);
 *   the book, filtered by family, survivors first, each with its out-of-sample numbers — never the in-sample ones — and,
 *   for the cut, the stage it fell at. Tap one for its full record.
 *
 * Backtests, and the page says so: nothing here is a live track record.
 */
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useGoBack } from '@/nav/useGoBack';
import { ErrorState, Fill, HeaderBar, LoadingRows, Pill, PillRow, Press, Screen, SheetCard, Text, colors, radius, size, space } from '@/ui';
import { Rise } from '@/ui/Rise';
import { useAsync } from '@/data/useAsync';
import { toMinus } from '@/format';
import { strategyLibrary, type Gauntlet, type GauntletStage, type StrategySummary } from '@/data/strategyLibrary';

const FELL_AT: Record<GauntletStage, string> = {
  oos: 'failed out of sample',
  sweep: 'failed the parameter sweep',
  commission: 'failed double commission',
  assets: 'failed across assets',
};

// A real minus, as every other figure in the app (format/toMinus).
const pct = (n: number | null, signed = true) =>
  n === null ? '—' : toMinus(`${signed && n > 0 ? '+' : ''}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);

/** Each stage as a bar, its width the share of all tested that got through it; what it cut beside it. */
function Funnel({ g }: { g: Gauntlet }) {
  const rows = [{ key: 'tested', label: 'Backtested', passed: g.tested }, ...g.stages];
  return (
    <SheetCard bordered tone="accent" borderRadius={radius.panel} padding={space.s16} testID="gauntlet-funnel">
      <Text variant="eyebrow">The gauntlet</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s8, marginTop: space.s6 }}>
        <Text variant="heroBalance">{g.tested.toLocaleString('en-US')}</Text>
        <Text variant="secondary" color={colors.ink55}>
          in
        </Text>
        <Text variant="heroBalance" color={colors.up}>
          {g.stages.at(-1)?.passed ?? 0}
        </Text>
        <Text variant="secondary" color={colors.ink55}>
          out
        </Text>
      </View>
      <View style={{ marginTop: space.s14, gap: space.s10 }}>
        {rows.map((r, i) => {
          const share = g.tested > 0 ? r.passed / g.tested : 0;
          const cut = i > 0 ? rows[i - 1]!.passed - r.passed : 0;
          const last = i === rows.length - 1;
          return (
            <Rise key={r.key} index={i}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s10 }}>
                <Text variant="secondarySm" color={colors.ink70} style={{ flexShrink: 1 }}>
                  {r.label}
                </Text>
                <Text variant="secondarySm" color={last ? colors.up : colors.ink}>
                  {`${r.passed.toLocaleString('en-US')}${cut > 0 ? `  (−${cut.toLocaleString('en-US')})` : ''}`}
                </Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.control, marginTop: space.s4 }}>
                <View
                  style={{
                    width: `${Math.max(1.5, share * 100)}%`,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: last ? colors.up : colors.accent,
                    boxShadow: last ? `0px 0px 8px ${colors.up}` : undefined,
                  }}
                />
              </View>
            </Rise>
          );
        })}
      </View>
    </SheetCard>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text variant="footnoteSm" color={colors.ink40}>
        {label}
      </Text>
      <Text variant="secondarySm" color={tone ?? colors.ink} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function StrategyCard({ s, onOpen }: { s: StrategySummary; onOpen: () => void }) {
  const r = s.returnPct;
  return (
    <Press onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${s.name}, ${s.survives ? 'survived' : 'cut'}`} testID={`gauntlet-strategy-${s.id}`}>
      <SheetCard bordered borderRadius={radius.panel} padding={space.s14} tone={s.survives ? 'accent' : 'default'}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s10 }}>
          <View style={{ flex: 1 }}>
            <Text variant="rowPrimary" numberOfLines={1}>
              {s.name}
            </Text>
            <Text variant="footnote" color={colors.ink55}>
              {s.family ?? 'Backtested'}
            </Text>
          </View>
          <View style={{ paddingHorizontal: space.s8, paddingVertical: 3, borderRadius: radius.card, backgroundColor: s.survives ? colors.upBg : colors.neutralBg }}>
            <Text variant="footnoteSm" color={s.survives ? colors.up : colors.ink55}>
              {s.survives ? 'Survived' : (s.failedReason ?? (s.failedStage ? FELL_AT[s.failedStage] : 'Cut'))}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: space.s10, marginTop: space.s10 }}>
          <Metric label="Return (OOS)" value={pct(r)} tone={r === null ? colors.ink55 : r > 0 ? colors.up : r < 0 ? colors.down : colors.ink55} />
          <Metric label="Trades" value={s.trades === null ? '—' : s.trades.toLocaleString('en-US')} />
        </View>
      </SheetCard>
    </Press>
  );
}

export default function GauntletScreen() {
  const goBack = useGoBack();
  const router = useRouter();
  const [all, setAll] = useState(false);
  const [family, setFamily] = useState<string | null>(null);
  const [how, setHow] = useState(false);
  const page = useAsync(() => strategyLibrary.list({ all, family: family ?? undefined }), [all, family]);
  // The families come from the whole book, so the chips do not change under the reader as the filter does.
  const book = useAsync(() => strategyLibrary.list({ all: true }), []);
  const d = page.data;
  const rows = d ? [...d.strategies].sort((a, b) => Number(b.survives) - Number(a.survives) || (b.returnPct ?? -1e9) - (a.returnPct ?? -1e9)) : [];
  const families = book.data?.families ?? d?.families ?? [];
  return (
    <Screen gutter="none">
      <View style={{ paddingHorizontal: space.gutter }}>
        <HeaderBar onBack={goBack} title={<Text variant="screenTitle">The gauntlet</Text>} />
        <Text variant="secondary" color={colors.ink55} style={{ marginTop: space.s6 }}>
          Every strategy the agents can run was backtested, then made to get through four tests on data it never saw.
        </Text>
      </View>
      <Fill style={{ marginTop: space.s12 }}>
        {page.error && !d ? (
          <View style={{ paddingHorizontal: space.gutter }}>
            <ErrorState error={page.error} onRetry={page.reload} />
          </View>
        ) : !d ? (
          <View style={{ paddingHorizontal: space.gutter }}>
            <LoadingRows count={4} height={size.rowLg} />
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space.s30, gap: space.s10 }}>
            <View style={{ paddingHorizontal: space.gutter, gap: space.s10 }}>
              {(book.data?.gauntlet ?? d.gauntlet) ? <Funnel g={(book.data?.gauntlet ?? d.gauntlet)!} /> : null}
              <Press onPress={() => setHow(!how)} accessibilityRole="button" accessibilityState={{ expanded: how }} hitHeight={size.hit} testID="gauntlet-how" style={{ alignSelf: 'flex-start' }}>
                <Text variant="footnote" color={colors.ink55}>
                  {how ? 'Hide how it was tested' : 'How it was tested'}
                </Text>
              </Press>
              {how ? (
                <Text variant="footnote" color={colors.ink55}>
                  {`${d.provenance.method.charAt(0).toUpperCase()}${d.provenance.method.slice(1)}. ${d.provenance.caveat}`}
                </Text>
              ) : null}
            </View>
            <PillRow contentPadding={space.gutter}>
              <Pill label="Every family" selected={family === null} onPress={() => setFamily(null)} />
              {families.map((f) => (
                <Pill key={f.name} label={`${f.name} · ${f.survivors}/${f.count}`} selected={family === f.name} onPress={() => setFamily(f.name)} />
              ))}
            </PillRow>
            <View style={{ paddingHorizontal: space.gutter, gap: space.s10 }} testID="gauntlet-list">
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="secondarySm" color={colors.ink70}>
                  {all ? `${rows.length} ${family ? `in ${family}` : 'tested'}` : `${rows.length} survived${family ? ` in ${family}` : ''}`}
                </Text>
                <Press onPress={() => setAll(!all)} accessibilityRole="button" hitHeight={size.hit} testID="gauntlet-show-all">
                  <Text variant="control" color={colors.accentHi}>
                    {all ? 'Only the survivors' : 'Show the cut too'}
                  </Text>
                </Press>
              </View>
              {rows.length === 0 ? (
                <Text variant="secondary" color={colors.ink55}>
                  {`None of this family survived. ${all ? '' : 'Show the cut to see where each fell.'}`}
                </Text>
              ) : (
                rows.slice(0, 60).map((s, i) => (
                  // The first of the cut is marked, so a reader (and the shot) can find where the survivors end.
                  <View key={s.id} testID={!s.survives && (i === 0 || rows[i - 1]!.survives) ? 'gauntlet-first-cut' : undefined}>
                    <StrategyCard s={s} onOpen={() => router.push(`/strategy-library/${s.id}`)} />
                  </View>
                ))
              )}
              {rows.length > 60 ? (
                <Text variant="footnote" color={colors.ink55}>{`And ${rows.length - 60} more — narrow it by family.`}</Text>
              ) : null}
            </View>
          </ScrollView>
        )}
      </Fill>
    </Screen>
  );
}
