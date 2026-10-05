/**
 * The agent wallet's own Perpl account, read from the Exchange now: its balance, and each open position with what it
 * stands to lose — distance to liquidation, and what it pays in funding an hour at the current rate.
 */
import type { Address, PublicClient } from 'viem';
import { EXCHANGE_ABI, fundingPctPerHour, liquidationPrice, type Market, type PerplNet } from './perpl.js';

export type Position = {
  market: string;
  perpId: number;
  long: boolean;
  lots: number;
  entry: number;
  mark: number | null;
  /** Margin on the position, AUSD. */
  deposit: number;
  /** At the mark, worked out from entry and size. */
  pnlUsd: number | null;
  liquidation: number | null;
  /** How far the mark is from liquidation, as a fraction of the mark. */
  liqDistance: number | null;
  /** Positive: it pays; negative: it is paid. */
  fundingUsdPerHour: number | null;
};

export type Account = { accountId: bigint; balance: number; locked: number; positions: Position[] };

/** Unrealised profit at the mark, in dollars. */
export const pnlAt = (p: { long: boolean; lots: number; entry: number }, mark: number) => (mark - p.entry) * p.lots * (p.long ? 1 : -1);

/** What a position pays in funding an hour now: positive rate, longs pay. */
export function fundingUsdPerHour(p: { long: boolean; lots: number }, mark: number | null, ratePctPerHour: number | null): number | null {
  if (mark === null || ratePctPerHour === null) return null;
  return ((p.long ? ratePctPerHour : -ratePctPerHour) / 100) * p.lots * mark;
}

/** The account at `owner`, or null when the wallet has none on this Perpl yet. */
export async function readAccount(client: PublicClient, net: PerplNet, owner: Address, markets: readonly Market[]): Promise<Account | null> {
  const info = await client.readContract({ address: net.exchange, abi: EXCHANGE_ABI, functionName: 'getAccountByAddr', args: [owner] });
  if (info.accountId === 0n) return null;
  const open = markets.filter((m) => m.open);
  const reads = await Promise.all(
    open.map((m) => client.readContract({ address: net.exchange, abi: EXCHANGE_ABI, functionName: 'getPosition', args: [BigInt(m.id), info.accountId] })),
  );
  const positions: Position[] = [];
  reads.forEach(([pos, markPNS], i) => {
    if (pos.lotLNS === 0n) return;
    const m = open[i]!;
    const lots = Number(pos.lotLNS) / 10 ** m.lotDecimals;
    const entry = Number(pos.pricePNS) / 10 ** m.priceDecimals;
    const mark = markPNS > 0n ? Number(markPNS) / 10 ** m.priceDecimals : m.mark;
    const deposit = Number(pos.depositCNS) / 1e6;
    const long = pos.positionType === 0;
    const liquidation = liquidationPrice({ long, entry, lots, deposit, maintLeverage: m.maintLeverage });
    positions.push({
      market: m.name,
      perpId: m.id,
      long,
      lots,
      entry,
      mark,
      deposit,
      pnlUsd: mark !== null ? pnlAt({ long, lots, entry }, mark) : null,
      liquidation,
      liqDistance: liquidation !== null && mark ? Math.abs(mark - liquidation) / mark : null,
      fundingUsdPerHour: fundingUsdPerHour({ long, lots }, mark, fundingPctPerHour(m)),
    });
  });
  return { accountId: info.accountId, balance: Number(info.balanceCNS) / 1e6, locked: Number(info.lockedBalanceCNS) / 1e6, positions };
}
