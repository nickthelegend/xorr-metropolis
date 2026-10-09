/**
 * Explore — one door to everything the app can show about itself, grouped by the question it answers.
 *
 * It opens on the story (2026-10-08, docs/ROADMAP-WIN.md W1): a judge who opened Explore met twenty links from four
 * builds — Disposals and Export beside the council — and left the story. Now the first screen is what xorr is about on
 * Monad, as six lit tiles, then the four places your own money shows, then one "Everything else" that opens the full
 * list below. Nothing is removed; every screen is still one tap away.
 *
 * A screen nobody can reach is worse than no screen, and thirty-odd surfaces cannot each earn a row in Settings. Not a
 * search field: thirty items is a list you scan. Distilled 2026-09-14 (PLAN.md O3): a title and a few words per row,
 * and no network or venue names — those live on How it works.
 */
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useGoBack } from '@/nav/useGoBack';
import { Eyebrow, Fill, Glow, HeaderBar, Press, Screen, SheetCard, Text, colors, divider, radius, size, space } from '@/ui';
import { Rise } from '@/ui/Rise';
import { Icon, type IconName } from '@/design/Icon';
import { shownHere } from '@/nav/buildRoutes';

type Item = { route: string; title: string; detail: string };
type Group = { title: string; items: Item[] };

/** Each `detail` says what the screen shows, in a few words, rather than restating its title. */
const GROUPS: Group[] = [
  {
    title: 'Money',
    items: [
      { route: '/deposit', title: 'Deposit', detail: 'Add funds' },
      { route: '/swap', title: 'Swap', detail: 'One token for another' },
      { route: '/withdraw-everything', title: 'Withdraw everything', detail: 'Sell and send it all' },
      { route: '/history', title: 'History', detail: 'Every settled trade' },
      { route: '/pnl', title: 'Realised', detail: 'Profit on closed positions' },
      { route: '/limits', title: 'Today’s limit', detail: 'Spent and left' },
      { route: '/allocation', title: 'Allocation', detail: 'Where the money sits' },
      { route: '/balance', title: 'Balance', detail: 'Cash, held and earning' },
      { route: '/spend', title: 'Spend', detail: 'Day by day' },
      { route: '/rates', title: 'Rate', detail: 'What idle cash earns' },
      { route: '/disposals', title: 'Disposals', detail: 'Cost basis per sale' },
      { route: '/export', title: 'Export', detail: 'Files for an accountant' },
      { route: '/sell-everything', title: 'What would sell', detail: 'A preview first' },
    ],
  },
  {
    title: 'Markets',
    items: [
      /*
        The four that worked and had no way in (docs/qa/SCREENS.md, "Orphaned routes"), titled as each screen titles
        itself. `/watchlist` calls itself "Markets" too, so its detail is what tells the two apart.
      */
      { route: '/markets', title: 'Markets', detail: 'Every class, priced' },
      { route: '/search', title: 'Search', detail: 'Find a market' },
      { route: '/watchlist', title: 'Markets', detail: 'Three short lists' },
      { route: '/limit-orders', title: 'Limit orders', detail: 'Take a signed price' },
      { route: '/crosschain', title: 'Cross-chain', detail: 'Quotes to other chains' },
      { route: '/movers', title: 'Movers', detail: 'Biggest moves today' },
      { route: '/xstocks', title: 'Stocks', detail: 'Stock Tokens' },
      { route: '/earnings', title: 'Earnings', detail: 'Filing dates' },
      { route: '/funding', title: 'Funding', detail: 'Perpetual funding rates' },
      { route: '/compare', title: 'Compare', detail: 'Two instruments, one range' },
      { route: '/tokens', title: 'Tokens', detail: 'What can be traded' },
      { route: '/coverage', title: 'Coverage', detail: 'Priced against tradable' },
    ],
  },
  {
    title: 'Activity',
    items: [
      // The one place a strategy can be paused, and it had no row: only agent pages and strategy alerts led there.
      { route: '/strategies', title: 'Strategies', detail: 'What runs, and pausing it' },
      { route: '/gauntlet', title: 'The gauntlet', detail: '313 strategies tested, 10 survived' },
      { route: '/runs', title: 'Runs', detail: 'Fills and refusals' },
      { route: '/council', title: 'Council', detail: 'Every vote, beside its transaction' },
      { route: '/hedge', title: 'Hedge', detail: 'GMX perps, funding and your positions' },
      { route: '/perps', title: 'Perps', detail: 'Perpl, traded by your agent — it can never withdraw' },
      { route: '/perpl', title: 'Perpl live', detail: 'Every market: open interest, funding, the book' },
      { route: '/proposals', title: 'Proposals', detail: 'Asked and answered' },
      { route: '/catchup', title: 'Since you looked', detail: 'While you were away' },
      { route: '/schedule', title: 'What runs next', detail: 'Upcoming runs' },
      { route: '/backtest', title: 'Backtest', detail: 'A weekly buy, on real prices' },
      { route: '/roster-compare', title: 'Compare agents', detail: 'Side by side' },
      { route: '/risk', title: 'Risk limits', detail: 'Per agent' },
      { route: '/voice', title: 'Voice', detail: 'How the bot talks' },
      { route: '/bot/roster', title: 'Agents', detail: 'Hire or let go' },
      { route: '/bot/leaderboard', title: 'Leaderboard', detail: 'Agents, ranked' },
      { route: '/briefing', title: 'Briefing', detail: 'Headlines, and what agents did' },
    ],
  },
  {
    title: 'Proof',
    items: [
      { route: '/judges', title: 'For judges', detail: 'Each bounty, and where it is met' },
      { route: '/monad', title: 'Built on Monad', detail: 'Monad’s own tech, read live' },
      { route: '/verify', title: 'Verification', detail: 'Live checks, with evidence' },
      { route: '/judge', title: 'Check it yourself', detail: 'Every claim, run again' },
      { route: '/sponsors', title: 'How it works', detail: 'The tech behind xorr' },
      { route: '/delegation', title: 'Permission', detail: 'Key, venues, cap, expiry' },
      { route: '/approvals', title: 'Approvals', detail: 'What can be pulled' },
      { route: '/policy', title: 'Wallet policy', detail: 'What your wallet refuses' },
      { route: '/venues', title: 'Venues', detail: 'Where fills may go' },
      { route: '/audit/chain', title: 'Audit trail', detail: 'Whether the record holds' },
      { route: '/sources', title: 'Sources', detail: 'Where each number comes from' },
    ],
  },
  {
    title: 'System',
    items: [
      { route: '/system', title: 'System', detail: 'Services and their health' },
      { route: '/network', title: 'Network', detail: 'Where this app runs' },
      { route: '/networks', title: 'Networks', detail: 'Every network xorr runs on' },
      { route: '/metrics', title: 'Metrics', detail: 'What has been done' },
      { route: '/graph', title: 'Index', detail: 'How current it is' },
      { route: '/graph/spends', title: 'Indexed spends', detail: 'The same money, recorded twice' },
      { route: '/graph/decision', title: 'Routing', detail: 'How a trade is routed' },
    ],
  },
  {
    title: 'Account',
    items: [
      { route: '/profile', title: 'This wallet', detail: 'Address and activity' },
      { route: '/business', title: 'Business', detail: 'A treasury the bot trades' },
      { route: '/basename', title: 'Names', detail: 'Names for addresses' },
      { route: '/notifications', title: 'Notifications', detail: 'What interrupts you' },
    ],
  },
];

type Story = { route: string; params?: Record<string, string>; title: string; detail: string; icon: IconName };
/** The story, first: what xorr is about on Monad, each a screen that shows it rather than says it. */
const STORY: Story[] = [
  { route: '/monad', title: 'Built on Monad', detail: 'Blocks going final, live; your passkey checked on chain', icon: 'activity' },
  { route: '/council', title: 'The council', detail: 'Every trade voted on; replay any round', icon: 'sparkle' },
  { route: '/gauntlet', title: 'The gauntlet', detail: '313 strategies tested, 10 survived', icon: 'strategies' },
  { route: '/runs', title: 'Fills, timed', detail: 'Each one’s speed and cost on Monad', icon: 'swapH' },
  { route: '/perps', title: 'Perps on Perpl', detail: 'A desk only you can withdraw from', icon: 'markets' },
  { route: '/how', params: { from: 'settings' }, title: 'How xorr works', detail: 'Three steps, in a minute', icon: 'chat' },
];
/** Then the four places your own money shows. */
const YOURS: Item[] = [
  { route: '/deposit', title: 'Deposit', detail: 'Add funds' },
  { route: '/history', title: 'History', detail: 'Every settled trade' },
  { route: '/limits', title: 'Today’s limit', detail: 'Spent and left' },
  { route: '/delegation', title: 'Permission', detail: 'Key, venues, cap, expiry' },
];

/** The groups as this build draws them: a screen this build does not have is not listed (`src/nav/buildRoutes.ts`). */
const STORY_SHOWN = STORY.filter((i) => shownHere(i.route));
const YOURS_SHOWN = YOURS.filter((i) => shownHere(i.route));
const UP_TOP = new Set([...STORY_SHOWN, ...YOURS_SHOWN].map((i) => i.route));
// "Everything else": the full list, less what the top already shows.
const SHOWN: Group[] = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => shownHere(i.route) && !UP_TOP.has(i.route)) })).filter(
  (g) => g.items.length > 0,
);
const ELSEWHERE = SHOWN.reduce((n, g) => n + g.items.length, 0);

function ExploreRow({ item, onPress }: { item: Item; onPress: () => void }) {
  return (
    <Press
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.detail}`}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: space.s12, minHeight: size.rowLg, paddingVertical: space.s10 }, divider]}
    >
      <View style={{ flex: 1 }}>
        <Text variant="rowPrimary">{item.title}</Text>
        <Text variant="secondarySm" color={colors.ink55} style={{ marginTop: space.s2 }}>
          {item.detail}
        </Text>
      </View>
      <Icon name="chevron" size={14} color={colors.ink30} />
    </Press>
  );
}

export default function Explore() {
  const goBack = useGoBack();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <Screen gutter="none">
      <View style={{ paddingHorizontal: space.gutter }}>
        <HeaderBar onBack={goBack} title={<Text variant="screenTitle">Explore</Text>} />
      </View>

      <Fill style={{ marginTop: space.s8 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.s30 }}
        >
          <Eyebrow style={{ marginTop: space.s16 }}>The story</Eyebrow>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s10, marginTop: space.s10 }}>
            {STORY_SHOWN.map((t, i) => (
              <Rise key={t.route} index={i} style={{ width: '48%', flexGrow: 1 }}>
                <Press
                  onPress={() => router.push((t.params ? { pathname: t.route, params: t.params } : t.route) as never)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.title}. ${t.detail}`}
                  testID={`explore-story-${t.route.slice(1)}`}
                >
                  <SheetCard bordered tone={i === 0 ? 'accent' : 'default'} borderRadius={radius.panel} padding={space.s14} style={{ minHeight: 118 }}>
                    {i === 0 ? <Glow strength={0.2} style={{ top: -20, left: -20, right: 40, bottom: 20 }} /> : null}
                    <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine }}>
                      <View>
                        <Icon name={t.icon} size={15} color={colors.accentHi} strokeWidth={2} />
                      </View>
                    </View>
                    <Text variant="rowPrimary" style={{ marginTop: space.s10 }}>
                      {t.title}
                    </Text>
                    <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s2 }}>
                      {t.detail}
                    </Text>
                  </SheetCard>
                </Press>
              </Rise>
            ))}
          </View>

          <View style={{ marginTop: space.s22 }}>
            <Eyebrow>Your money</Eyebrow>
            {YOURS_SHOWN.map((item) => (
              <ExploreRow key={item.route} item={item} onPress={() => router.push(item.route as never)} />
            ))}
          </View>

          <Press
            onPress={() => setOpen(!open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={open ? 'Hide everything else' : `Everything else, ${ELSEWHERE} screens`}
            testID="explore-everything"
            style={{ marginTop: space.s16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: size.rowLg }}
          >
            <View>
              <Text variant="rowPrimary">{open ? 'Hide everything else' : 'Everything else'}</Text>
              <Text variant="secondarySm" color={colors.ink55} style={{ marginTop: space.s2 }}>
                {`${ELSEWHERE} more screens: money, markets, agents, proof, the system`}
              </Text>
            </View>
            <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
              <Icon name="chevron" size={14} color={colors.ink55} />
            </View>
          </Press>

          {open
            ? SHOWN.map((g) => (
                <View key={g.title} style={{ marginTop: space.s22 }} testID="explore-group">
                  <Eyebrow>{g.title}</Eyebrow>
                  {g.items.map((item) => (
                    <ExploreRow key={item.route} item={item} onPress={() => router.push(item.route as never)} />
                  ))}
                </View>
              ))
            : null}
        </ScrollView>
      </Fill>
    </Screen>
  );
}
