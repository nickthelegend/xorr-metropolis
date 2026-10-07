/**
 * How xorr works — three steps before sign-up (docs/ROADMAP-WIN.md F2, 2026-10-07).
 *
 * A judge's first minute went: a tagline, then a wallet form. The three ideas that make xorr different were nowhere before
 * the ask: a council votes on every trade; the chain, not the app, holds the limit; one hold stops everything — on Monad,
 * where a vote and its fill land in the same moment. These are those three, one screen each, the last with Monad
 * mainnet's block cadence measured live (`/monad/pulse`) rather than quoted.
 *
 * Shown once on this device ("Get started" goes straight on after), skippable at every step, and reachable again from
 * Settings — from there, finishing goes back to Settings instead of on into sign-up.
 */
import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AgentOrb, Button, Fill, Glow, LiveDot, Press, Screen, SheetCard, Text, colors, glow, radius, size, space } from '@/ui';
import { Rise } from '@/ui/Rise';
import { Icon, type IconName } from '@/design/Icon';
import { useStore } from '@/state/store';
import { groupDigits } from '@/data/speed';
import { useMonadPulse } from '@/speed/SpeedReceipt';

const SEATS = [
  { name: 'Price Desk', short: 'Price', g: colors.agent.momentum },
  { name: 'Risk Keeper', short: 'Risk', g: colors.agent.drawdown },
  { name: 'Trend Reader', short: 'Trend', g: colors.agent.earnings },
  { name: 'Perps Desk', short: 'Perps', g: colors.agent.yield },
  { name: 'Strategist (Kimi)', short: 'Kimi', g: colors.agent.strategist },
] as const;

const LIMITS: readonly { icon: IconName; text: string }[] = [
  { icon: 'check', text: 'A daily limit you choose' },
  { icon: 'activity', text: 'An end date, after which it lapses on its own' },
  { icon: 'swapH', text: 'Only the venues you allow — Kuru and Uniswap' },
  { icon: 'shield', text: 'Never a withdrawal. Your money stays in your wallet' },
];

function Step({ step }: { step: number }) {
  const pulse = useMonadPulse();
  if (step === 0) {
    return (
      <>
        <View style={{ height: 150, justifyContent: 'center' }}>
          <Glow strength={0.3} style={{ top: -20, bottom: -20, left: 10, right: 10 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {SEATS.map((s, i) => (
              <Rise key={s.name} index={i} style={{ alignItems: 'center', gap: space.s6 }}>
                <AgentOrb gradient={s.g} size={52} face identity={s.name} bloom />
                <Text variant="secondarySm" color={colors.ink70}>
                  {s.short}
                </Text>
              </Rise>
            ))}
          </View>
        </View>
        <Rise index={5}>
          <Text variant="onboardingTitle" style={{ marginTop: space.s22 }}>
            A council votes on every trade
          </Text>
          <Text variant="body" color={colors.ink65} style={{ marginTop: space.s10 }}>
            Four desks read Monad’s markets — Chainlink, Kuru’s order book, Uniswap and Perpl’s funding — and vote. Nothing
            trades unless they approve, and every vote stays beside the trade it made. Kimi breaks a tie.
          </Text>
        </Rise>
      </>
    );
  }
  if (step === 1) {
    return (
      <>
        <Rise index={0}>
          <SheetCard bordered tone="accent" borderRadius={radius.panel} padding={space.s18}>
            <Text variant="eyebrow">Your permission</Text>
            <View style={{ gap: space.s14, marginTop: space.s14 }}>
              {LIMITS.map((l) => (
                <View key={l.text} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s12 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine }}>
                    <View>
                      <Icon name={l.icon} size={15} color={colors.accentHi} strokeWidth={2} />
                    </View>
                  </View>
                  <Text variant="rowPrimary" style={{ flex: 1 }}>
                    {l.text}
                  </Text>
                </View>
              ))}
            </View>
          </SheetCard>
        </Rise>
        <Rise index={1}>
          <Text variant="onboardingTitle" style={{ marginTop: space.s22 }}>
            Inside a limit the chain enforces
          </Text>
          <Text variant="body" color={colors.ink65} style={{ marginTop: space.s10 }}>
            You sign one permission, with your passkey. The contract refuses anything past it — a spend over your limit is
            mined as a revert, even when it comes from xorr’s own server.
          </Text>
        </Rise>
      </>
    );
  }
  const ms = pulse?.monad.blockMs;
  const block = groupDigits(pulse?.monad.block);
  return (
    <>
      <Rise index={0}>
        <SheetCard bordered tone="accent" borderRadius={radius.panel} padding={space.s18} testID="how-monad">
          <Glow strength={0.28} style={{ top: -30, left: -30, right: 90, bottom: -10 }} />
          <Text variant="eyebrow">Monad mainnet, right now</Text>
          {ms ? (
            <>
              <Text variant="heroBalance" style={{ marginTop: space.s8 }}>{`${ms} ms`}</Text>
              <Text variant="secondarySm" color={colors.ink55}>
                between blocks, measured over the last hundred
              </Text>
            </>
          ) : (
            <Text variant="secondary" color={colors.ink55} style={{ marginTop: space.s8 }}>
              Reading the chain…
            </Text>
          )}
          {block ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s8, marginTop: space.s12 }}>
              <LiveDot color={colors.accentHi} pulse />
              <Text variant="secondarySm" color={colors.ink70}>{`Block ${block}`}</Text>
            </View>
          ) : null}
          <View
            style={{
              marginTop: space.s16,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.candleDown,
              boxShadow: glow.down,
            }}
          >
            <Text variant="button">Hold to stop all trading</Text>
          </View>
        </SheetCard>
      </Rise>
      <Rise index={1}>
        <Text variant="onboardingTitle" style={{ marginTop: space.s22 }}>
          Fast enough to vote, then fill
        </Text>
        <Text variant="body" color={colors.ink65} style={{ marginTop: space.s10 }}>
          {ms
            ? `Every trade settles on Monad, where a block lands every ${ms} ms — so the council’s vote and its fill happen in the same moment, and one hold stops every agent just as fast.`
            : 'Every trade settles on Monad, so the council’s vote and its fill happen in the same moment — and one hold stops every agent just as fast.'}
        </Text>
      </Rise>
    </>
  );
}

export default function How() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const setHowSeen = useStore((s) => s.setHowSeen);
  const [step, setStep] = useState(0);
  const last = step === 2;
  const done = () => {
    setHowSeen(true);
    if (from === 'settings' && router.canGoBack()) router.back();
    else router.replace('/goals');
  };
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: size.hit }}>
        <View style={{ flexDirection: 'row', gap: space.s6 }} accessibilityLabel={`Step ${step + 1} of 3`}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{
                width: i === step ? 22 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: i === step ? colors.accent : colors.control,
                boxShadow: i === step ? `0px 0px 10px ${colors.accentGlow}` : undefined,
              }}
            />
          ))}
        </View>
        {last ? null : (
          <Press onPress={done} accessibilityRole="button" accessibilityLabel="Skip" hitHeight={size.hit} testID="how-skip">
            <Text variant="control" color={colors.ink55}>
              Skip
            </Text>
          </Press>
        )}
      </View>
      <Fill style={{ justifyContent: 'center' }}>
        {/* Keyed by step, so each one arrives as its own screen. */}
        <View key={step}>
          <Step step={step} />
        </View>
      </Fill>
      {/*
        One id per step: a Button refuses a second press within a double tap, keyed by its id, so a shared id swallowed a
        quick "Next" on the following step. Each step's button still refuses its own double tap.
      */}
      <Button
        key={step}
        label={last ? (from === 'settings' ? 'Done' : 'Create my account') : 'Next'}
        onPress={() => (last ? done() : setStep(step + 1))}
        testID={`how-next-${step + 1}`}
      />
    </Screen>
  );
}
