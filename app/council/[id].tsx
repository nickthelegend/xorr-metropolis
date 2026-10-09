/**
 * A council round, replayed (docs/ROADMAP-WIN.md F3, 2026-10-07).
 *
 * Opened from "Replay" on a round. It plays the round back as it happened: the proposal; then each desk in its seat,
 * what it read when the round convened and how it voted; then the verdict; then what the chain did — the transaction,
 * the time from the vote to the fill, and the fill's speed receipt. The bench at the top lights each seat as it votes.
 *
 * Every number is the round's own (`GET /council/rounds/:id`, the inputs stored with it), never re-read. It plays by
 * itself, can be paused, shown whole, or played again; under reduced motion it is shown whole and holds still.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useGoBack } from '@/nav/useGoBack';
import {
  AgentOrb,
  Button,
  ErrorState,
  Fill,
  Glow,
  HeaderBar,
  LoadingRows,
  Screen,
  SheetCard,
  Tag,
  Text,
  colors,
  radius,
  size,
  space,
  useReducedMotion,
} from '@/ui';
import { Rise } from '@/ui/Rise';
import { money, when } from '@/format';
import { repos } from '@/data';
import { useAsync } from '@/data/useAsync';
import { council, voteToFillSec, type CouncilBallot, type CouncilRound } from '@/data/council';
import { convenedByLabel } from '@/agents/agentPermission';
import { beatMs, beats, readingsFor, SEAT_ORDER, strategistModel, tally, type Beat } from '@/council/replay';
import { SEAT_GRADIENT, SEAT_NAMES, SEAT_SHORT, decisionBg, decisionTone, outcomeLine, voteColor, voteTone } from '@/council/seats';
import { SpeedReceipt } from '@/speed/SpeedReceipt';

/** The bench: every seat that voted, dim until its turn, lit while it speaks, its vote's colour under it after. */
function Bench({ round, speaking, spoken }: { round: CouncilRound; speaking: CouncilBallot['persona'] | null; spoken: ReadonlySet<string> }) {
  const sat = SEAT_ORDER.filter((s) => round.votes.some((v) => v.persona === s));
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.s14 }} testID="replay-bench">
      {sat.map((seat) => {
        const vote = round.votes.find((v) => v.persona === seat)!;
        const on = speaking === seat;
        const done = spoken.has(seat);
        return (
          <View key={seat} style={{ alignItems: 'center', gap: space.s6, opacity: on || done ? 1 : 0.32 }}>
            <View style={{ transform: [{ scale: on ? 1.08 : 1 }] }}>
              <AgentOrb gradient={SEAT_GRADIENT[seat]} size={52} face identity={SEAT_NAMES[seat]} bloom={on || done} />
            </View>
            <Text variant="secondarySm" color={on ? colors.ink : colors.ink70}>
              {SEAT_SHORT[seat]}
            </Text>
            <View style={{ width: 26, height: 4, borderRadius: 2, backgroundColor: done ? voteColor(vote.vote) : colors.control }} />
          </View>
        );
      })}
    </View>
  );
}

/** One segment per beat, lit up to where the replay is. */
function Progress({ count, at }: { count: number; at: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.s4, marginTop: space.s12 }} accessibilityLabel={`Step ${at + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 3,
            borderRadius: 2,
            backgroundColor: i <= at ? colors.accent : colors.control,
            boxShadow: i === at ? `0px 0px 8px ${colors.accentGlow}` : undefined,
          }}
        />
      ))}
    </View>
  );
}

function ProposalCard({ round, by }: { round: CouncilRound; by: string }) {
  const p = round.proposal;
  const readAt = round.inputs?.readAt ? Date.parse(round.inputs.readAt) : NaN;
  return (
    <SheetCard bordered borderRadius={radius.panel} padding={space.s16} testID="replay-proposal">
      <Text variant="eyebrow">The proposal</Text>
      <Text variant="titleLg" style={{ marginTop: space.s6 }}>
        {`${p.side === 'buy' ? 'Buy' : 'Sell'} ${money(p.usd)} ${p.symbol}`}
      </Text>
      <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s4 }}>
        {`Put to the council by ${by}, ${when(Date.parse(round.createdAt))}.`}
        {Number.isFinite(readAt)
          ? ` The desks read the market at ${new Date(readAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}; every number below is what they saw then.`
          : ''}
      </Text>
    </SheetCard>
  );
}

function SeatCard({ ballot, round, speaking }: { ballot: CouncilBallot; round: CouncilRound; speaking: boolean }) {
  const groups = readingsFor(round.inputs, ballot.cites, round.proposal.symbol);
  const model = ballot.persona === 'strategist' ? strategistModel(ballot.cites) : null;
  return (
    <SheetCard bordered borderRadius={radius.panel} padding={space.s16} tone={speaking ? 'accent' : 'default'} testID={`replay-seat-${ballot.persona}`}>
      {speaking ? <Glow strength={0.18} style={{ top: -30, left: -30, right: 120, bottom: 20 }} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s12 }}>
        <AgentOrb gradient={SEAT_GRADIENT[ballot.persona]} size={52} face identity={SEAT_NAMES[ballot.persona]} bloom={speaking} />
        <View style={{ flex: 1 }}>
          <Text variant="rowPrimary">{SEAT_NAMES[ballot.persona]}</Text>
          <Text variant="footnote" color={colors.ink55}>
            {`${Math.round(ballot.confidence * 100)}% sure${model ? ` · ${model}` : ''}`}
          </Text>
        </View>
        <Tag label={ballot.vote} tone={voteTone(ballot.vote)} />
      </View>
      {groups.length ? (
        <View style={{ marginTop: space.s12, gap: space.s10 }}>
          {groups.map((g) => (
            <View key={g.cite} style={{ gap: space.s6 }}>
              {g.readings.map((r) => (
                <View key={r.label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s12 }}>
                  <Text variant="secondarySm" color={colors.ink55}>
                    {r.label}
                  </Text>
                  <Text variant="secondarySm" color={r.failed ? colors.down : colors.ink} style={{ flexShrink: 1, textAlign: 'right' }}>
                    {r.value}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ marginTop: space.s12, paddingLeft: space.s10, borderLeftWidth: 2, borderLeftColor: voteColor(ballot.vote) }}>
        <Text variant="footnote" color={colors.ink70}>
          {ballot.reason}
        </Text>
      </View>
    </SheetCard>
  );
}

function VerdictCard({ round }: { round: CouncilRound }) {
  const t = tally(round.votes);
  const parts = [t.yes && `${t.yes} yes`, t.no && `${t.no} no`, t.veto && `${t.veto} veto`, t.abstain && `${t.abstain} abstained`].filter(Boolean).join(' · ');
  return (
    <SheetCard bordered borderRadius={radius.panel} padding={space.s16} testID="replay-verdict">
      <Text variant="eyebrow">The verdict</Text>
      <View style={{ alignSelf: 'flex-start', marginTop: space.s8, paddingHorizontal: space.s12, paddingVertical: space.s6, borderRadius: radius.card, backgroundColor: decisionBg(round.decision) }}>
        <Text variant="titleLg" color={decisionTone(round.decision)}>
          {/* "Vetoed by risk-keeper." names the seat by its id; the reader knows it by its name. */}
          {SEAT_ORDER.reduce((s, seat) => s.replaceAll(seat, SEAT_NAMES[seat]), round.summary)}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: space.s4, marginTop: space.s12 }}>
        {SEAT_ORDER.flatMap((s) => round.votes.filter((v) => v.persona === s)).map((v) => (
          <View key={v.persona} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: voteColor(v.vote) }} />
        ))}
      </View>
      <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s8 }}>
        {`${parts}. A trade needs two yes votes and more yes than no; an abstention counts for neither, and one veto stops it.`}
      </Text>
    </SheetCard>
  );
}

function OutcomeCard({ round }: { round: CouncilRound }) {
  const sec = voteToFillSec(round);
  const url = round.txLink && /^https?:/.test(round.txLink) ? round.txLink : null;
  const short = round.txHash ? `${round.txHash.slice(0, 10)}…${round.txHash.slice(-6)}` : null;
  return (
    <View style={{ gap: space.s10 }}>
      <SheetCard bordered borderRadius={radius.panel} padding={space.s16} testID="replay-outcome">
        <Text variant="eyebrow">What the chain did</Text>
        <Text variant="rowPrimary" style={{ marginTop: space.s6 }} color={round.outcome === 'executed' ? colors.up : colors.ink}>
          {outcomeLine(round)}
        </Text>
        {sec !== null ? (
          <Text variant="secondarySm" color={colors.accentHi} style={{ marginTop: space.s4 }} testID="replay-vote-to-fill">
            {`From the desks convening to the trade confirmed: ${sec.toLocaleString('en-US', { maximumFractionDigits: 1 })} s`}
          </Text>
        ) : null}
        {short ? (
          <Text variant="footnote" color={url ? colors.ink : colors.ink55} style={{ marginTop: space.s6 }} onPress={url ? () => void Linking.openURL(url) : undefined} selectable>
            {url ? `View ${short}` : `${short} · on the fork`}
          </Text>
        ) : null}
      </SheetCard>
      {round.outcome === 'executed' && round.txHash ? <SpeedReceipt tx={round.txHash} /> : null}
    </View>
  );
}

function BeatView({ beat, round, by, speaking }: { beat: Beat; round: CouncilRound; by: string; speaking: boolean }) {
  if (beat.kind === 'proposal') return <ProposalCard round={round} by={by} />;
  if (beat.kind === 'seat') return <SeatCard ballot={beat.ballot} round={round} speaking={speaking} />;
  if (beat.kind === 'verdict') return <VerdictCard round={round} />;
  return <OutcomeCard round={round} />;
}

function Replay({ round }: { round: CouncilRound }) {
  const reduced = useReducedMotion();
  const roster = useAsync(() => repos.bot.listAgents(), []);
  const list = useMemo(() => beats(round), [round]);
  const last = list.length - 1;
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  // Each playing mounts its beats afresh, so "Play again" brings them in again rather than reusing the last ones.
  const [run, setRun] = useState(0);
  // Under reduced motion the round is shown whole and holds still.
  const at = reduced ? last : Math.min(step, last);
  const done = at >= last;
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (paused || done) return;
    const t = setTimeout(() => setStep((s) => s + 1), beatMs(list[at]!));
    return () => clearTimeout(t);
  }, [list, at, paused, done]);

  const shown = list.slice(0, at + 1);
  const current = list[at]!;
  const speaking = current.kind === 'seat' ? current.ballot.persona : null;
  // The seats that have voted: every one shown, but the one still speaking.
  const spoken = new Set(shown.flatMap((b) => (b.kind === 'seat' && (done || b.ballot.persona !== speaking) ? [b.ballot.persona] : [])));
  const by = convenedByLabel(round.convenedBy, roster.data);

  return (
    <>
      <View style={{ paddingHorizontal: space.gutter }}>
        <Progress count={list.length} at={at} />
        <Bench round={round} speaking={done ? null : speaking} spoken={spoken} />
      </View>
      <Fill style={{ marginTop: space.s12 }}>
        <ScrollView
          ref={scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.s16, gap: space.s10 }}
          // While it plays, the newest beat stays in view; held still, the reader scrolls.
          onContentSizeChange={() => (!reduced && !paused && step > 0 ? scroll.current?.scrollToEnd({ animated: true }) : undefined)}
        >
          {shown.map((b, i) => (
            <Rise key={`${run}-${b.kind}-${b.kind === 'seat' ? b.ballot.persona : i}`} index={0}>
              <BeatView beat={b} round={round} by={by} speaking={!done && i === at && b.kind === 'seat'} />
            </Rise>
          ))}
        </ScrollView>
      </Fill>
      {reduced ? null : (
        <View style={{ paddingHorizontal: space.gutter, paddingTop: space.s8, flexDirection: 'row', gap: space.s10 }}>
          {done ? (
            <Button
              label="Play again"
              onPress={() => {
                setStep(0);
                setPaused(false);
                setRun(run + 1);
                scroll.current?.scrollTo({ y: 0, animated: false });
              }}
              style={{ flex: 1 }}
              testID="replay-again"
            />
          ) : (
            <>
              <Button label={paused ? 'Play' : 'Pause'} variant="secondary" onPress={() => setPaused(!paused)} style={{ flex: 1 }} testID={paused ? 'replay-play' : 'replay-pause'} />
              <Button label="Show all" variant="ghost" onPress={() => setStep(last)} style={{ flex: 1 }} testID="replay-all" />
            </>
          )}
        </View>
      )}
    </>
  );
}

export default function CouncilReplay() {
  const goBack = useGoBack();
  const { id } = useLocalSearchParams<{ id: string }>();
  const r = useAsync(() => council.round(String(id)), [id]);
  return (
    <Screen gutter="none">
      <View style={{ paddingHorizontal: space.gutter }}>
        <HeaderBar onBack={goBack} title={<Text variant="screenTitle">Replay</Text>} />
        <Text variant="secondary" color={colors.ink55} style={{ marginTop: space.s6 }}>
          {r.data ? `Round ${r.data.id}, seat by seat, as it was decided.` : 'A council round, seat by seat, as it was decided.'}
        </Text>
      </View>
      {r.error ? (
        <View style={{ paddingHorizontal: space.gutter, marginTop: space.s16 }}>
          <ErrorState error={r.error} onRetry={r.reload} />
        </View>
      ) : !r.data ? (
        <View style={{ paddingHorizontal: space.gutter, marginTop: space.s16 }}>
          <LoadingRows count={3} height={size.rowLg} />
        </View>
      ) : (
        <Replay round={r.data} />
      )}
    </Screen>
  );
}
