import { describe, expect, it } from 'vitest';
import feeds from './fixtures/feeds-robinhood-mainnet.json';
import { deviationBps, feedDirectorySchema, isStale, mapFeedsBySymbol, pickFundedPool, type UsdgPool } from './chain.js';

describe('Chainlink feed directory (58 feeds captured 2026-09-23)', () => {
  const map = mapFeedsBySymbol(feedDirectorySchema.parse(feeds));

  it('maps the four headline tokens to the verified proxies', () => {
    expect(map.get('TSLA')?.proxy).toBe('0x4A1166a659A55625345e9515b32adECea5547C38');
    expect(map.get('NVDA')?.proxy).toBe('0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15');
    expect(map.get('AAPL')?.proxy).toBe('0x6B22A786bAa607d76728168703a39Ea9C99f2cD0');
    expect(map.get('SPY')?.proxy).toBe('0x319724394D3A0e3669269846abE664Cd621f9f6A');
    expect(map.get('NVDA')).toMatchObject({ heartbeatSec: 86_400, decimals: 8 });
  });

  it('reads both "Robinhood X / USD" and "Robinhood X-USD" names', () => {
    expect(map.get('DELL')?.proxy).toBe('0x1C6c8cADBe02E19129c39dDB92281cE4c0bf206b');
    expect(map.get('SGOV')).toBeDefined();
  });

  it('ignores crypto feeds, including a bare "GLD / USD" that is not the ETF', () => {
    expect(map.has('ETH')).toBe(false);
    expect(map.has('USDG')).toBe(false);
    expect(map.has('GLD')).toBe(false);
    for (const f of map.values()) expect(f.name.startsWith('Robinhood')).toBe(true);
  });
});

describe('pickFundedPool', () => {
  const p = (fee: number, usdg: number): UsdgPool => ({
    pool: `0x${fee.toString(16).padStart(40, '0')}`,
    fee,
    usdg,
    usdgBalance: BigInt(Math.round(usdg * 1e6)),
  });

  it('takes the tier holding the most USDG (NVDA on 2026-09-23: 0.05% held ~4.59M)', () => {
    const pools = [p(100, 82.91), p(500, 4_594_613.25), p(3000, 27_176.49), p(10000, 0.000006)];
    expect(pickFundedPool(pools, 1_000)?.fee).toBe(500);
  });

  it('returns null when no pool holds the minimum', () => {
    expect(pickFundedPool([p(3000, 999)], 1_000)).toBeNull();
    expect(pickFundedPool([], 1_000)).toBeNull();
  });
});

describe('maths', () => {
  it('deviation in bps is symmetric in direction and relative to the reference', () => {
    expect(deviationBps(101.5, 100)).toBeCloseTo(150, 9);
    expect(deviationBps(98.5, 100)).toBeCloseTo(150, 9);
    // Real 2026-09-23 NVDA numbers: 100 USDG → 0.436820339972901721 tokens vs Chainlink 229.02739517.
    expect(deviationBps(100 / 0.436820339972901721, 229.02739517)).toBeLessThan(5);
  });

  it('staleness is age beyond the max age', () => {
    const now = 1_790_089_676_000;
    expect(isStale(1_790_089_676 - 86_400, now, 86_400)).toBe(false);
    expect(isStale(1_790_089_676 - 86_401, now, 86_400)).toBe(true);
  });
});
