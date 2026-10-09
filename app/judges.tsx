/**
 * For judges (docs/ROADMAP-WIN.md W4, 2026-10-08).
 *
 * Every bounty xorr enters, with what it asks, the screens that meet it (each a link that opens), a reading made now
 * where there is one, the status in SUBMISSION's own words — what is left included — and the evidence in the repo. The
 * bounty evidence lived in docs; a judge can now point at Kuru's live book or Envio's indexed block from the app.
 */
import React, { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useGoBack } from '@/nav/useGoBack';
import { Fill, HeaderBar, Press, Screen, SheetCard, Text, colors, radius, size, space } from '@/ui';
import { Rise } from '@/ui/Rise';
import { shortAddress } from '@/format';
import { usePoll } from '@/data/usePoll';
import { monad, type MonadNative, type SponsorsLive } from '@/data/monad';
import { useAuth } from '@/auth/useAuth';
import { BOUNTIES, repoUrl, type Bounty, type Live } from '@/judges/bounties';

/** The reading beside a bounty, from the same live reads Built on Monad makes. Null where there is none to show. */
function reading(live: Live, n: MonadNative | undefined, s: SponsorsLive | undefined, address: string | undefined): string | null {
  const usd = (x: number) => `$${x.toLocaleString('en-US', { maximumSignificantDigits: 5 })}`;
  switch (live) {
    case 'monad': {
      if (!n) return null;
      const st = n.staking.ok ? ` · staking epoch ${Number(n.staking.epoch).toLocaleString('en-US')}` : '';
      return `P256 on mainnet: ${n.p256.mainnet.ok && n.p256.mainnet.accepts ? 'verifies' : 'could not read'}${st}`;
    }
    case 'ausd':
      return s?.ausd.ok ? `AUSD peg ${usd(s.ausd.price)} (Chainlink on Monad)` : null;
    case 'perpl':
      return s?.perpl.ok ? `${s.perpl.network}: ${s.perpl.open} markets open` : null;
    case 'kuru':
      return s?.prices.ok && s.prices.kuru ? `Kuru MON/USDC mid ${usd(s.prices.kuru.mid)}${s.prices.kuru.spreadBps !== null ? `, spread ${s.prices.kuru.spreadBps.toLocaleString('en-US', { maximumFractionDigits: 1 })} bps` : ''}` : null;
    case 'chainlink':
      return s?.prices.ok && s.prices.chainlink ? `Chainlink MON/USD ${usd(s.prices.chainlink.price)}` : null;
    case 'envio':
      return s?.envio.ok ? `Indexed to block ${s.envio.processedBlock.toLocaleString('en-US')} (${s.envio.behind === 0 ? 'at the head' : `${s.envio.behind} behind`}), ${s.envio.fills} fills` : null;
    case 'kimi':
      return s ? (s.kimi.configured ? 'Kimi sits on the council' : `Not sitting here: needs ${s.kimi.needs}`) : null;
    case 'cre':
      return s ? (s.cre.receiver ? `Receiver ${shortAddress(s.cre.receiver)}` : s.cre.where) : null;
    case 'session':
      return address ? `This session: ${shortAddress(address)}, from the passkey` : 'Sign in with a passkey to see your account here';
    default:
      return null;
  }
}

function BountyCard({ b, index, live }: { b: Bounty; index: number; live: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Rise index={index}>
      <SheetCard bordered tone={b.id === 'monad' ? 'accent' : 'default'} borderRadius={radius.panel} padding={space.s16} testID={`judges-row-${b.id}`}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s10 }}>
          <Text variant="eyebrow">{b.sponsor}</Text>
          <Text variant="footnoteSm" color={colors.ink55}>
            {b.prize}
          </Text>
        </View>
        <Text variant="rowPrimary" style={{ marginTop: space.s4 }}>
          {b.title}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s8, marginTop: space.s10 }}>
          {b.screens.map((sc, i) => (
            <Press
              key={sc.route + sc.label}
              onPress={() => router.push(sc.route as never)}
              accessibilityRole="link"
              accessibilityLabel={`Open ${sc.label}`}
              hitHeight={size.hit}
              testID={`judges-link-${b.id}-${i}`}
            >
              <View style={{ paddingHorizontal: space.s10, paddingVertical: space.s6, borderRadius: radius.card, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine }}>
                <Text variant="footnote" color={colors.accentHi}>
                  {`${sc.label} ›`}
                </Text>
              </View>
            </Press>
          ))}
        </View>
        {live ? (
          <Text variant="secondarySm" color={colors.up} style={{ marginTop: space.s10 }} testID={`judges-live-${b.id}`}>
            {live}
          </Text>
        ) : null}
        {/* What it asks, its status and the evidence: one tap away, not on the card (the readability rule). */}
        <Press onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} hitHeight={size.hit} testID={`judges-details-${b.id}`} style={{ alignSelf: 'flex-start', marginTop: space.s6 }}>
          <Text variant="footnote" color={colors.ink55}>
            {open ? 'Hide details' : 'Details'}
          </Text>
        </Press>
        {open ? (
          <View style={{ gap: space.s6 }}>
            <Text variant="footnote" color={colors.ink55}>{`Asks: ${b.asks}`}</Text>
            <Text variant="footnote" color={colors.ink70}>{b.status}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s12 }}>
              {b.evidence.map((e) => (
                <Text key={e.path} variant="footnoteSm" color={colors.ink55} onPress={() => void Linking.openURL(repoUrl(e.path))}>
                  {`${e.label} ↗`}
                </Text>
              ))}
            </View>
          </View>
        ) : null}
      </SheetCard>
    </Rise>
  );
}

export default function Judges() {
  const goBack = useGoBack();
  const native = usePoll(() => monad.native(), 30_000);
  const sponsors = usePoll(() => monad.sponsors(), 30_000);
  const { address } = useAuth();
  return (
    <Screen gutter="none">
      <View style={{ paddingHorizontal: space.gutter }}>
        <HeaderBar onBack={goBack} title={<Text variant="screenTitle">For judges</Text>} />
        <Text variant="secondary" color={colors.ink55} style={{ marginTop: space.s6 }}>
          Each bounty, and the screen that meets it.
        </Text>
      </View>
      <Fill style={{ marginTop: space.s12 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.s30, gap: space.s10 }}>
          {BOUNTIES.map((b, i) => (
            <BountyCard key={b.id} b={b} index={i} live={reading(b.live, native.data, sponsors.data, address)} />
          ))}
        </ScrollView>
      </Fill>
    </Screen>
  );
}
