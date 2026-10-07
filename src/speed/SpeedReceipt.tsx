/**
 * SpeedReceipt.tsx — what a fill can prove about Monad, on its receipt (docs/ROADMAP-WIN.md F1).
 *
 * The time from sending to confirmed, the block, the gas, and what it cost here against the same gas on Ethereum at
 * today's price — every figure measured by the executor or read live, none asserted. Under it, `MonadPulse`: Monad
 * mainnet's head block and its block interval measured over the last hundred blocks, breathing while it is live.
 *
 * On the local fork a fill confirms at the fork's pace (a block a second), so there the card leads with Monad mainnet's
 * cadence, measured live, and gives the fill's own time with its reason; on a Monad network the fill's time leads.
 */
import React from 'react';
import { View } from 'react-native';
import { Glow, LiveDot, SheetCard, Text, colors, radius, space } from '@/ui';
import { useAsync } from '@/data/useAsync';
import { usePoll } from '@/data/usePoll';
import { cheaperBy, groupDigits, speed, tinyUsd, type Pulse } from '@/data/speed';

/** One line of Monad mainnet, live: head block and measured cadence. Renders nothing until it has both. */
export function MonadPulse({ pulse, compact = false }: { pulse: Pulse | undefined; compact?: boolean }) {
  const block = groupDigits(pulse?.monad.block);
  const ms = pulse?.monad.blockMs;
  if (!block || !ms) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s8 }} testID="monad-pulse">
      <LiveDot color={colors.accentHi} pulse />
      <Text variant={compact ? 'footnote' : 'secondarySm'} color={colors.ink70} style={{ flexShrink: 1 }}>
        {`Monad mainnet now · block ${block} · one every ${ms} ms`}
        <Text variant={compact ? 'footnote' : 'secondarySm'} color={colors.ink40}>
          {compact ? '' : ' (measured over the last 100)'}
        </Text>
      </Text>
    </View>
  );
}

/** The live pulse, polled every few seconds while the screen is on. */
export function useMonadPulse(): Pulse | undefined {
  return usePoll(() => speed.pulse(), 4_000).data;
}

export function SpeedReceipt({ tx }: { tx: string }) {
  const r = useAsync(() => speed.forTx(tx), [tx]);
  const live = useMonadPulse();
  if (!r.data) return null;
  const d = r.data;
  const pulse = live ?? d.pulse;
  const monad = tinyUsd(d.costUsd);
  const eth = tinyUsd(d.ethereumUsd);
  const x = cheaperBy(d.costUsd, d.ethereumUsd);
  const gasUsed = groupDigits(d.gasUsed);
  const gasLimit = groupDigits(d.gasLimit);
  const block = groupDigits(d.block);
  // The two costs as bars on one scale: Ethereum's is the full width, Monad's its share (with a sliver so it shows).
  const share = d.costUsd && d.ethereumUsd ? Math.max(0.012, Math.min(1, d.costUsd / d.ethereumUsd)) : null;
  return (
    <SheetCard bordered borderRadius={radius.panel} padding={space.s18} tone="accent" testID="speed-receipt">
      <Glow strength={0.22} style={{ top: -30, left: -40, right: 120, bottom: 40 }} />
      <Text variant="eyebrow">Speed on Monad</Text>
      {d.fork ? (
        <>
          {/*
            On the local fork the fill moved at the fork's pace (it mines a block a second), so the lead is Monad mainnet's
            own cadence, measured live; the fill's time follows, with its reason.
          */}
          {pulse.monad.blockMs ? (
            <View style={{ marginTop: space.s8 }}>
              <Text variant="heroBalance" testID="speed-hero">{`${pulse.monad.blockMs} ms`}</Text>
              <Text variant="secondarySm" color={colors.ink55}>
                a block on Monad mainnet, right now
              </Text>
            </View>
          ) : null}
          {d.confirmMs !== null ? (
            <Text variant="secondarySm" color={colors.ink70} style={{ marginTop: space.s6 }} testID="speed-ms">
              {`This fill: ${d.confirmMs.toLocaleString('en-US')} ms from sending to confirmed — on the local fork, which mines a block every ${(d.chainBlockMs ?? 1000).toLocaleString('en-US')} ms.`}
            </Text>
          ) : null}
        </>
      ) : d.confirmMs !== null ? (
        <View style={{ marginTop: space.s8 }}>
          <Text variant="heroBalance" testID="speed-ms">{`${d.confirmMs.toLocaleString('en-US')} ms`}</Text>
          <Text variant="secondarySm" color={colors.ink55}>
            from sending to confirmed
          </Text>
        </View>
      ) : null}
      {block || gasUsed ? (
        <Text variant="secondarySm" color={colors.ink70} style={{ marginTop: space.s10 }}>
          {[block ? `Block ${block}` : null, gasUsed ? `gas ${gasUsed}${gasLimit ? ` of ${gasLimit} declared` : ''}` : null].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
      {monad ? (
        <View style={{ marginTop: space.s14, gap: space.s8 }} testID="speed-cost">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.s10 }}>
            <Text variant="rowPrimary" style={{ flexShrink: 1 }}>{`${monad} on Monad`}</Text>
            {x ? (
              <Text variant="control" color={colors.accentHi} numberOfLines={1}>{`${x.toLocaleString('en-US')}× less`}</Text>
            ) : null}
          </View>
          {d.monadGasGwei ? (
            // The price on its own line: beside the cost it wrapped "gwei" onto a line of its own at desktop width.
            <Text variant="footnote" color={colors.ink55} style={{ marginTop: -space.s4 }}>
              {`the gas declared, at ${d.pricedAt === 'mainnet' ? 'Monad mainnet’s ' : ''}${Number(d.monadGasGwei).toLocaleString('en-US', { maximumSignificantDigits: 3 })} gwei`}
            </Text>
          ) : null}
          {share !== null ? (
            <View style={{ gap: space.s6 }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.control }}>
                <View style={{ width: `${share * 100}%`, height: 6, borderRadius: 3, backgroundColor: colors.accent, boxShadow: `0px 0px 8px ${colors.accentGlow}` }} />
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.ink28 }} />
            </View>
          ) : null}
          {eth ? (
            <Text variant="footnote" color={colors.ink55}>
              {`The same ${gasUsed ?? ''} gas on Ethereum at today's ${Number(pulse.ethereum?.gasGwei ?? 0).toLocaleString('en-US', { maximumSignificantDigits: 3 })} gwei: ${eth}. Monad bills the gas declared; Ethereum the gas used.`}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={{ marginTop: space.s14 }}>
        <MonadPulse pulse={pulse} />
      </View>
    </SheetCard>
  );
}
