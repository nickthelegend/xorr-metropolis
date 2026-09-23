/**
 * Hedge: GMX V2 perps on Arbitrum One (PLAN.md P4.5).
 *
 * The markets the council's Macro Desk reads — who pays funding on ETH and BTC, how one-sided open interest is — and,
 * for the signed-in wallet, its GMX positions and the orders its agent placed. The agent trades as a GMX subaccount of
 * the wallet's own GMX account, so a position here belongs to the wallet, never to the agent. A market order is two
 * transactions: the agent creates it and a GMX keeper executes it, so a pending one says it is waiting for the keeper.
 */
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useGoBack } from '@/nav/useGoBack';
import { Button, ErrorState, HeaderBar, LoadingRows, Pill, PillRow, Screen, SheetCard, Text, colors, money, percent, radius, size, space } from '@/ui';
import { CHAIN_KEY } from '@/chain';
import { useGrantDelegation } from '@/auth/useGrantDelegation';
import { useAsync } from '@/data/useAsync';
import { apiProse } from '@/data/apiError';
import { gmx, type GmxMarket, type GmxOrder, type HedgeResult } from '@/data/gmx';

/** Hedges are placed where GMX runs: on the Arbitrum build. */
const HEDGES_HERE = CHAIN_KEY === 'arbitrum' || CHAIN_KEY === 'arbitrum-fork';
const SIZES = [25, 50, 100] as const;

function resultLine(r: HedgeResult): string {
  const created = `${r.createdTx.slice(0, 10)}…`;
  if (r.status === 'executed') return `Executed${r.keeper ? ' by the fork keeper' : ''} · ${created}`;
  if (r.status === 'pending') return `Waiting for the keeper · ${created}`;
  return `${r.status}${r.reason ? `: ${r.reason}` : ''} · ${created}`;
}

/** Set up, then open or close hedges — placed by the Hedge Desk agent as your GMX subaccount. */
function HedgeControls({ onChange }: { onChange: () => void }) {
  const setup = useAsync(() => gmx.hedgeSetup(), []);
  const { sendTransaction } = useGrantDelegation();
  const [marketId, setMarketId] = useState<'ETH-USD' | 'BTC-USD'>('ETH-USD');
  const [isLong, setIsLong] = useState(false);
  const [usd, setUsd] = useState<(typeof SIZES)[number]>(25);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async (f: () => Promise<string>) => {
    setBusy(true);
    setErr(null);
    try {
      setLine(await f());
      onChange();
      setup.reload();
    } catch (e) {
      setErr(apiProse(e) ?? (e instanceof Error ? e.message : 'That did not go through.'));
    } finally {
      setBusy(false);
    }
  };

  if (setup.error) return <Text variant="footnote" color={colors.ink55}>{apiProse(setup.error) ?? 'Hedging is not available here.'}</Text>;
  if (!setup.data) return <LoadingRows count={1} height={size.rowLg} />;
  const s = setup.data;

  return (
    <SheetCard bordered borderRadius={radius.panel} padding={space.s14}>
      <Text variant="rowPrimary">{s.agentName}</Text>
      <Text variant="footnote" color={colors.ink55}>
        Its wallet {s.agent.slice(0, 6)}…{s.agent.slice(-4)} places orders for your GMX account.
      </Text>
      {s.toSign.length > 0 ? (
        <View style={{ marginTop: space.s10, gap: space.s6 }}>
          {s.toSign.map((t) => (
            <Text key={t.label} variant="footnote" color={colors.ink65}>
              · {t.label}
            </Text>
          ))}
          <Button
            label="Set up hedging"
            loading={busy}
            onPress={() =>
              run(async () => {
                const hashes: string[] = [];
                for (const t of s.toSign) hashes.push(await sendTransaction(t.tx.to, t.tx.data));
                return `Set up · ${hashes.map((h) => `${h.slice(0, 10)}…`).join(', ')}`;
              })
            }
            testID="hedge-setup"
          />
        </View>
      ) : (
        <View style={{ marginTop: space.s10, gap: space.s8 }}>
          <PillRow>
            {(['ETH-USD', 'BTC-USD'] as const).map((m) => (
              <Pill key={m} label={m.replace('-USD', '')} selected={m === marketId} onPress={() => setMarketId(m)} />
            ))}
            <Pill label="Long" selected={isLong} onPress={() => setIsLong(true)} />
            <Pill label="Short" selected={!isLong} onPress={() => setIsLong(false)} />
          </PillRow>
          <PillRow>
            {SIZES.map((n) => (
              <Pill key={n} label={`${money(n, { decimals: 0 })} × 2`} selected={n === usd} onPress={() => setUsd(n)} />
            ))}
          </PillRow>
          <Button
            label={`${isLong ? 'Long' : 'Short'} ${marketId.replace('-USD', '')}`}
            loading={busy}
            onPress={() => run(async () => resultLine(await gmx.open({ marketId, isLong, collateralUsd: usd, leverage: 2 })))}
            testID="hedge-open"
          />
        </View>
      )}
      {line ? <Text variant="footnote" color={colors.ink65} style={{ marginTop: space.s8 }}>{line}</Text> : null}
      {err ? <Text variant="footnote" color={colors.down} style={{ marginTop: space.s8 }}>{err}</Text> : null}
    </SheetCard>
  );
}

/** A rate already made positive by the caller, which says pay or earn in words. */
const rate = (pctPerHour: number) => `${percent(pctPerHour, 4).replace(/^\+/, '')}/h`;
const millions = (usd: number) => `${money(usd / 1e6, { decimals: 1 })}M`;

function MarketCard({ m }: { m: GmxMarket }) {
  const oi = m.openInterestUsd.long + m.openInterestUsd.short;
  const longShare = oi > 0 ? Math.round((m.openInterestUsd.long / oi) * 100) : null;
  return (
    <SheetCard bordered borderRadius={radius.panel} padding={space.s14}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text variant="rowPrimary">{m.name}</Text>
        <Text variant="rowPrimary">{m.markPrice === null ? '—' : money(m.markPrice)}</Text>
      </View>
      <Text variant="footnote" color={colors.ink55} style={{ marginTop: space.s8 }}>
        Funding: longs {m.fundingPctPerHour.long >= 0 ? 'pay' : 'earn'} {rate(Math.abs(m.fundingPctPerHour.long))}, shorts{' '}
        {m.fundingPctPerHour.short >= 0 ? 'pay' : 'earn'} {rate(Math.abs(m.fundingPctPerHour.short))}
      </Text>
      <Text variant="footnote" color={colors.ink55}>
        Open interest {millions(oi)}
        {longShare === null ? '' : ` · ${longShare}% long`}
      </Text>
    </SheetCard>
  );
}

function orderLine(o: GmxOrder): string {
  const what = `${o.kind === 'decrease' ? 'Close' : 'Open'} ${o.is_long ? 'long' : 'short'} ${money(Number(o.size_usd))}`;
  if (o.status === 'pending') return `${what} · waiting for the keeper`;
  if (o.status === 'executed') return `${what} · executed`;
  return `${what} · ${o.status}${o.reason ? `: ${o.reason}` : ''}`;
}

export default function Hedge() {
  const goBack = useGoBack();
  const markets = useAsync(() => gmx.markets(), []);
  const positions = useAsync(() => gmx.positions(), []);
  const orders = useAsync(() => gmx.orders(), []);
  const [closing, setClosing] = useState<string | null>(null);
  const [closeErr, setCloseErr] = useState<string | null>(null);
  const refresh = () => {
    positions.reload();
    orders.reload();
  };

  return (
    <Screen gutter="none">
      <View style={{ paddingHorizontal: space.gutter }}>
        <HeaderBar onBack={goBack} title={<Text variant="screenTitle">Hedge</Text>} />
        <Text variant="secondary" color={colors.ink55} style={{ marginTop: space.s6 }}>
          Perps on GMX. Positions are yours.
        </Text>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space.gutter, paddingTop: space.s14, paddingBottom: space.s30, gap: space.s10 }}
      >
        {HEDGES_HERE ? <HedgeControls onChange={refresh} /> : null}
        <Text variant="control" color={colors.ink55}>
          Your positions
        </Text>
        {positions.error ? (
          <Text variant="footnote" color={colors.ink55}>
            {apiProse(positions.error) ?? 'Positions could not be read.'}
          </Text>
        ) : positions.loading && !positions.data ? (
          <LoadingRows count={1} height={size.rowLg} />
        ) : (positions.data ?? []).length === 0 ? (
          <Text variant="footnote" color={colors.ink55}>
            No open positions.
          </Text>
        ) : (
          (positions.data ?? []).map((p, i) => (
            <SheetCard key={`${p.marketId}-${p.isLong}-${i}`} bordered borderRadius={radius.panel} padding={space.s14}>
              <Text variant="rowPrimary">
                {p.marketId ?? 'GMX'} {p.isLong ? 'long' : 'short'} {money(p.sizeUsd)}
              </Text>
              <Text variant="footnote" color={colors.ink55}>
                {p.entryPrice === null ? '' : `Entry ${money(p.entryPrice)} · `}
                {p.collateralAmount} {p.collateralSymbol ?? ''} collateral
              </Text>
              {HEDGES_HERE && p.marketId ? (
                <Button
                  label="Close"
                  variant="secondary"
                  loading={closing === `${p.marketId}-${p.isLong}`}
                  style={{ marginTop: space.s8 }}
                  onPress={async () => {
                    setClosing(`${p.marketId}-${p.isLong}`);
                    setCloseErr(null);
                    try {
                      await gmx.close({ marketId: p.marketId!, isLong: p.isLong });
                      refresh();
                    } catch (e) {
                      setCloseErr(apiProse(e) ?? (e instanceof Error ? e.message : 'The close did not go through.'));
                    } finally {
                      setClosing(null);
                    }
                  }}
                />
              ) : null}
            </SheetCard>
          ))
        )}

        {closeErr ? <Text variant="footnote" color={colors.down}>{closeErr}</Text> : null}
        {(orders.data ?? []).length > 0 ? (
          <>
            <Text variant="control" color={colors.ink55} style={{ marginTop: space.s10 }}>
              Orders
            </Text>
            {(orders.data ?? []).map((o) => (
              <Text key={o.key} variant="footnote" color={o.status === 'pending' ? colors.warn : colors.ink65}>
                {orderLine(o)}
              </Text>
            ))}
          </>
        ) : null}

        <Text variant="control" color={colors.ink55} style={{ marginTop: space.s10 }}>
          Markets
        </Text>
        {markets.error ? (
          <ErrorState error={markets.error} onRetry={markets.reload} />
        ) : markets.loading && !markets.data ? (
          <LoadingRows count={4} height={size.rowLg} />
        ) : (
          (markets.data ?? []).map((m) => <MarketCard key={m.id} m={m} />)
        )}
      </ScrollView>
    </Screen>
  );
}
