/**
 * Built on Monad (docs/ROADMAP-WIN.md F4 and "Monad-native coverage", 2026-10-07).
 *
 * Two lists, each row a reading made now rather than a logo:
 *
 *   Monad-native — its blocks going final live (monadNewHeads), receipts with the send
 *   (eth_sendRawTransactionSync), the txpool status a pending send needs, passkeys checked by the P256 precompile, native
 *   staking at 0x1000, gas billed on the limit and the 10 MON reserve, and the canonical contracts;
 *   The sponsors' technology on Monad — Kuru, Uniswap and Chainlink pricing MON against each other, Perpl's markets,
 *   Agora AUSD's peg, Envio's index, Mera's passkey account, Kimi's seat, Chainlink CRE, and MetaMask's plugin.
 *
 * Every row says where it runs — live on Monad mainnet, on the local fork of it, or waiting for the testnet go — because
 * a fork's numbers presented as Monad's would be the overclaim this product argues against. A read that failed says so.
 */
import React, { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useGoBack } from '@/nav/useGoBack';
import { Button, Fill, HeaderBar, LoadingRows, Screen, SheetCard, Text, colors, radius, size, space } from '@/ui';
import { Rise } from '@/ui/Rise';
import { shortAddress } from '@/format';
import { usePoll } from '@/data/usePoll';
import { bigMon, monad, type MonadNative, type PasskeyCheck, type SponsorsLive } from '@/data/monad';
import { CommitStrip } from '@/speed/CommitStrip';
import { useAuth } from '@/auth/useAuth';
import { checkPasskeyOnMonad, passkeyCheckSupported } from '@/monad/passkeyCheck';

type Where = 'mainnet' | 'fork' | 'awaiting' | 'app';
const WHERE: Record<Where, { label: string; fg: string; bg: string }> = {
  mainnet: { label: 'Live · Monad mainnet', fg: colors.up, bg: colors.upBg },
  fork: { label: 'Local fork', fg: colors.accentHi, bg: colors.accentSoft },
  awaiting: { label: 'Awaiting testnet go', fg: colors.ink70, bg: colors.neutralBg },
  app: { label: 'In the app', fg: colors.ink70, bg: colors.neutralBg },
};

function WhereChip({ w }: { w: Where }) {
  const s = WHERE[w];
  return (
    <View style={{ paddingHorizontal: space.s8, paddingVertical: 3, borderRadius: radius.card, backgroundColor: s.bg }}>
      <Text variant="footnoteSm" color={s.fg}>
        {s.label}
      </Text>
    </View>
  );
}

function Item({ n, title, where, children, testID }: { n?: string; title: string; where: Where[]; children: React.ReactNode; testID?: string }) {
  return (
    <SheetCard bordered borderRadius={radius.panel} padding={space.s16} testID={testID}>
      {n ? <Text variant="eyebrow">{n}</Text> : null}
      <Text variant="rowPrimary" style={{ marginTop: n ? space.s4 : 0 }}>
        {title}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s6, marginTop: space.s8 }}>
        {where.map((w) => (
          <WhereChip key={w} w={w} />
        ))}
      </View>
      <View style={{ marginTop: space.s10, gap: space.s6 }}>{children}</View>
    </SheetCard>
  );
}

/** One reading: what, and its value — red when the read failed. */
function Reading({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s12 }}>
      <Text variant="secondarySm" color={colors.ink55}>
        {label}
      </Text>
      <Text variant="secondarySm" color={bad ? colors.down : colors.ink} style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

function Note({ children }: { children: string }) {
  return (
    <Text variant="footnote" color={colors.ink55}>
      {children}
    </Text>
  );
}

const yes = (b: boolean | null | undefined, y = 'yes', n = 'no') => (b === null || b === undefined ? 'could not read' : b ? y : n);
const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumSignificantDigits: 5 })}`;
const open = (url: string) => () => void Linking.openURL(url);

function PasskeyButton() {
  const { address } = useAuth();
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<PasskeyCheck | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!passkeyCheckSupported()) return <Note>Checking your own passkey needs the web app: the phone’s passkey module does not hand back the signature.</Note>;
  if (!address) return <Note>Sign in with a passkey to check it on Monad.</Note>;
  return (
    <View style={{ gap: space.s6 }}>
      <Button
        label={r ? 'Check again' : 'Check my passkey on Monad'}
        variant="secondary"
        loading={busy}
        testID="monad-passkey-check"
        onPress={async () => {
          setBusy(true);
          setErr(null);
          try {
            setR(await checkPasskeyOnMonad());
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      />
      {r ? (
        <View testID="monad-passkey-result" style={{ gap: space.s4 }}>
          <Reading label="Your passkey’s key" value={shortAddress(r.publicKey, 10, 6)} />
          <Reading label="0x0100 on Monad mainnet" value={yes(r.mainnet.valid, 'signature valid ✓', 'refused')} bad={r.mainnet.valid === false} />
          <Reading label="0x0100 on the fork" value={yes(r.executor.valid, 'signature valid ✓', 'refused')} bad={r.executor.valid === false} />
          <Reading label="Same signature, other message" value={r.mainnet.tamperedValid === false ? 'refused ✓' : yes(r.mainnet.tamperedValid, 'accepted ✗', 'refused ✓')} bad={r.mainnet.tamperedValid === true} />
        </View>
      ) : null}
      {err ? <Text variant="footnote" color={colors.down}>{err}</Text> : null}
    </View>
  );
}

function NativeList({ d }: { d: MonadNative }) {
  const st = d.staking;
  return (
    <>
      <Item n="1 · monadNewHeads" title="Every block, going final, live" where={['mainnet']} testID="monad-item-commits">
        <CommitStrip count={4} />
        <Note>The fork has no consensus to show; this is Monad mainnet’s own pipeline. It sits on every fill’s speed card too.</Note>
      </Item>

      <Item n="2 · eth_sendRawTransactionSync" title="A fill’s receipt comes back with the send" where={['fork', 'awaiting']} testID="monad-item-sync">
        <Reading label="On this executor’s chain" value={d.sync.executor.ok ? yes(d.sync.executor.supported, 'supported — every fill uses it', 'not supported') : 'could not read'} bad={d.sync.executor.ok && !d.sync.executor.supported} />
        <Note>Each fill is timed twice: executed (the call’s own duration) and final (Monad’s finalized block reaching it, two slots on). On the fork only the first means anything; final times arrive with the testnet go.</Note>
      </Item>

      <Item n="3 · txpool_statusByHash" title="A send the node holds, before it is in a block" where={['mainnet']} testID="monad-item-txpool">
        <Reading label="Monad mainnet" value={d.txpool.mainnet.ok ? yes(d.txpool.mainnet.supported, 'answers', 'no such method') : 'could not read'} />
        <Reading label="The fork (anvil)" value={d.txpool.executor.ok ? yes(d.txpool.executor.supported, 'answers', 'no such method') : 'could not read'} />
        <Note>On Monad eth_getTransactionByHash does not return a pending transaction, so the executor asks the txpool before it calls a sent hash absent.</Note>
      </Item>

      <Item n="4 · P256VERIFY at 0x0100" title="Your passkey, checked by Monad itself" where={['mainnet', 'fork']} testID="monad-item-p256">
        <Reading label="A fresh P-256 signature, mainnet" value={d.p256.mainnet.ok ? `${yes(d.p256.mainnet.accepts, 'valid ✓', 'refused')} · tampered ${d.p256.mainnet.refusesTampered ? 'refused ✓' : 'accepted ✗'}` : 'could not read'} bad={!d.p256.mainnet.ok} />
        <Reading label="The same on the fork" value={d.p256.executor.ok ? `${yes(d.p256.executor.accepts, 'valid ✓', 'refused')} · tampered ${d.p256.executor.refusesTampered ? 'refused ✓' : 'accepted ✗'}` : 'could not read'} bad={!d.p256.executor.ok} />
        <Note>Your account comes from your passkey (Mera). This asks the chain to check the passkey’s own signature: an eth_call to the precompile, 6,900 gas — no verifier contract of anyone’s in the path.</Note>
        <PasskeyButton />
      </Item>

      <Item n="5 · Staking at 0x1000" title="Native staking, read from the precompile" where={['mainnet', 'awaiting']} testID="monad-item-staking">
        {st.ok ? (
          <>
            <Reading label="Epoch" value={`${Number(st.epoch).toLocaleString('en-US')}${st.inEpochDelayPeriod ? ' (in its delay period)' : ''}`} />
            <Reading label="Proposing now" value={`validator #${st.proposerValId}`} />
            {st.validator ? (
              <>
                <Reading label="Its stake" value={`${bigMon(st.validator.stakeMon)} MON`} />
                <Reading label="Its commission" value={`${st.validator.commissionPct}%`} />
              </>
            ) : null}
          </>
        ) : (
          <Reading label="The precompile" value={`could not read: ${st.error}`} bad />
        )}
        <Note>Read through Monad’s own viem actions (@monad-crypto/viem). Staking idle MON from the app is a delegate transaction: it waits for the testnet go.</Note>
      </Item>

      <Item n="6 · Gas and the reserve" title="Billed on the limit; 10 MON kept in reserve" where={['fork', 'mainnet']} testID="monad-item-gas">
        <Reading label="Head-room over the estimate" value="10% on Monad (30% elsewhere)" />
        <Reading label="A Kuru fill, declared" value="502,260 → 424,989 gas (−15%)" />
        <Reading label="0x1001 on Monad mainnet" value={d.reserve.mainnet.ok ? yes(d.reserve.mainnet.answers, `answers (dipped: ${d.reserve.mainnet.dipped ? 'yes' : 'no'})`, 'no answer') : 'could not read'} />
        <Reading label="0x1001 on the fork" value={d.reserve.executor.ok ? yes(d.reserve.executor.answers, 'answers', 'none: anvil has no precompile') : 'could not read'} />
        <Note>The fee before an order is the limit times Monad’s price, in MON. A top-up that would take the desk under its reserve is refused before it is sent; fees in flight are kept within what consensus allows.</Note>
      </Item>

      <Item n="8 · Canonical contracts" title="Monad’s own, not copies" where={['mainnet', 'fork']} testID="monad-item-contracts">
        {d.contracts.map((c) => (
          <View key={c.name} style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s10 }}>
              <Text variant="secondarySm" color={c.used ? colors.ink : colors.ink55} onPress={open(`https://monadvision.com/address/${c.address}`)}>
                {`${c.name} ${shortAddress(c.address)}`}
              </Text>
              <Text variant="footnoteSm" color={c.mainnet && c.executor ? colors.up : colors.down}>
                {`mainnet ${c.mainnet ? '✓' : '✗'} · fork ${c.executor ? '✓' : '✗'}`}
              </Text>
            </View>
            <Text variant="footnoteSm" color={colors.ink40}>
              {c.use}
            </Text>
          </View>
        ))}
        <Text variant="secondarySm" color={colors.ink70} style={{ marginTop: space.s6 }}>
          xorr’s own on Monad testnet, Sourcify-verified:
        </Text>
        {d.deployed.map((c) => (
          <Text key={c.name} variant="secondarySm" color={colors.accentHi} onPress={open(c.explorer)}>
            {`${c.name} ${shortAddress(c.address)} ↗`}
          </Text>
        ))}
      </Item>
    </>
  );
}

function SponsorsList({ s }: { s: SponsorsLive }) {
  const { address } = useAuth();
  const p = s.prices;
  return (
    <>
      <Item title="Kuru, Uniswap and Chainlink: MON priced three ways" where={['mainnet']} testID="monad-sponsor-prices">
        {p.ok ? (
          <>
            <Reading label="Kuru order book (mid)" value={p.kuru ? `${usd(p.kuru.mid)}${p.kuru.spreadBps !== null ? ` · spread ${p.kuru.spreadBps.toFixed(1)} bps` : ''}` : 'could not read'} bad={!p.kuru} />
            <Reading label={`Uniswap v3 (${p.uniswap?.pool ?? 'pool'})`} value={p.uniswap ? usd(p.uniswap.price) : 'could not read'} bad={!p.uniswap} />
            <Reading label="Chainlink MON/USD" value={p.chainlink ? `${usd(p.chainlink.price)} · ${Math.round(p.chainlink.ageSec)} s old` : 'could not read'} bad={!p.chainlink} />
            {p.maxGapBps !== null ? <Reading label="Widest gap" value={`${p.maxGapBps.toFixed(1)} bps`} /> : null}
          </>
        ) : (
          <Reading label="Prices" value={`could not read: ${p.error}`} bad />
        )}
        <Note>The council’s price desk votes on exactly this, and every fill is routed to whichever of Kuru and Uniswap gives more.</Note>
      </Item>
      <Item title="Perpl: perps from a desk only you can withdraw from" where={['fork']} testID="monad-sponsor-perpl">
        {s.perpl.ok ? (
          <>
            <Reading label={s.perpl.network} value={`${s.perpl.open} markets open`} />
            {s.perpl.markets.slice(0, 3).map((m) => (
              <Reading key={m.name} label={m.name} value={`${m.mark !== null ? usd(m.mark) : '—'} · funding ${m.fundingPctPerHour !== null ? `${m.fundingPctPerHour.toFixed(4)}%/h` : '—'}`} />
            ))}
          </>
        ) : (
          <Reading label="Perpl" value={`could not read: ${s.perpl.error}`} bad />
        )}
      </Item>
      <Item title="Agora AUSD: the perps desk’s margin" where={['mainnet']} testID="monad-sponsor-ausd">
        <Reading label="Peg (Chainlink AUSD/USD)" value={s.ausd.ok ? `${usd(s.ausd.price)} · ${Math.round(s.ausd.ageSec / 60)} min old` : `could not read: ${s.ausd.error}`} bad={!s.ausd.ok} />
      </Item>
      <Item title="Envio: History is the index, not a scan" where={['fork']} testID="monad-sponsor-envio">
        {s.envio.ok ? (
          <>
            <Reading label="Indexed to block" value={`${s.envio.processedBlock.toLocaleString('en-US')} (${s.envio.behind === 0 ? 'at the head' : `${s.envio.behind} behind`})`} />
            <Reading label="Events · fills" value={`${s.envio.events.toLocaleString('en-US')} · ${s.envio.fills.toLocaleString('en-US')}`} />
          </>
        ) : (
          <Reading label="Envio" value={`could not read: ${s.envio.error}`} bad />
        )}
      </Item>
      <Item title="Mera: the account is the passkey" where={['app']} testID="monad-sponsor-mera">
        <Reading label="This session" value={address ? shortAddress(address) : 'signed out'} />
        <Note>Derived from the passkey’s PRF output on this device; nothing that can sign is stored. Item 4 checks the passkey itself on chain.</Note>
      </Item>
      <Item title="Kimi: the Strategist seat" where={['app']} testID="monad-sponsor-kimi">
        <Reading label="Sits on the council" value={s.kimi.configured ? 'yes' : `no — needs ${s.kimi.needs}`} bad={!s.kimi.configured} />
      </Item>
      <Item title="Chainlink CRE: a workflow that can halt trading" where={s.cre.receiver ? ['fork'] : ['awaiting']} testID="monad-sponsor-cre">
        <Reading label="Receiver" value={s.cre.receiver ? shortAddress(s.cre.receiver) : s.cre.where} />
      </Item>
      <Item title="MetaMask: mm perpl, the desk from a terminal" where={['app']} testID="monad-sponsor-metamask">
        <Note>A command-line plugin (mm-plugin-perpl/): markets, desk, long, short, close — the same Perpl desk, so there is no live reading to show here.</Note>
      </Item>
    </>
  );
}

export default function BuiltOnMonad() {
  const goBack = useGoBack();
  const native = usePoll(() => monad.native(), 20_000);
  const sponsors = usePoll(() => monad.sponsors(), 20_000);
  return (
    <Screen gutter="none">
      <View style={{ paddingHorizontal: space.gutter }}>
        <HeaderBar onBack={goBack} title={<Text variant="screenTitle">Built on Monad</Text>} />
        <Text variant="secondary" color={colors.ink55} style={{ marginTop: space.s6 }}>
          What xorr uses of Monad itself, and the sponsors’ tech on it — each row read now, each saying where it runs.
        </Text>
      </View>
      <Fill style={{ marginTop: space.s12 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.s30, gap: space.s10 }}>
          <Text variant="eyebrow" style={{ marginTop: space.s4 }}>
            Monad-native
          </Text>
          {native.data ? (
            <Rise index={0} style={{ gap: space.s10 }}>
              <NativeList d={native.data} />
            </Rise>
          ) : native.error ? (
            <Note>{`The executor could not read Monad: ${native.error.message}`}</Note>
          ) : (
            <LoadingRows count={3} height={size.rowLg} />
          )}
          <Text variant="eyebrow" style={{ marginTop: space.s14 }}>
            The sponsors’ tech on Monad
          </Text>
          {sponsors.data ? (
            <Rise index={1} style={{ gap: space.s10 }}>
              <SponsorsList s={sponsors.data} />
            </Rise>
          ) : sponsors.error ? (
            <Note>{`The executor could not read them: ${sponsors.error.message}`}</Note>
          ) : (
            <LoadingRows count={3} height={size.rowLg} />
          )}
        </ScrollView>
      </Fill>
    </Screen>
  );
}
