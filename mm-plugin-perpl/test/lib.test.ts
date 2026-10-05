import { describe, expect, it } from 'vitest';
import { decodeFunctionData } from 'viem';
import { EXCHANGE_ABI, EXEC_WINDOW_BLOCKS, execOrderData, findMarket, liquidationPrice, NETWORKS, parseMarket, planOrder, toCns } from '../src/lib/perpl.js';
import { fundingOverWindow, priceMove, riskAlerts, type MarketRisk } from '../src/lib/risk.js';
import { fundingUsdPerHour, pnlAt } from '../src/lib/account.js';
import { selectedEvmAddress } from '../src/lib/host.js';

// Perpl testnet's MON market as its context described it on 2026-10-05.
const MON = parseMarket({
  id: 64,
  name: 'MON Perp',
  funding_interval_sec: 2580,
  config: { is_open: true, price_decimals: 5, size_decimals: 0, initial_margin: 300, maintenance_margin: 500 },
  state: { at: { t: 1791193800000 }, mrk: 3242, bid: 3240, ask: 3244, oi: 2_838_000 },
  funding: { rate: 30 },
});

describe('markets', () => {
  it('reads Perpl’s context in the market’s own decimals', () => {
    expect(MON).toMatchObject({ name: 'MON', mark: 0.03242, bid: 0.0324, ask: 0.03244, maxLeverage: 3, maintLeverage: 5, fundingPerInterval: 0.00003, open: true });
  });

  it('finds a market however a person types it', () => {
    expect(findMarket([MON], 'mon')?.id).toBe(64);
    expect(findMarket([MON], 'MON Perp')?.id).toBe(64);
    expect(findMarket([MON], '64')?.id).toBe(64);
    expect(findMarket([MON], 'BTC')).toBeUndefined();
  });
});

describe('an order', () => {
  it('is sized in dollars through the book top, an IOC with a 1% limit', () => {
    const plan = planOrder(MON, 'open_long', 50, 200);
    expect(plan.lots).toBe(1541); // floor(50 / 0.03244)
    expect(plan.limitPrice).toBe(0.03276); // 0.03244 × 1.01, floored to 5 decimals
    expect(plan.notionalUsd).toBeCloseTo(49.99, 2);
  });

  it('encodes the Exchange’s execOrder as Perpl reads it', () => {
    const plan = planOrder(MON, 'open_short', 50, 200);
    const { functionName, args } = decodeFunctionData({ abi: EXCHANGE_ABI, data: execOrderData(plan, 1000n, 7n) });
    expect(functionName).toBe('execOrder');
    expect(args[0]).toMatchObject({ orderDescId: 7n, perpId: 64n, orderType: 1, immediateOrCancel: true, leverageHdths: 200n, lastExecutionBlock: 1000n + EXEC_WINDOW_BLOCKS, pricePNS: 3207n });
  });

  it('refuses a size under one lot rather than sending nothing', () => {
    expect(() => planOrder(MON, 'open_long', 0.01, 200)).toThrow('less than one MON lot');
  });

  it('refuses a side with no quote', () => {
    expect(() => planOrder({ ...MON, ask: null }, 'open_long', 50, 200)).toThrow("no ask on Perpl's book");
  });
});

describe('liquidation and funding', () => {
  it('matches the desk proof: a $100 MON long at 2x, liquidated near $0.015', () => {
    // docs/evidence/prove-perpl-desk-testnet-2026-09-24.txt: 4166 MON at $0.024, 50.07532 margin → $0.014975.
    expect(liquidationPrice({ long: true, entry: 0.024, lots: 4166, deposit: 50.07532, maintLeverage: 5 })).toBeCloseTo(0.014975, 6);
  });

  it('charges a long when longs pay, pays a short', () => {
    expect(fundingUsdPerHour({ long: true, lots: 10_000 }, 0.025, 0.01)).toBeCloseTo(0.025);
    expect(fundingUsdPerHour({ long: false, lots: 10_000 }, 0.025, 0.01)).toBeCloseTo(-0.025);
    expect(fundingUsdPerHour({ long: true, lots: 1 }, null, 0.01)).toBeNull();
  });

  it('works out PnL at the mark for both sides', () => {
    expect(pnlAt({ long: true, lots: 1000, entry: 0.03 }, 0.033)).toBeCloseTo(3);
    expect(pnlAt({ long: false, lots: 1000, entry: 0.03 }, 0.033)).toBeCloseTo(-3);
  });

  it('turns AUSD into its 6 decimals', () => {
    expect(toCns(150)).toBe(150_000_000n);
  });
});

describe('risk', () => {
  it('sums what longs paid and annualises the average', () => {
    // 33 payments of 30 millionths a 2,580 s interval.
    const f = fundingOverWindow({ d: Array.from({ length: 33 }, (_, i) => ({ at: { t: i }, rate: 30 })) }, 2580);
    expect(f.longsPaidPct).toBeCloseTo(0.099);
    expect(f.aprPct).toBeCloseTo(36.67, 1);
    expect(fundingOverWindow({ d: [] }, 2580)).toEqual({ longsPaidPct: null, aprPct: null });
  });

  it('reads the price move from hourly candles', () => {
    const move = priceMove({ d: [{ t: 0, o: 3200, h: 3300, l: 3100, c: 3250, n: 5 }, { t: 1, o: 3250, h: 3400, l: 3200, c: 3360, n: 7 }] }, 5)!;
    expect(move.changePct).toBeCloseTo(5, 9);
    expect(move.trades).toBe(12);
  });

  it('says markets paying the same rate once, stale marks first', () => {
    const base: MarketRisk = { market: 'ETH', mark: 1, oiUsd: 1, spreadBps: 2, fundingNowPctPerHour: 0.0056, longsPaidPct: 0.08, aprPct: 30, priceChangePct: 0.5, trades: 1, staleSec: 3 };
    const alerts = riskAlerts([base, { ...base, market: 'SOL' }, { ...base, market: 'MON', fundingNowPctPerHour: 0.001, staleSec: 120, priceChangePct: -6.2 }], 24);
    expect(alerts.map((a) => a.text)).toEqual([
      "MON's mark is 120 s old: Perpl treats a price that old as stale.",
      'ETH, SOL: longs pay 49% a year at the current rate.',
      'MON fell 6.2% in 24h.',
    ]);
  });
});

describe('the wallet', () => {
  const a = { address: '0x1111111111111111111111111111111111111111', id: 'a' };
  const b = { address: '0x2222222222222222222222222222222222222222', name: 'trader' };

  it('uses the wallet mm has selected', () => {
    expect(selectedEvmAddress({ byokWallets: [a], remoteWallets: [b], selectedWallet: { ref: { name: 'trader' } } })).toBe(b.address);
  });

  it('falls back to the first EVM wallet, and says when there is none', () => {
    expect(selectedEvmAddress({ byokWallets: [{ address: 'So1anaAddress' }, a], remoteWallets: [] })).toBe(a.address);
    expect(() => selectedEvmAddress({ byokWallets: [], remoteWallets: [] })).toThrow('no EVM address');
  });
});

describe('networks', () => {
  it('defaults to Perpl testnet and knows both chains', () => {
    expect(NETWORKS.testnet.chainId).toBe(10143);
    expect(NETWORKS.mainnet.chainId).toBe(143);
  });
});
