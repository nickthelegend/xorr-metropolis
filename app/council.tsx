/**
 * The council: every trade the agents proposed, how each seat voted and why, and the transaction it produced
 * (PLAN.md P3.4).
 *
 * A round is shown exactly as the executor stored it. A vote's reason carries the numbers it rested on — the session,
 * the Chainlink price and its age, the pool's price, GMX funding, the cap left today — so a reader can check every vote
 * against what it saw. On Monad the seats read Monad's own: Chainlink on Monad against the fill's venue and Kuru's book,
 * and Perpl's funding; the council is asked about MON, ETH and BTC, the assets with a Monad feed and a Perpl market. The hash is the chain's: an explorer link where one exists, the bare hash on a fork.
 */
import React, { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useGoBack } from '@/nav/useGoBack';
import { Rise } from '@/ui/Rise';
import { LinearGradient } from 'expo-linear-gradient';
import {
  AgentOrb,
  Button,
  EmptyState,
  ErrorState,
  Fill,
  HeaderBar,
  LoadingRows,
  Pill,
  PillRow,
  Press,
  Screen,
  SheetCard,
  Tag,
  Text,
  colors,
  glow,
  money,
  radius,
  size,
  space,
} from '@/ui';
import { shortAddress, when } from '@/format';
import { repos } from '@/data';
import type { Agent } from '@/data/types';
import { convenedByLabel, roundSigner } from '@/agents/agentPermission';
import { useAsync } from '@/data/useAsync';
import { apiProse } from '@/data/apiError';
import { council, voteToFillSec, type CouncilBallot, type CouncilRound } from '@/data/council';
import { CHAIN_KEY, onMonad } from '@/chain';
import { SEAT_GRADIENT, SEAT_NAMES, SEAT_SHORT, decisionBg, decisionTone, outcomeLine, voteColor, voteTone } from '@/council/seats';
import { SEAT_ORDER, seated } from '@/council/replay';
import { useNow } from '@/state/useNow';

// What the executor's council can be asked about here (`/council/seats`): Stock Tokens, or on Monad MON, ETH and BTC.
const SYMBOLS: readonly string[] = onMonad ? ['MON', 'ETH', 'BTC'] : ['NVDA', 'TSLA', 'AAPL', 'SPY'];
const SIZES = [25, 50, 100] as const;

const SEATS = SEAT_ORDER;

/** The bench: every seat's face, the Strategist dimmed when it has no key to sit with. */
function Bench({ strategistOff }: { strategistOff: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.s16 }}>
      {SEATS.map((seat, i) => {
        const off = seat === 'strategist' && strategistOff;
        return (
          <Rise key={seat} index={i} style={{ alignItems: 'center', gap: space.s6, opacity: off ? 0.35 : 1 }}>
            <AgentOrb gradient={SEAT_GRADIENT[seat]} size={52} face identity={SEAT_NAMES[seat]} bloom={!off} />
            <Text variant="secondarySm" color={off ? colors.ink40 : colors.ink70}>
              {SEAT_SHORT[seat]}
            </Text>
          </Rise>
        );
      })}
    </View>
  );
}

/** A seat's colour, small, beside its vote. */
function SeatDot({ seat }: { seat: CouncilBallot['persona'] }) {
  const g = SEAT_GRADIENT[seat];
  return (
    <View style={{ width: 18, height: 18, borderRadius: 9, marginTop: 1, boxShadow: `0px 0px 10px ${g.c1}66` }}>
      <LinearGradient colors={[g.c1, g.c2]} start={{ x: 0.2, y: 0.1 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1, borderRadius: 9 }} />
    </View>
  );
}

function TxLine({ round }: { round: CouncilRound }) {
  if (!round.txHash) return null;
  const short = `${round.txHash.slice(0, 10)}…${round.txHash.slice(-6)}`;
  const url = round.txLink && /^https?:/.test(round.txLink) ? round.txLink : null;
  return (
    <Text
      variant="footnote"
      color={url ? colors.ink : colors.ink55}
      style={{ marginTop: space.s6 }}
      onPress={url ? () => void Linking.openURL(url) : undefined}
    >
      {url ? `View ${short}` : `${short} · on the fork`}
    </Text>
  );
}

/** The roster, for naming the agent that proposed a round and the wallet that signed it. */
type Roster = readonly Pick<Agent, 'id' | 'personaId' | 'name' | 'wallet'>[] | undefined;

/** A round this fresh was just convened on this screen: its seats are revealed one by one (FEATURES-100 #25). */
const REVEAL_WITHIN_MS = 60_000;

function RoundCard({ round, roster, latest = false }: { round: CouncilRound; roster: Roster; latest?: boolean }) {
  const p = round.proposal;
  // Each seat arrives in turn and the outcome after them, so a person watches the vote happen. Older rounds are still.
  // The clock is a hook, not `Date.now()` in the render: a render must not read an impure value (it failed lint and CI).
  const now = useNow(15_000);
  const fresh = now - Date.parse(round.createdAt) < REVEAL_WITHIN_MS;
  const beat = (at: number, key: string, node: React.ReactNode) =>
    fresh ? (
      <Rise key={key} index={at}>
        {node}
      </Rise>
    ) : (
      <React.Fragment key={key}>{node}</React.Fragment>
    );
  // An executed agent round was signed by that agent's own wallet (individual agents, 2026-09-23).
  const signer = round.outcome === 'executed' && round.txHash ? roundSigner(round.convenedBy, roster) : undefined;
  const router = useRouter();
  return (
    <SheetCard bordered borderRadius={radius.panel} padding={space.s16} tone={latest ? 'accent' : 'default'}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s8 }}>
        <Text variant="rowPrimary" style={{ flexShrink: 1 }}>
          {p.side === 'buy' ? 'Buy' : 'Sell'} {money(p.usd)} {p.symbol}
        </Text>
        {/* The verdict as a lit chip: the one word on the card everything else explains. */}
        <View
          style={{
            paddingHorizontal: space.s10,
            paddingVertical: space.s4,
            borderRadius: radius.card,
            backgroundColor: decisionBg(round.decision),
            boxShadow: round.decision === 'approved' ? glow.up : undefined,
          }}
        >
          <Text variant="control" color={decisionTone(round.decision)}>
            {round.summary}
          </Text>
        </View>
      </View>
      {/* The tally, one segment per seat in the order they sat. */}
      <View style={{ flexDirection: 'row', gap: space.s4, marginTop: space.s12 }}>
        {seated(round.votes).map((v) => (
          <View key={v.persona} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: voteColor(v.vote), opacity: v.vote === 'abstain' ? 1 : 0.9 }} />
        ))}
      </View>
      <View style={{ marginTop: space.s14, gap: space.s10 }}>
        {seated(round.votes).map((v, i) =>
          beat(
            i + 1,
            v.persona,
            <View style={{ flexDirection: 'row', gap: space.s10, alignItems: 'flex-start' }}>
              <SeatDot seat={v.persona} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s8 }}>
                  <Text variant="secondarySm" color={colors.ink}>
                    {SEAT_NAMES[v.persona]}
                  </Text>
                  <Tag label={v.vote} tone={voteTone(v.vote)} small />
                </View>
                <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s2 }}>
                  {v.reason}
                </Text>
              </View>
            </View>,
          ),
        )}
      </View>
      {beat(
        round.votes.length + 1,
        'outcome',
        <>
          <Text variant="footnote" color={colors.ink65} style={{ marginTop: space.s10 }}>
            {outcomeLine(round)}
            {/* The whole round, measured: from convening the desks to the trade confirmed (ROADMAP-WIN F1). */}
            {voteToFillSec(round) !== null ? (
              <Text variant="footnote" color={colors.accentHi} testID="council-vote-to-fill">
                {` · vote to fill in ${voteToFillSec(round)!.toLocaleString('en-US', { maximumFractionDigits: 1 })} s`}
              </Text>
            ) : null}
          </Text>
          <TxLine round={round} />
        </>,
      )}
      {signer ? (
        <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s4 }} selectable>
          signed by {shortAddress(signer)}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s10, marginTop: space.s6 }}>
        <Text variant="footnoteSm" color={colors.ink40} style={{ flexShrink: 1 }}>
          {when(new Date(round.createdAt).getTime())} · {convenedByLabel(round.convenedBy, roster)}
        </Text>
        {/* The round played back seat by seat, with what each desk read (ROADMAP-WIN F3). */}
        <Press
          onPress={() => router.push({ pathname: '/council/[id]', params: { id: round.id } })}
          accessibilityRole="button"
          accessibilityLabel={`Replay the vote on ${p.side === 'buy' ? 'buying' : 'selling'} ${money(p.usd)} ${p.symbol}`}
          hitHeight={size.hit}
          testID="council-replay"
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s6,
              paddingHorizontal: space.s12,
              paddingVertical: space.s6,
              borderRadius: radius.card,
              backgroundColor: colors.accentSoft,
              borderWidth: 1,
              borderColor: colors.accentLine,
            }}
          >
            <View style={{ width: 0, height: 0, borderTopWidth: 5, borderBottomWidth: 5, borderLeftWidth: 8, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: colors.accentHi }} />
            <Text variant="control" color={colors.accentHi}>
              Replay
            </Text>
          </View>
        </Press>
      </View>
    </SheetCard>
  );
}

export default function Council() {
  const goBack = useGoBack();
  const { data, loading, error, reload } = useAsync(() => council.rounds(), []);
  const strategist = useAsync(() => council.strategist(), []);
  // Names and wallets for the rounds an agent proposed. A roster that cannot be read leaves the stored tag, not a guess.
  const roster = useAsync(() => repos.bot.listAgents(), []);
  const [symbol, setSymbol] = useState<string>(SYMBOLS[0]!);
  const [usd, setUsd] = useState<(typeof SIZES)[number]>(50);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  const ask = async () => {
    setAsking(true);
    setAskError(null);
    try {
      await council.convene({ side: 'buy', symbol, usd });
      reload();
    } catch (e) {
      setAskError(apiProse(e) ?? (e instanceof Error ? e.message : 'The council could not be convened.'));
    } finally {
      setAsking(false);
    }
  };

  return (
    <Screen gutter="none">
      <View style={{ paddingHorizontal: space.gutter }}>
        <HeaderBar onBack={goBack} title={<Text variant="screenTitle">Council</Text>} />
        <Text variant="secondary" color={colors.ink55} style={{ marginTop: space.s6 }}>
          Every trade is voted on first.
        </Text>
        {strategist.data && !strategist.data.configured ? (
          // Kimi sits only with a key; without one the four desks vote and the screen says why there is no fifth seat.
          <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s4 }} testID="council-strategist-off">
            {`The Strategist seat (Kimi) is not configured on this executor — it needs ${strategist.data.needs}. Four desks vote.`}
          </Text>
        ) : null}
        <Bench strategistOff={strategist.data ? !strategist.data.configured : false} />
        {CHAIN_KEY === 'monad-testnet' ? (
          // No spot venue on Monad testnet: an approved round trades the owner's Perpl desk (`council-executor.ts`).
          <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s4 }}>
            On Monad testnet an approved buy opens a 1x long on your Perpl desk; a sell closes it.
          </Text>
        ) : null}
      </View>

      <PillRow style={{ marginTop: space.s14 }} contentPadding={space.gutter}>
        {SYMBOLS.map((s) => (
          <Pill key={s} label={s} selected={s === symbol} onPress={() => setSymbol(s)} />
        ))}
      </PillRow>
      <PillRow style={{ marginTop: space.s8 }} contentPadding={space.gutter}>
        {SIZES.map((n) => (
          <Pill key={n} label={money(n, { decimals: 0 })} selected={n === usd} onPress={() => setUsd(n)} />
        ))}
      </PillRow>
      <View style={{ paddingHorizontal: space.gutter, marginTop: space.s10 }}>
        <Button label={`Put ${money(usd, { decimals: 0 })} ${symbol} to the council`} onPress={ask} loading={asking} testID="council-convene" />
        {askError ? (
          <Text variant="footnote" color={colors.down} style={{ marginTop: space.s6 }}>
            {askError}
          </Text>
        ) : null}
      </View>

      <Fill style={{ marginTop: space.s14 }}>
        {error ? (
          <View style={{ paddingHorizontal: space.gutter }}>
            <ErrorState error={error} onRetry={reload} />
          </View>
        ) : loading && !data ? (
          <View style={{ paddingHorizontal: space.gutter }}>
            <LoadingRows count={3} height={size.rowLg} />
          </View>
        ) : (data ?? []).length === 0 ? (
          <EmptyState text="No rounds yet." />
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.s30, gap: space.s10 }}
          >
            {(data ?? []).map((r, i) => (
              <RoundCard key={r.id} round={r} roster={roster.data} latest={i === 0} />
            ))}
          </ScrollView>
        )}
      </Fill>
    </Screen>
  );
}
