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
import { useGoBack } from '@/nav/useGoBack';
import {
  Button,
  EmptyState,
  ErrorState,
  Fill,
  HeaderBar,
  LoadingRows,
  Pill,
  PillRow,
  Screen,
  SheetCard,
  Tag,
  Text,
  colors,
  money,
  radius,
  size,
  space,
  type TagTone,
} from '@/ui';
import { shortAddress, when } from '@/format';
import { repos } from '@/data';
import type { Agent } from '@/data/types';
import { convenedByLabel, roundSigner } from '@/agents/agentPermission';
import { useAsync } from '@/data/useAsync';
import { apiProse } from '@/data/apiError';
import { council, type CouncilBallot, type CouncilRound } from '@/data/council';
import { CHAIN_KEY, onMonad } from '@/chain';

const SEAT_NAMES: Record<CouncilBallot['persona'], string> = onMonad
  ? { 'session-desk': 'Price Desk', 'risk-keeper': 'Risk Keeper', 'trend-reader': 'Trend Reader', 'macro-desk': 'Perps Desk' }
  : { 'session-desk': 'Session Desk', 'risk-keeper': 'Risk Keeper', 'trend-reader': 'Trend Reader', 'macro-desk': 'Macro Desk' };
// What the executor's council can be asked about here (`/council/seats`): Stock Tokens, or on Monad MON, ETH and BTC.
const SYMBOLS: readonly string[] = onMonad ? ['MON', 'ETH', 'BTC'] : ['NVDA', 'TSLA', 'AAPL', 'SPY'];
const SIZES = [25, 50, 100] as const;

function voteTone(v: CouncilBallot['vote']): TagTone {
  if (v === 'yes') return 'up';
  if (v === 'veto') return 'solidDown';
  if (v === 'no') return 'down';
  return 'neutral';
}

function decisionTone(d: CouncilRound['decision']): string {
  return d === 'approved' ? colors.up : d === 'vetoed' ? colors.down : colors.ink55;
}

function outcomeLine(r: CouncilRound): string {
  if (r.outcome === 'executed') return 'Executed';
  if (r.outcome === 'pending') return 'Sending';
  if (r.outcome === 'refused') return `Refused: ${r.outcomeDetail ?? ''}`;
  if (r.outcome === 'failed') return `Failed: ${r.outcomeDetail ?? ''}`;
  return r.decision === 'approved' ? (r.outcomeDetail ?? 'Not sent') : 'Not sent';
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

function RoundCard({ round, roster }: { round: CouncilRound; roster: Roster }) {
  const p = round.proposal;
  // An executed agent round was signed by that agent's own wallet (individual agents, 2026-09-23).
  const signer = round.outcome === 'executed' && round.txHash ? roundSigner(round.convenedBy, roster) : undefined;
  return (
    <SheetCard bordered borderRadius={radius.panel} padding={space.s14}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text variant="rowPrimary">
          {p.side === 'buy' ? 'Buy' : 'Sell'} {money(p.usd)} {p.symbol}
        </Text>
        <Text variant="control" color={decisionTone(round.decision)}>
          {round.summary}
        </Text>
      </View>
      <View style={{ marginTop: space.s10, gap: space.s8 }}>
        {round.votes.map((v) => (
          <View key={v.persona} style={{ flexDirection: 'row', gap: space.s8, alignItems: 'flex-start' }}>
            <Tag label={v.vote} tone={voteTone(v.vote)} small />
            <View style={{ flex: 1 }}>
              <Text variant="secondarySm" color={colors.ink}>
                {SEAT_NAMES[v.persona]}
              </Text>
              <Text variant="footnote" color={colors.ink55}>
                {v.reason}
              </Text>
            </View>
          </View>
        ))}
      </View>
      <Text variant="footnote" color={colors.ink65} style={{ marginTop: space.s10 }}>
        {outcomeLine(round)}
      </Text>
      <TxLine round={round} />
      {signer ? (
        <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s4 }} selectable>
          signed by {shortAddress(signer)}
        </Text>
      ) : null}
      <Text variant="footnoteSm" color={colors.ink40} style={{ marginTop: space.s6 }}>
        {when(new Date(round.createdAt).getTime())} · {convenedByLabel(round.convenedBy, roster)}
      </Text>
    </SheetCard>
  );
}

export default function Council() {
  const goBack = useGoBack();
  const { data, loading, error, reload } = useAsync(() => council.rounds(), []);
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
            {(data ?? []).map((r) => (
              <RoundCard key={r.id} round={r} roster={roster.data} />
            ))}
          </ScrollView>
        )}
      </Fill>
    </Screen>
  );
}
