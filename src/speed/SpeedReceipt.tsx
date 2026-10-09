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
import { Glow, LiveDot, Press, SheetCard, Text, colors, radius, size, space } from '@/ui';
import { useAsync } from '@/data/useAsync';
import { usePoll } from '@/data/usePoll';
import { cheaperBy, groupDigits, msWords, speed, tinyUsd, type Pulse } from '@/data/speed';
import { CommitStrip } from './CommitStrip';

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
  const [open, setOpen] = React.useState(false);
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
      {/* One number and one line (the readability rule); everything measured behind it is under Details. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="eyebrow">Speed on Monad</Text>
        {d.fork ? (
          <View style={{ paddingHorizontal: space.s8, paddingVertical: 2, borderRadius: radius.card, backgroundColor: colors.accentSoft }}>
            <Text variant="footnoteSm" color={colors.accentHi}>
              fork
            </Text>
          </View>
        ) : null}
      </View>
      {d.confirmMs !== null ? (
        <Text variant="heroBalance" style={{ marginTop: space.s8 }} testID="speed-ms">{msWords(d.confirmMs) ?? '—'}</Text>
      ) : pulse.monad.blockMs ? (
        <Text variant="heroBalance" style={{ marginTop: space.s8 }} testID="speed-hero">{`${pulse.monad.blockMs} ms`}</Text>
      ) : null}
      <Text variant="secondarySm" color={colors.ink70} style={{ marginTop: space.s2 }} testID="speed-cost">
        {[d.confirmMs !== null ? (d.finalMs != null ? `Final in ${msWords(d.finalMs)}` : 'Executed') : 'A block on Monad, now', monad ? `${monad} fee` : null, x ? `${x.toLocaleString('en-US')}× cheaper than Ethereum` : null]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <Press onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} hitHeight={size.hit} testID="speed-details" style={{ alignSelf: 'flex-start', marginTop: space.s6 }}>
        <Text variant="footnote" color={colors.ink55}>
          {open ? 'Hide details' : 'Details'}
        </Text>
      </Press>
      {open ? (
        <View style={{ gap: space.s10 }}>
          <Text variant="footnote" color={colors.ink55}>
            {[
              d.sync ? 'Receipt returned with the send (eth_sendRawTransactionSync)' : null,
              block ? `Block ${block}` : null,
              gasUsed ? `gas ${gasUsed}${gasLimit ? ` of ${gasLimit} declared` : ''}` : null,
              d.monadGasGwei ? `${d.pricedAt === 'mainnet' ? 'mainnet ' : ''}${Number(d.monadGasGwei).toLocaleString('en-US', { maximumSignificantDigits: 3 })} gwei` : null,
              eth ? `Ethereum: ${eth} at ${Number(pulse.ethereum?.gasGwei ?? 0).toLocaleString('en-US', { maximumSignificantDigits: 3 })} gwei` : null,
              d.fork ? `the fork mines a block every ${(d.chainBlockMs ?? 1000).toLocaleString('en-US')} ms` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {share !== null ? (
            <View style={{ gap: space.s6 }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.control }}>
                <View style={{ width: `${share * 100}%`, height: 6, borderRadius: 3, backgroundColor: colors.accent }} />
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.ink28 }} />
            </View>
          ) : null}
          <MonadPulse pulse={pulse} compact />
          <CommitStrip count={4} />
        </View>
      ) : null}
    </SheetCard>
  );
}
