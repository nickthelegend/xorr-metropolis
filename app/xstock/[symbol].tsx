/**
 * A Stock Token's ticket: what the order costs, and whether it can trade now, before anyone agrees to it.
 *
 * Between a size and a button is everything that decides what the person ends up holding — the venue's price impact at
 * this size, the tolerance the swap would be sent with, the route — so every figure here comes from a real quote for the
 * real size, re-asked as the size changes and debounced so the venue is not asked on every keypress. A figure the venue
 * did not report says "Not reported"; it never becomes a zero.
 *
 * Above it, what the executor knows about the token right now (PLAN.md P4.4): the trading session, a halt, the
 * Chainlink print and the pool's own price with the gap between them, and the ERC-8056 multiplier. Each is drawn only
 * when the executor reported it. Nothing here is the issuer's attestation or a holder gate: those were Backed's, on
 * Solana, and this build has no such data to show.
 *
 * Placing is the order screen's job. A Stock Token is bought and sold through the same `/orders` and `/positions/close`
 * path as every other token — the delegation's `spend`/`closePosition` — so once the cost is on screen this hands the
 * reviewed order (side and size, kept in the store both screens share) to `/order/[symbol]`, which carries the
 * idempotency key, the policy's refusals and the fill receipt. One way to place an order, not two.
 */
import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useGoBack } from '@/nav/useGoBack';
import {
  AssetMark,
  Button,
  CloseButton,
  FailureNote,
  Fill,
  Keypad,
  Pill,
  Price,
  Screen,
  Segmented,
  SignInButton,
  Text,
  colors,
  money,
  price as fmtPrice,
  quantity,
  size,
  space,
} from '@/ui';
import { useAsync } from '@/data/useAsync';
import { useLogo } from '@/data/useLogos';
import { assetGradient } from '@/design/gradients';
import { useDebounced } from '@/data/useDebounced';
import { useStore } from '@/state/store';
import { system } from '@/data/system';
import { useSignedOut } from '@/auth/useSignedOut';
import { breakdownRows, worstCase } from '@/markets/breakdown';
import { isTradable, stockName } from '@/markets/catalog';
import { StockStatus, stockBlock } from '@/ui/StockStatus';
import { STOCK_TOKEN_TICKET_LINE } from '@/legal/jurisdiction';

const SIDES = [
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
] as const;

const QUICK = ['$100', '$250', '$500'] as const;

const FORMAT = { money, quantity, price: fmtPrice };

export default function StockTicket() {
  const { symbol = '' } = useLocalSearchParams<{ symbol: string }>();
  const router = useRouter();
  const logo = useLogo(symbol || undefined);
  const goBack = useGoBack();
  const signedOut = useSignedOut();

  // The same store the order ticket types into, so moving between the two keeps the amount.
  const orderAmt = useStore((s) => s.orderAmt);
  const pressKey = useStore((s) => s.pressKey);
  const setOrderAmt = useStore((s) => s.setOrderAmt);
  const side = useStore((s) => s.side);
  const setSide = useStore((s) => s.setSide);

  const amount = parseFloat(orderAmt || '0') || 0;

  /** Every Stock Token this build lists: nothing is asked about a symbol until the catalogue says it exists. */
  const catalog = useAsync(() => system.xstocks(), []);
  const row = catalog.data?.rows.find((r) => r.symbol === symbol);
  const listed: boolean | undefined = catalog.data ? !!row : undefined;
  // Tradable is a fact about this chain: what the executor can settle here (`/market/tradable`).
  const tradable = useAsync(() => system.tradable(), []);
  const canSettle = !!tradable.data?.some((t) => t.symbol === symbol);
  /** Why this token cannot be ordered right now, from what the executor reported; undefined when nothing stops it. */
  const blocked = row ? stockBlock(row) : undefined;

  /*
   * Debounced, and not as a nicety: every keypress would otherwise be a real quote at the venue, and a swap an order
   * needed once queued behind the quotes drawn for its own decoration.
   */
  const quoted = useDebounced(amount);
  // A quote is one person's order at one size, behind a session: signed out, nothing is asked.
  const quote = useAsync(
    () =>
      quoted > 0 && listed && !signedOut ? system.xstockQuote({ symbol, side, usd: quoted }) : Promise.resolve(null),
    [symbol, side, quoted, listed, signedOut],
  );
  const rows = useMemo(() => (quote.data ? breakdownRows(quote.data, FORMAT) : []), [quote.data]);

  if (listed === false) {
    return (
      <Screen light gutter="sheet">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="sheetTitle" color={colors.sheet.ink}>
            Not listed
          </Text>
          <CloseButton onPress={() => goBack()} light />
        </View>
        <Fill style={{ justifyContent: 'center', gap: space.s12 }}>
          <Text variant="body" color={colors.sheet.muted} align="center">
            {`There is no Stock Token called ${symbol} here.`}
          </Text>
          <Button label="See the stocks" onPress={() => router.replace('/xstocks')} testID="xstock-not-listed" />
        </Fill>
      </Screen>
    );
  }

  return (
    <Screen light gutter="sheet">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s10, flexShrink: 1 }}>
          <AssetMark gradient={assetGradient(symbol)} {...logo} size={30} />
          <View style={{ flexShrink: 1 }}>
            <Text variant="sheetTitle" color={colors.sheet.ink}>
              {symbol}
            </Text>
            {row ? (
              <Text variant="footnote" color={colors.sheet.muted} numberOfLines={1}>
                {stockName(row.name)}
              </Text>
            ) : null}
          </View>
        </View>
        <CloseButton onPress={() => goBack()} light />
      </View>

      {row ? <StockStatus row={row} light style={{ marginTop: space.s10 }} testID="xstock-status" /> : null}

      <Segmented
        options={SIDES}
        value={side}
        onChange={setSide}
        light
        height={size.segThumb}
        style={{ marginTop: space.s16 }}
      />

      <View style={{ alignItems: 'center', marginTop: space.s20, gap: space.s6 }}>
        {/* Being typed, so never masked: an order its author cannot read is not private, it is unusable. */}
        <Price variant="heroAmount" color={colors.sheet.ink} figure="input">
          ${orderAmt}
        </Price>
        <Text variant="body" color={colors.sheet.muted}>
          {quote.data ? worstCase(quote.data, FORMAT) : `${side === 'buy' ? 'Buying' : 'Selling'} ${symbol}`}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: space.s8, marginTop: space.s16, justifyContent: 'center' }}>
        {QUICK.map((q) => (
          <Pill key={q} label={q} light onPress={() => setOrderAmt(q.slice(1))} />
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingVertical: space.s12 }}
        style={{ flex: 1, marginTop: space.s12 }}
      >
        {amount <= 0 ? (
          <Text variant="secondary" color={colors.sheet.muted} align="center" style={{ paddingVertical: space.s20 }}>
            Enter an amount to see what it costs.
          </Text>
        ) : signedOut ? (
          <Text variant="secondary" color={colors.sheet.muted} align="center" style={{ paddingVertical: space.s20 }}>
            Sign in to see what it costs.
          </Text>
        ) : quote.error ? (
          // No quote is a real answer; a breakdown of zeroes in its place would read as a free trade.
          <FailureNote error={quote.error} light style={{ marginTop: space.s10 }} />
        ) : quote.loading || !quote.data ? (
          <Text variant="secondary" color={colors.sheet.muted} align="center" style={{ paddingVertical: space.s20 }}>
            Asking the venue…
          </Text>
        ) : (
          rows.map((r) => (
            <View
              key={r.label}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                paddingVertical: space.s10,
                gap: space.s12,
              }}
            >
              <Text variant="secondary" color={colors.sheet.muted}>
                {r.label}
              </Text>
              <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
                {/* Market figures, not this person's money: they stay legible while balances are hidden. */}
                <Price variant="secondary" color={r.cost ? colors.down : colors.sheet.ink} figure="market" numberOfLines={1}>
                  {r.value}
                </Price>
                {r.note ? (
                  <Text variant="footnote" color={colors.sheet.muted} align="right" style={{ marginTop: space.s2 }} figure="market">
                    {r.note}
                  </Text>
                ) : null}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Keypad light onPress={pressKey} />

      <View style={{ paddingTop: space.s12, gap: space.s8 }}>
        {tradable.data && !canSettle ? (
          <Text variant="footnote" color={colors.sheet.muted} align="center">
            {`${symbol} cannot settle on this network yet.`}
          </Text>
        ) : null}
        <Text variant="footnote" color={colors.sheet.muted} align="center" testID="xstock-jurisdiction">
          {STOCK_TOKEN_TICKET_LINE}
        </Text>
        {signedOut ? (
          <SignInButton label={side === 'buy' ? 'Sign in to buy' : 'Sign in to sell'} />
        ) : (
          <Button
            label={
              amount > 0
                ? `Review ${side === 'sell' ? 'sale' : 'order'} · ${money(amount)} of ${symbol}`
                : 'Enter an amount'
            }
            disabled={!(amount > 0) || !symbol || !row || !isTradable(row) || !!blocked || !canSettle}
            onPress={() => router.push(`/order/${symbol}?side=${side}` as never)}
            testID="xstock-review"
          />
        )}
      </View>
    </Screen>
  );
}
