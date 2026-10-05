/**
 * One run, in full: what it tried, what stopped it, and the transaction if there was one.
 *
 * The list answers "what has the bot been doing". This answers "why did that one not happen",
 * which is the question people actually have, and it is the reason the `error` column is rendered
 * verbatim rather than mapped to a friendly sentence. "daily cap" and "no live market for WETH"
 * are different problems with different fixes, and a single "could not run" hides both.
 */
import React, { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useGoBack } from '@/nav/useGoBack';
import {
  Button,
  ErrorState,
  Fill,
  HeaderBar,
  Placeholder,
  Screen,
  SheetCard,
  Text,
  colors,
  radius,
  space,
  type FigureKind,
} from '@/ui';
import { money, price, quantity, when } from '@/format';
import { useAsync } from '@/data/useAsync';
import { system, type StrategyRunRow } from '@/data/system';
import { kindLabel, labelFigure } from '@/strategies/ladder';
import { FillReceipt } from '@/ui/FillReceipt';
import { routingLine } from '@/ui/fillVenue';
import { api } from '@/data/api';
import { ApiError, errorText } from '@/data/apiError';
import { useMera } from '@/auth/mera/session';
import { notesKey } from '@/auth/mera/notes-key';
import { openNote, sealNote, type SealedNote } from '@/auth/mera/notes';
import { passkeyFailure } from '@/auth/mera/failure';

function toneFor(status: StrategyRunRow['status']): string {
  if (status === 'filled') return colors.up;
  if (status === 'failed') return colors.down;
  if (status === 'pending') return colors.ink40;
  return colors.warn;
}

export default function RunDetail() {
  const goBack = useGoBack();
  const { id } = useLocalSearchParams<{ id: string }>();
  /*
   * Fetched from the list rather than a per-run route, because there is no per-run route and
   * inventing one for a screen that only opens from the list would be a round trip for nothing.
   * The list is capped, so a run older than that is not reachable — said plainly below rather than
   * rendered as an empty screen.
   */
  const { data, loading, error, reload } = useAsync(() => system.runs(200), []);
  const run = (data ?? []).find((r) => r.id === id);
  const routing = run ? routingLine({ venue: run.venue, compared: run.compared, unit: run.side === 'sell' ? 'USDC' : run.symbol === 'MON' ? 'WMON' : run.symbol }) : null;

  return (
    <Screen gutter="none">
      <View style={{ paddingHorizontal: space.gutter }}>
        <HeaderBar onBack={goBack} title={<Text variant="screenTitle">Run</Text>} />
      </View>

      <Fill style={{ marginTop: space.s16, paddingHorizontal: space.gutter }}>
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <Placeholder height={170} />
        ) : !run ? (
          <Text variant="body" color={colors.ink55}>
            Not among your latest 200 runs.
          </Text>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: space.s30, gap: space.s10 }}
          >
            <SheetCard bordered borderRadius={radius.panel} padding={space.s18}>
              <Text variant="footnote" color={colors.ink55} figure={labelFigure(run.kind)}>
                {run.label.toUpperCase()}
              </Text>
              <Text variant="screenTitle" color={toneFor(run.status)} style={{ marginTop: space.s6 }}>
                {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
              </Text>
              <Text variant="secondarySm" color={colors.ink55} style={{ marginTop: space.s8 }}>
                {/* The kind as the library names it — "Recurring buy", not `dca`. */}
                {run.symbol} · {kindLabel(run.kind)} · {when(new Date(run.at).getTime())}
              </Text>
            </SheetCard>

            {run.error ? (
              <SheetCard bordered borderRadius={radius.panel} padding={space.s14}>
                <Text variant="footnote" color={colors.ink55}>
                  WHY IT DID NOT HAPPEN
                </Text>
                {/*
                  Verbatim. "daily cap" and "no live market for WETH" need different responses from
                  the reader, and one friendly sentence for both would cost them that.
                */}
                {/* A refusal can name the cap it met — "$1,600.00 cap" — which is the person's own, as on the list. */}
                <Text variant="secondary" color={colors.ink65} style={{ marginTop: space.s6 }} figure="own">
                  {run.error}
                </Text>
              </SheetCard>
            ) : null}

            {run.usd !== null ? <Field label="Size" value={money(run.usd)} figure="own" /> : null}
            {run.units !== null ? <Field label="Units" value={quantity(run.units)} figure="units" /> : null}
            {run.price !== null ? <Field label="Price" value={price(run.price)} figure="market" /> : null}

            {/*
              The receipt, with the venue it filled at — which this screen recorded all along and did not show. A
              signature on its own proves a transaction happened; the venue is what says WHICH event it was, and a
              `venue-vault` settlement and a `jupiter-route` fill produce equally valid signatures for two different
              things (`fillVenue.ts`).

              `animate={false}`: this screen is opened from the list, so its run already happened. A receipt that rises
              into place here would be saying a fill just landed when it may be a week old.
            */}
            {run.signature ? (
              <FillReceipt signature={run.signature} venue={run.venue} animate={false} />
            ) : null}
            {/* Where Kuru's book and Uniswap were both measured for this fill: what routing it was worth (settle.ts). */}
            {routing ? (
              <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s8 }} testID="run-routing">
                {routing}
              </Text>
            ) : null}

            {/* A note only the owner's passkey opens (Mera: a second key from the same passkey, `auth/mera/notes.ts`). */}
            <PrivateNote runId={run.id} />
          </ScrollView>
        )}
      </Fill>
    </Screen>
  );
}

/** One figure of the run, which says what it is: the size and units are the person's, the price is the market's. */
function Field({ label, value, figure }: { label: string; value: string; figure: FigureKind }) {
  return (
    <SheetCard bordered borderRadius={radius.panel} padding={space.s14}>
      <Text variant="footnote" color={colors.ink55}>
        {label}
      </Text>
      <Text variant="rowPrimary" style={{ marginTop: space.s4 }} figure={figure}>
        {value}
      </Text>
    </SheetCard>
  );
}

/**
 * A private note on a run, sealed on this device with a key from the owner's passkey under its own PRF salt — not the
 * wallet's key — so xorr's server keeps ciphertext it cannot read, and the same passkey opens it on any device.
 * Only for a passkey account: an email sign-in has no passkey to derive the key from.
 */
function PrivateNote({ runId }: { runId: string }) {
  const mera = useMera();
  const [mode, setMode] = useState<'locked' | 'opening' | 'open' | 'saving'>('locked');
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string>();
  const [failure, setFailure] = useState<string>();
  if (!mera.signedIn) return null;

  const subject = `/notes/${encodeURIComponent(`run:${runId}`)}`;
  const fail = (e: unknown) => setFailure(e instanceof ApiError ? errorText(e) : passkeyFailure(e) || undefined);

  async function unlock() {
    setMode('opening');
    setFailure(undefined);
    try {
      const key = await notesKey();
      const { note } = await api.get<{ note: (SealedNote & { updatedAt: string }) | null }>(subject);
      setText(note ? await openNote(key, note) : '');
      setStatus(note ? `Saved ${when(Date.parse(note.updatedAt))}.` : undefined);
      setMode('open');
    } catch (e) {
      fail(e);
      setMode('locked');
    }
  }

  async function save() {
    setMode('saving');
    setFailure(undefined);
    try {
      const sealed = await sealNote(await notesKey(), text);
      const r = await api.put<{ updatedAt: string }>(subject, sealed);
      setStatus(`Saved ${when(Date.parse(r.updatedAt))} — encrypted on this device.`);
    } catch (e) {
      fail(e);
    } finally {
      setMode('open');
    }
  }

  return (
    <SheetCard bordered borderRadius={radius.panel} padding={space.s14} style={{ marginTop: space.s16 }}>
      <Text variant="rowPrimary">Private note</Text>
      <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s4 }}>
        Encrypted with a key from your passkey — its own, not your wallet’s. xorr’s server stores only ciphertext.
      </Text>
      {mode === 'locked' || mode === 'opening' ? (
        <Button
          label="Unlock with your passkey"
          variant="secondary"
          loading={mode === 'opening'}
          onPress={() => void unlock()}
          style={{ marginTop: space.s10 }}
          testID="note-unlock"
        />
      ) : (
        <>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            placeholder="Why this trade, what you would do differently…"
            placeholderTextColor={colors.ink40}
            accessibilityLabel="Private note"
            style={{ marginTop: space.s10, minHeight: 90, color: colors.ink, backgroundColor: colors.inputBg, borderRadius: radius.tile, padding: space.s10, textAlignVertical: 'top' }}
          />
          <Button label="Save note" loading={mode === 'saving'} onPress={() => void save()} style={{ marginTop: space.s10 }} testID="note-save" />
        </>
      )}
      {failure ? (
        <Text variant="footnote" color={colors.down} style={{ marginTop: space.s8 }}>
          {failure}
        </Text>
      ) : status ? (
        <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s8 }}>
          {status}
        </Text>
      ) : null}
    </SheetCard>
  );
}
