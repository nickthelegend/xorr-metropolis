/**
 * CommitStrip.tsx — Monad's blocks going final, live (MONAD-TECH item 1; docs/ROADMAP-WIN.md "Monad-native coverage").
 *
 * Each chip is one of Monad mainnet's newest blocks, its four segments lighting as the commit-state stream reports it
 * Proposed, Voted, Finalized and Verified, with the time it took to go final. Under it, the medians — how long a block
 * takes to be voted, final and verified, timed from each proposal as Monad's RPC streams it (`/monad/commits`).
 *
 * It says which network it is: the local fork has no consensus to show, so this is always a real Monad network, read
 * live. A stream that is not open says so instead of showing an empty row as though the chain had stopped.
 */
import React from 'react';
import { View } from 'react-native';
import { LiveDot, Text, colors, radius, space } from '@/ui';
import { usePoll } from '@/data/usePoll';
import { msWords, speed, type CommitBlock, type CommitState } from '@/data/speed';

const STATES: readonly CommitState[] = ['Proposed', 'Voted', 'Finalized', 'Verified'];
const LIT: Record<CommitState, string> = { Proposed: colors.ink40, Voted: colors.accent, Finalized: colors.up, Verified: colors.up };

function Chip({ b }: { b: CommitBlock }) {
  const reached = STATES.indexOf(b.state);
  const final = b.ms?.Finalized ?? null;
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        paddingVertical: space.s8,
        paddingHorizontal: space.s6 - 1,
        borderRadius: radius.card,
        backgroundColor: colors.control,
        borderWidth: 1,
        borderColor: reached >= 2 ? 'rgba(43,216,122,0.35)' : colors.ink28,
        gap: space.s6,
      }}
      testID="commit-chip"
      accessibilityLabel={`Block ${b.number.toLocaleString('en-US')}, ${b.state}${final !== null ? `, final in ${final} ms` : ''}`}
    >
      <Text variant="footnoteSm" color={colors.ink70} numberOfLines={1}>
        {`…${String(b.number).slice(-4)}`}
      </Text>
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {STATES.map((s, i) => (
          <View
            key={s}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: i <= reached ? LIT[b.state] : colors.ink28,
              opacity: i <= reached ? 1 : 0.5,
              boxShadow: i === reached && b.state !== 'Proposed' ? `0px 0px 6px ${LIT[b.state]}` : undefined,
            }}
          />
        ))}
      </View>
      {/* The state on one line and its time on the next: at five across, "final 550 ms" did not fit one. */}
      <View>
        <Text variant="footnoteSm" color={b.state === 'Proposed' ? colors.ink55 : b.state === 'Voted' ? colors.accentHi : colors.up} numberOfLines={1}>
          {b.state === 'Verified' ? 'verified' : b.state === 'Finalized' ? 'final' : b.state.toLowerCase()}
        </Text>
        <Text variant="footnoteSm" color={colors.ink55} numberOfLines={1}>
          {msWords(b.state === 'Verified' ? b.ms?.Verified : b.state === 'Finalized' ? final : b.state === 'Voted' ? b.ms?.Voted : null) ?? ' '}
        </Text>
      </View>
    </View>
  );
}

/** The strip, polled while it is on screen. `count` chips; the newest on the left. */
export function CommitStrip({ count = 5 }: { count?: number }) {
  const c = usePoll(() => speed.commits(), 600).data;
  const blocks = c?.blocks.slice(0, count) ?? [];
  const s = c?.stats;
  const words = s && s.samples > 0 ? [s.votedMs !== null ? `voted in ${msWords(s.votedMs)}` : null, s.finalizedMs !== null ? `final in ${msWords(s.finalizedMs)}` : null, s.verifiedMs !== null ? `verified in ${msWords(s.verifiedMs)}` : null].filter(Boolean) : [];
  return (
    <View testID="commit-strip" style={{ gap: space.s8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s8 }}>
        <LiveDot color={c?.live ? colors.up : colors.ink40} pulse={!!c?.live} />
        <Text variant="secondarySm" color={colors.ink70} style={{ flexShrink: 1 }}>
          {c ? `${c.network}: each block, Proposed → Voted → Final → Verified` : 'Opening Monad’s commit-state stream…'}
        </Text>
      </View>
      {blocks.length ? (
        <View style={{ flexDirection: 'row', gap: space.s6 }}>
          {/* No arrival motion: a block arrives every 300 ms, so a rising chip was always mid-rise. The lighting is the motion. */}
          {blocks.map((b) => (
            <Chip key={b.blockId} b={b} />
          ))}
        </View>
      ) : c && !c.live && c.error ? (
        <Text variant="footnote" color={colors.ink55}>{`The stream is not open: ${c.error}.`}</Text>
      ) : null}
      {words.length ? (
        <Text variant="footnote" color={colors.ink55} testID="commit-stats">
          {`A block is ${words.join(', ')} — medians of the last ${s!.samples}, timed from each proposal as Monad’s RPC streams it (monadNewHeads).`}
        </Text>
      ) : null}
    </View>
  );
}
