import { describe, expect, it } from 'vitest';
import assetsFixture from './fixtures/assets.json';
import corpFixture from './fixtures/corporate-actions.json';
import feeds from './fixtures/feeds-robinhood-mainnet.json';
import { assetsResponseSchema, corporateActionsResponseSchema } from './api.js';
import { buildCatalog } from './catalog.js';
import { feedDirectorySchema, mapFeedsBySymbol, type UsdgPool } from './chain.js';

const assets = assetsResponseSchema.parse(assetsFixture).assets;
const corporateActions = corporateActionsResponseSchema.parse(corpFixture).corpActions;
const feedMap = mapFeedsBySymbol(feedDirectorySchema.parse(feeds));

const pool = (addr: string, fee: number, usdg: number): UsdgPool => ({
  pool: addr as `0x${string}`,
  fee,
  usdg,
  usdgBalance: BigInt(Math.round(usdg * 1e6)),
});

// Pool balances as read on 2026-09-23; CRM is given no pool.
const pools = new Map<string, UsdgPool[]>([
  ['0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', [pool('0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3', 500, 4_594_613), pool('0xB944cec30Bd4175855215D767ADC81F39e5f7E2B', 3000, 27_176)]],
  ['0x322f0929c4625ed5bad873c95208d54e1c003b2d', [pool('0x1111111111111111111111111111111111111111', 3000, 484_208)]],
  ['0xaf3d76f1834a1d425780943c99ea8a608f8a93f9', [pool('0x2222222222222222222222222222222222222222', 500, 325_111)]],
  ['0x117cc2133c37b721f49de2a7a74833232b3b4c0c', [pool('0x3333333333333333333333333333333333333333', 500, 330_425)]],
  ['0x9e7abd3c9139d14e4c86dce0e455aab7a0c2fb3e', [pool('0x4444444444444444444444444444444444444444', 3000, 19_733)]],
  ['0x9651342cea770ae9a2969ba2a52611523146aef9', [pool('0x5555555555555555555555555555555555555555', 10000, 500)]], // CCL: below the 1,000 USDG floor
]);

describe('buildCatalog', () => {
  const multipliers = new Map<string, bigint | undefined>([
    ['0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', 1_000775159164630595n],
    ['0x117cc2133c37b721f49de2a7a74833232b3b4c0c', 1_100000000000000000n], // deliberately off
  ]);
  const catalog = buildCatalog({ assets, pools, feeds: feedMap, multipliers, corporateActions, minPoolUsdg: 1_000 });

  it('keeps only ACTIVE assets on 4663 with a funded USDG pool, deepest first', () => {
    expect(catalog.map((e) => e.symbol)).toEqual(['NVDA', 'TSLA', 'SPY', 'AAPL', 'WYFI']);
  });

  it('carries the pool, the feed and both multipliers', () => {
    const nvda = catalog[0]!;
    expect(nvda).toMatchObject({
      address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC',
      multiplier: '1.000775159164630595',
      onchainMultiplier: 1_000775159164630595n,
      multiplierMismatch: false,
      chainlinkFeed: '0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15',
      pool: { address: '0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3', fee: 500 },
    });
    expect(catalog.find((e) => e.symbol === 'SPY')?.multiplierMismatch).toBe(true);
    expect(catalog.find((e) => e.symbol === 'WYFI')?.chainlinkFeed).toBeUndefined();
  });

  it('drops an asset that is not ACTIVE', () => {
    const halted = assets.map((a) => (a.tokenSymbol === 'TSLA' ? { ...a, status: 'ASSET_STATUS_INACTIVE' } : a));
    expect(buildCatalog({ assets: halted, pools, feeds: feedMap, multipliers, minPoolUsdg: 1_000 }).map((e) => e.symbol)).not.toContain('TSLA');
  });

  it('adds a pendingMultiplier notice when one is scheduled', () => {
    const withPending = assets.map((a) =>
      a.tokenSymbol === 'AAPL' ? { ...a, pendingMultiplier: '4.002264320244369744', pendingMultiplierEffectiveTime: '2026-10-01T13:30:00Z' } : a,
    );
    const aapl = buildCatalog({ assets: withPending, pools, feeds: feedMap, multipliers, minPoolUsdg: 1_000 }).find((e) => e.symbol === 'AAPL')!;
    expect(aapl.pendingMultiplier?.notice).toBe(
      'AAPL multiplier changes 1.000566080061092436 → 4.002264320244369744 at 2026-10-01T13:30:00Z (corporate action; each token will represent a different number of shares).',
    );
  });
});
