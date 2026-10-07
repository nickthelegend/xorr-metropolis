/**
 * The app is a phone. On a wide browser, say so rather than stretching.
 *
 * Everything in `src/ui` is calibrated to `DESIGN_WIDTH` — 402pt. Let loose in a 1568px window the
 * layout does not break so much as become obviously wrong: a hero card a metre wide, a "Get
 * started" button spanning the whole screen, list rows whose value column is half a page from its
 * label. Nothing errors, and it reads immediately as a mobile build someone forgot to look at on a
 * laptop, which is the first thing anyone opening this on a desktop will see.
 *
 * So on web, above the design width, the app renders in a column of exactly that width, centred,
 * with the surrounding space filled in the app's own black. It is not a device mockup — no bezel,
 * no notch, no drop shadow pretending to be hardware. Just the layout at the size it was drawn for.
 *
 * A stage, not a void (2026-10-06). The surrounding space was plain black, so at 1440 × 900 the app was a thin strip in
 * an empty window — the first thing a judge on a laptop saw. It now stands in the app's own light: the ambient violet
 * and blue behind it, its column catching the light along both edges, and — where the window is wide enough — the
 * product said in one line beside it, as the welcome screen says it. Still no bezel and no notch.
 *
 * Native is untouched: a phone IS this width, and wrapping there would add a view for nothing.
 *
 * It lives at the root rather than in `Screen` so the tab bar and the chat sheet are inside the
 * column too — both are `position: absolute` against their parent, and a `Screen`-level fix would
 * have left them spanning the full window while the content sat in the middle.
 */
import React from 'react';
import { Image, Platform, View, useWindowDimensions } from 'react-native';
import { brand } from '@/design/brand';
import { onMonad } from '@/chain';
import { Glow } from './Aurora';
import { DESIGN_WIDTH } from './responsive';
import { Text } from './Text';
import { colors, glow, space } from './tokens';

const WORDMARK = require('../../assets/brand/xorr-wordmark.png');
const WORDMARK_H = 26;
const WORDMARK_W = Math.round((WORDMARK_H * 833) / 166);
/** Wide enough for the line beside the column without crowding it. */
const SIDE_COPY_FROM = 1100;

/** Three facts the product keeps, said beside it on a wide screen. */
const FACTS = [
  'A passkey account. Nothing that can sign is stored.',
  'A daily limit the chain enforces, not the app.',
  'One hold stops every agent, on chain.',
] as const;

export function PhoneFrame({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  /*
   * Read per render, not once: a browser window is resized, and a column that kept the width the
   * page loaded at would be the same bug in a different costume.
   */
  if (Platform.OS !== 'web') return <>{children}</>;
  const constrain = width > DESIGN_WIDTH;
  const side = constrain && width >= SIDE_COPY_FROM;
  /*
   * One tree at every width (2026-10-07). This returned the bare children below the design width and a wrapped tree
   * above it, so dragging a browser window across 402px swapped the tree and REMOUNTED THE WHOLE APP — every screen's
   * state, an open signing window, a half-typed amount, gone. What changes with the width now is only styles and null
   * slots, so React keeps every component where it was.
   */
  return (
    <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', backgroundColor: colors.bg }}>
      {/* The room's light: violet behind the app, blue rising from the far corner. */}
      {constrain ? <Glow color={colors.aurora1} strength={0.32} style={{ top: '-30%', bottom: '10%', left: '15%', right: '15%' }} /> : null}
      {constrain ? <Glow color={colors.aurora2} strength={0.18} style={{ top: '-40%', bottom: '40%', left: '55%', right: '-20%' }} /> : null}
      {side ? (
        <View style={{ flex: 1, alignItems: 'flex-end', justifyContent: 'center', paddingRight: space.s44 * 2 }} aria-hidden>
          <View style={{ maxWidth: 360, gap: space.s16 }}>
            <Image source={WORDMARK} accessibilityLabel={brand.WORDMARK} style={{ width: WORDMARK_W, height: WORDMARK_H }} resizeMode="contain" />
            <Text variant="onboardingTitle">{brand.TAGLINE}</Text>
            <Text variant="body" color={colors.ink55}>
              {onMonad ? brand.SUBLINE_MONAD : brand.SUBLINE}
            </Text>
            <View style={{ gap: space.s10, marginTop: space.s8 }}>
              {FACTS.map((f) => (
                <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s10 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, boxShadow: glow.soft }} />
                  <Text variant="secondary" color={colors.ink70}>
                    {f}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      ) : null}
      {/*
        `overflow: hidden` so a sheet animating in from below is clipped to the column rather than
        sliding across the whole window, and `width` rather than `maxWidth` because the children
        measure themselves against a definite width.
      */}
      <View
        style={
          constrain
            ? {
                width: DESIGN_WIDTH,
                overflow: 'hidden',
                backgroundColor: colors.bg,
                borderLeftWidth: 1,
                borderRightWidth: 1,
                borderColor: colors.accentLine,
                boxShadow: `${glow.soft}, 0px 0px 120px rgba(106,71,255,0.18)`,
              }
            : { flex: 1, backgroundColor: colors.bg }
        }
      >
        {children}
      </View>
      {side ? <View style={{ flex: 1 }} /> : null}
    </View>
  );
}
