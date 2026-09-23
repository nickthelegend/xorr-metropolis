/**
 * Perps: Perpl, traded by your agent from a desk you own (FEATURES-100 #2–#7, #13, #23, #26, #49, #50).
 *
 * The desk is Perpl's own DelegatedAccount. You own it: only you can withdraw, and a withdrawal only ever pays you. xorr's
 * agent key is its operator: it can open and close positions inside the limits you set, and can never move money out.
 * Holding Stop removes the operator on chain — after that nothing xorr sends can trade it, and Perpl's contract says so.
 *
 * Setting up is three signatures: a message (Perpl's factory makes the desk; xorr pays that gas), then sending AUSD to the
 * desk and opening its Perpl account. Every figure on this screen is read from the chain by the executor on each load.
 */
import React, { useCallback, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import type { Address, Hex } from 'viem';
import { useGoBack } from '@/nav/useGoBack';
import {
  Button,
  EmptyState,
  ErrorState,
  HeaderBar,
  HoldButton,
  LoadingRows,
  Pill,
  PillRow,
  Press,
  Screen,
  SheetCard,
  Tag,
  Text,
  colors,
  money,
  radius,
  size,
  space,
} from '@/ui';
import { useGrantDelegation } from '@/auth/useGrantDelegation';
import { chainAccess } from '@/wallet/chainAccess';
import { useAsync } from '@/data/useAsync';
import { apiProse } from '@/data/apiError';
import { deskCalls, perps, type Desk, type DeskPosition, type PerpMarket, type PerpOrder } from '@/data/perps';

const SIZES = [25, 50, 100] as const;
const OPEN_AMOUNT = 150;

/** A MON price has five meaningful decimals; BTC none past the cent. */
function px(v: number | null): string {
  if (v === null) return '—';
  return v >= 100 ? money(v) : v >= 1 ? `$${v.toFixed(3)}` : `$${v.toFixed(5)}`;
}

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;

function TxLink({ label, url }: { label: string; url: string | null }) {
  if (!url || !url.startsWith('http')) return <Text variant="footnote" color={colors.ink55}>{label}</Text>;
  return (
    <Press onPress={() => void Linking.openURL(url)} accessibilityRole="link">
      <Text variant="footnote" color={colors.ink65} style={{ textDecorationLine: 'underline' }}>
        {label}
      </Text>
    </Press>
  );
}

function fundingLine(m: PerpMarket): string {
  if (m.fundingPerInterval === null) return 'Funding —';
  const pct = Math.abs(m.fundingPerInterval * 100).toFixed(4);
  const mins = m.fundingIntervalSec ? Math.round(m.fundingIntervalSec / 60) : null;
  const who = m.fundingPerInterval >= 0 ? 'longs pay' : 'shorts pay';
  return `Funding: ${who} ${pct}%${mins ? ` every ${mins} min` : ''}`;
}

/** How close a position is to liquidation, drawn: the bar empties as the mark walks toward the liquidation price. */
function LiqMeter({ p }: { p: DeskPosition }) {
  const d = p.liqDistance;
  if (d === null) return null;
  const fill = Math.max(0.04, Math.min(1, d / 0.5));
  const tone = d < 0.1 ? colors.down : d < 0.25 ? colors.warn : colors.up;
  return (
    <View style={{ marginTop: space.s6 }}>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.neutralBg, overflow: 'hidden' }}>
        <View style={{ width: `${fill * 100}%`, height: 6, backgroundColor: tone }} />
      </View>
      <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s4 }}>
        Liquidation {px(p.liquidation)} · {(d * 100).toFixed(1)}% away
      </Text>
    </View>
  );
}

function PositionCard({ p, onClose, closing }: { p: DeskPosition; onClose: () => void; closing: boolean }) {
  return (
    <SheetCard bordered borderRadius={radius.panel} padding={space.s14}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', gap: space.s8, alignItems: 'center' }}>
          <Text variant="rowPrimary">{p.market}</Text>
          <Tag small label={p.long ? 'Long' : 'Short'} tone={p.long ? 'up' : 'down'} />
        </View>
        <Text variant="rowPrimary" color={p.pnl >= 0 ? colors.up : colors.down}>
          {p.pnl >= 0 ? '+' : '−'}
          {money(Math.abs(p.pnl))}
        </Text>
      </View>
      <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s6 }}>
        {p.lots.toLocaleString()} {p.market} · entry {px(p.entry)} · mark {px(p.mark)} · margin {money(p.deposit)}
      </Text>
      <LiqMeter p={p} />
      <Button label={`Close ${p.long ? 'long' : 'short'}`} variant="secondary" loading={closing} onPress={onClose} style={{ marginTop: space.s10 }} testID={`perps-close-${p.perpId}`} />
    </SheetCard>
  );
}

function orderLine(o: PerpOrder): string {
  const what = { open_long: 'Opened long', open_short: 'Opened short', close_long: 'Closed long', close_short: 'Closed short' }[o.side];
  const by = o.placed_by === 'owner' ? 'you' : o.placed_by;
  return `${what} ${Number(o.lots).toLocaleString()} ${o.market} · ≈${money(Number(o.notional_usd))} · ${o.status} · by ${by}`;
}

export default function Perps() {
  const goBack = useGoBack();
  const desk = useAsync(() => perps.desk(), []);
  const markets = useAsync(() => perps.markets(), []);
  const orders = useAsync(() => perps.orders(), []);
  const { sendTransaction, signTypedData } = useGrantDelegation();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; url?: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [perpId, setPerpId] = useState<number | null>(null);
  const [usd, setUsd] = useState<(typeof SIZES)[number]>(50);

  const reload = useCallback(() => {
    desk.reload();
    orders.reload();
    markets.reload();
  }, [desk, orders, markets]);

  const run = async (key: string, f: () => Promise<{ text: string; url?: string | null } | void>) => {
    setBusy(key);
    setErr(null);
    try {
      const r = await f();
      if (r) setNote(r);
      reload();
    } catch (e) {
      setErr(apiProse(e) ?? (e instanceof Error ? e.message : 'That did not go through.'));
    } finally {
      setBusy(null);
    }
  };

  /** Send as the owner and wait for the chain to say it landed. */
  const ownerTx = async (to: Address, data: Hex) => {
    const hash = await sendTransaction(to, data);
    const r = await chainAccess.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (r.status !== 'success') throw new Error(`The transaction reverted on chain (${short(hash)}).`);
    return hash;
  };

  const d: Desk | undefined = desk.data;
  const mkts = markets.data?.markets ?? [];
  const selected = mkts.find((m) => m.id === (perpId ?? mkts.find((x) => x.name === 'MON')?.id ?? mkts[0]?.id)) ?? null;

  return (
    <Screen gutter="none">
      <View style={{ paddingHorizontal: space.gutter }}>
        <HeaderBar onBack={goBack} title={<Text variant="screenTitle">Perps</Text>} />
        <Text variant="secondary" color={colors.ink55} style={{ marginTop: space.s6 }}>
          Perpl, traded by your agent from a desk only you can withdraw from.
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.gutter, gap: space.s12, paddingBottom: space.s44 }}>
        {desk.error ? <ErrorState error={desk.error} onRetry={desk.reload} /> : null}
        {!d && !desk.error ? <LoadingRows count={2} height={size.rowLg} /> : null}

        {d ? (
          <SheetCard bordered borderRadius={radius.panel} padding={space.s14}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="rowPrimary">Your desk · {d.network}</Text>
              {d.desk ? (
                <Tag small sentence label={d.operatorActive ? 'Agent can trade · can’t withdraw' : 'Agent stopped'} tone={d.operatorActive ? 'up' : 'down'} />
              ) : (
                <Tag small sentence label="Not set up" tone="neutral" />
              )}
            </View>
            <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s6 }}>
              Wallet: {d.wallet.ausd.toFixed(2)} AUSD · {d.wallet.gas.toFixed(3)} MON for gas
            </Text>
            {d.desk ? (
              <>
                <Text variant="footnote" color={colors.ink55}>
                  On Perpl: {d.balance.toFixed(2)} AUSD{d.locked > 0 ? ` (${d.locked.toFixed(2)} in positions)` : ''} · account #{d.accountId}
                </Text>
                <Text variant="footnote" color={colors.ink55}>
                  Agent limits: {money(d.caps.maxOrderUsd, { decimals: 0 })} an order, {money(d.caps.maxDayUsd, { decimals: 0 })} a day ({money(d.caps.usedTodayUsd)} used), up to {d.caps.maxLeverage}x
                </Text>
                <TxLink label={`Desk ${short(d.desk)} — Perpl's DelegatedAccount`} url={d.explorer ? d.explorer.replace(/\/tx\/.*$/, `/address/${d.desk}`) : null} />
              </>
            ) : null}
          </SheetCard>
        ) : null}

        {d && !d.desk ? (
          <SheetCard bordered borderRadius={radius.panel} padding={space.s14}>
            <Text variant="rowPrimary">Set up in three steps</Text>
            <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s6 }}>
              1 · Test funds (MON for gas, AUSD to trade). 2 · Sign one message: Perpl makes your desk and xorr pays the gas. 3 · Put {OPEN_AMOUNT} AUSD on it.
            </Text>
            {d.wallet.ausd < OPEN_AMOUNT || d.wallet.gas < 0.03 ? (
              <Button
                label="Get test MON and AUSD"
                variant="secondary"
                loading={busy === 'fund'}
                style={{ marginTop: space.s10 }}
                testID="perps-fund-test"
                onPress={() =>
                  run('fund', async () => {
                    const r = await perps.fundTest();
                    return { text: r.sent.map((s) => s.what).join(' · '), url: r.sent.at(-1)?.explorer };
                  })
                }
              />
            ) : null}
            <Button
              label="Open my Perpl desk"
              loading={busy === 'create'}
              style={{ marginTop: space.s10 }}
              testID="perps-create"
              onPress={() =>
                run('create', async () => {
                  const t = await perps.createData();
                  const signature = await signTypedData({
                    domain: t.domain,
                    types: t.types,
                    primaryType: 'Create',
                    message: { ...t.message, nonce: BigInt(t.message.nonce), deadline: BigInt(t.message.deadline) },
                  } as never);
                  const made = await perps.create({ signature, nonce: t.message.nonce, deadline: t.message.deadline });
                  return { text: `Desk ${short(made.desk)} made by Perpl's factory`, url: made.explorer };
                })
              }
            />
          </SheetCard>
        ) : null}

        {d?.desk && d.accountId === '0' ? (
          <SheetCard bordered borderRadius={radius.panel} padding={space.s14}>
            <Text variant="rowPrimary">Fund your desk</Text>
            <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s6 }}>
              Send {OPEN_AMOUNT} AUSD to the desk and open its Perpl account. Two signatures; the money stays yours.
            </Text>
            <Button
              label={`Put ${OPEN_AMOUNT} AUSD on Perpl`}
              loading={busy === 'open'}
              style={{ marginTop: space.s10 }}
              testID="perps-open-account"
              onPress={() =>
                run('open', async () => {
                  if (d.idle < OPEN_AMOUNT) {
                    const f = deskCalls.fund(d.collateral, d.desk!, OPEN_AMOUNT - d.idle);
                    await ownerTx(f.to, f.data);
                  }
                  const o = deskCalls.open(d.desk!, OPEN_AMOUNT);
                  const h = await ownerTx(o.to, o.data);
                  return { text: `Perpl account opened with ${OPEN_AMOUNT} AUSD`, url: d.explorer?.replace(/0x[0-9a-fA-F]+$/, h) };
                })
              }
            />
          </SheetCard>
        ) : null}

        {d?.desk && d.accountId !== '0' && d.allowlistMissing.length > 0 ? (
          <SheetCard bordered borderRadius={radius.panel} padding={space.s14}>
            <Text variant="rowPrimary">One more signature</Text>
            <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s6 }}>
              Perpl changed its order function after your desk's code was written. Let xorr's key call the current one ({d.allowlistMissing.map((m) => m.name).join(', ')}). It still cannot withdraw.
            </Text>
            <Button
              label="Allow trading"
              loading={busy === 'allow'}
              style={{ marginTop: space.s10 }}
              testID="perps-allow"
              onPress={() =>
                run('allow', async () => {
                  for (const m of d.allowlistMissing) {
                    const c = deskCalls.allow(d.desk!, m.selector);
                    await ownerTx(c.to, c.data);
                  }
                  return { text: 'xorr can place orders on your desk' };
                })
              }
            />
          </SheetCard>
        ) : null}

        {mkts.length > 0 ? (
          <SheetCard bordered borderRadius={radius.panel} padding={space.s14}>
            <PillRow>
              {mkts.map((m) => (
                <Pill key={m.id} label={m.name} selected={m.id === selected?.id} onPress={() => setPerpId(m.id)} />
              ))}
            </PillRow>
            {selected ? (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: space.s10 }}>
                  <Text variant="rowPrimary">{selected.name} perp</Text>
                  <Text variant="rowPrimary">{px(selected.mark)}</Text>
                </View>
                <Text variant="footnote" color={colors.ink55}>
                  Bid {px(selected.bid)} · ask {px(selected.ask)} · up to {selected.maxLeverage}x
                </Text>
                <Text variant="footnote" color={colors.ink55}>{fundingLine(selected)}</Text>
                {d?.desk && d.accountId !== '0' && d.allowlistMissing.length === 0 && d.operatorActive ? (
                  <>
                    <PillRow style={{ marginTop: space.s10 }}>
                      {SIZES.map((n) => (
                        <Pill key={n} label={`${money(n, { decimals: 0 })} · 2x`} selected={n === usd} onPress={() => setUsd(n)} />
                      ))}
                    </PillRow>
                    <View style={{ flexDirection: 'row', gap: space.s8, marginTop: space.s10 }}>
                      {(['open_long', 'open_short'] as const).map((side) => (
                        <View key={side} style={{ flex: 1 }}>
                          <Button
                            label={side === 'open_long' ? `Long ${selected.name}` : `Short ${selected.name}`}
                            variant={side === 'open_long' ? 'primary' : 'secondary'}
                            loading={busy === side}
                            testID={`perps-${side}`}
                            onPress={() =>
                              run(side, async () => {
                                const r = await perps.order({ perpId: selected.id, side, usd, leverage: 2 });
                                return { text: `${r.status === 'filled' ? 'Filled' : 'Reverted'}: ${r.lots.toLocaleString()} ${r.market} ≈${money(r.notionalUsd)}`, url: r.explorer };
                              })
                            }
                          />
                        </View>
                      ))}
                    </View>
                    <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s6 }}>
                      xorr's agent key sends it through your desk, immediate-or-cancel within 1% of the book.
                    </Text>
                  </>
                ) : null}
              </>
            ) : null}
          </SheetCard>
        ) : markets.error ? (
          <ErrorState error={markets.error} onRetry={markets.reload} />
        ) : null}

        {note ? <TxLink label={`${note.text}${note.url ? ' — view transaction' : ''}`} url={note.url ?? null} /> : null}
        {err ? <Text variant="footnote" color={colors.down}>{err}</Text> : null}

        {d?.desk && d.accountId !== '0' ? (
          <>
            <Text variant="control" color={colors.ink55}>Positions</Text>
            {d.positions.length === 0 ? (
              <EmptyState text="No open positions. Long or short above, or let an agent do it." />
            ) : (
              d.positions.map((p) => (
                <PositionCard
                  key={p.perpId}
                  p={p}
                  closing={busy === `close-${p.perpId}`}
                  onClose={() =>
                    run(`close-${p.perpId}`, async () => {
                      const r = await perps.order({ perpId: p.perpId, side: p.long ? 'close_long' : 'close_short' });
                      return { text: `Closed ${r.lots.toLocaleString()} ${r.market}`, url: r.explorer };
                    })
                  }
                />
              ))
            )}

            <Text variant="control" color={colors.ink55}>The agent's leash</Text>
            {d.operatorActive ? (
              <HoldButton
                label="Hold to stop the agent"
                accessibilityHint="Hold to remove xorr's key from your desk on chain"
                loading={busy === 'stop'}
                testID="perps-stop"
                onCommit={() =>
                  run('stop', async () => {
                    const c = deskCalls.stop(d.desk!, d.operator);
                    await ownerTx(c.to, c.data);
                    return { text: "Stopped on chain: xorr's key can no longer trade your desk" };
                  })
                }
              />
            ) : (
              <Button
                label="Resume the agent"
                loading={busy === 'resume'}
                testID="perps-resume"
                onPress={() =>
                  run('resume', async () => {
                    const k = await perps.consent();
                    const c = deskCalls.resume(d.desk!, k.operator, k.deadline, k.signature);
                    await ownerTx(c.to, c.data);
                    return { text: 'xorr can trade your desk again, inside your limits' };
                  })
                }
              />
            )}
            <Button
              label={`Withdraw ${(d.balance - d.locked).toFixed(2)} AUSD to my wallet`}
              variant="secondary"
              disabled={d.balance - d.locked <= 0.01}
              loading={busy === 'withdraw'}
              testID="perps-withdraw"
              onPress={() =>
                run('withdraw', async () => {
                  const c = deskCalls.withdraw(d.desk!, d.balance - d.locked);
                  await ownerTx(c.to, c.data);
                  return { text: 'Withdrawn to your wallet — the only place it can go' };
                })
              }
            />
          </>
        ) : null}

        {orders.data && orders.data.orders.length > 0 ? (
          <>
            <Text variant="control" color={colors.ink55}>What the agent did</Text>
            {orders.data.orders.slice(0, 12).map((o) => (
              <TxLink key={o.id} label={orderLine(o)} url={o.tx_hash ? (d?.explorer ?? '').replace(/0x[0-9a-fA-F]+$/, o.tx_hash) : null} />
            ))}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
