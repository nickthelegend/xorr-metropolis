/**
 * The Robinhood Chain side of the registry (2026-09-23): the catalog narrowed to what has code on this node, the
 * settlement role spelled `USDC` resolving to USDG, and a symbol that cannot be re-pointed once registered.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogEntry } from '../robinhood/catalog.js';

vi.mock('../db/index.js', () => ({ query: vi.fn(async () => []) }));

const entry = (symbol: string, address: string, pool: string): CatalogEntry => ({
  symbol,
  name: `${symbol} • Robinhood Token`,
  address: address as `0x${string}`,
  multiplier: '1',
  multiplierMismatch: false,
  pool: { address: pool as `0x${string}`, fee: 500, usdg: 1_000_000 },
  tradingCapabilities: {
    market: { whole: 'TRADING_STATUS_TRADABLE', fractional: 'TRADING_STATUS_TRADABLE' },
    extended: { whole: 'TRADING_STATUS_TRADABLE', fractional: 'TRADING_STATUS_TRADABLE' },
    overnight: { whole: 'TRADING_STATUS_TRADABLE', fractional: 'TRADING_STATUS_TRADABLE' },
  },
  corporateActions: [],
});

async function load(chain: string) {
  vi.resetModules();
  vi.stubEnv('XORR_CHAIN', chain);
  return { rh: await import('./rh-stocks.js'), tokens: await import('./tokens.js') };
}

afterEach(() => vi.unstubAllEnvs());

describe('the Stock Tokens that trade on this node', () => {
  it('are the catalog entries whose token AND pool both have code here', async () => {
    const { rh } = await load('robinhood-fork');
    const catalog = [
      entry('NVDA', '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', '0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3'),
      // Token present, pool not captured by the snapshot: a buy would revert, so not offered.
      entry('SPCX', '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa', '0xc61284332117c3FB23A2A56cceFFD07F7aF60029'),
      // Neither present.
      entry('QQQ', '0xD5f3879160bc7c32ebb4dC785F8a4F505888de68', '0xD60A5d14dB690B7Afad71F76B108071D7175597d'),
    ];
    const present = new Set(
      ['0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', '0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3', '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa'].map((a) =>
        a.toLowerCase(),
      ),
    );
    expect(rh.presentOnNode(catalog, present).map((s) => s.symbol)).toEqual(['NVDA']);
  });

  it('are none off Robinhood Chain, and none on its testnet', async () => {
    expect(await (await load('arbitrum-fork')).rh.robinhoodStocks()).toEqual([]);
  });
});

describe('the registry on Robinhood Chain', () => {
  it('settles in USDG, and resolves the settlement role spelled USDC to it', async () => {
    const { tokens } = await load('robinhood-fork');
    expect(tokens.SETTLEMENT_SYMBOL).toBe('USDG');
    expect(tokens.TOKENS.USDG).toMatchObject({ address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', decimals: 6, kind: 'cash' });
    expect(tokens.canonicalSymbol('usdc')).toBe('USDG');
    expect(tokens.isSettlement('USDC')).toBe(true);
    // WETH is held and shown; the product does not route it.
    expect(tokens.isRoutable('WETH')).toBe(false);
  });

  it('takes a Stock Token at runtime and refuses to re-point a symbol at another address', async () => {
    const { tokens } = await load('robinhood-fork');
    tokens.registerToken('NVDA', {
      address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC',
      decimals: 18,
      toSettlement: [{ via: 'USDG', fee: 500 }],
      kind: 'stock',
    });
    expect(tokens.canonicalSymbol('nvda')).toBe('NVDA');
    expect(tokens.isRoutable('NVDA')).toBe(true);
    expect(() =>
      tokens.registerToken('NVDA', { address: '0x0000000000000000000000000000000000000001', decimals: 18, toSettlement: [], kind: 'stock' }),
    ).toThrow('already registered');
  });

  it('is USDC-settled with no Stock Tokens on Arbitrum One, where USDG is held but not routed', async () => {
    const { tokens } = await load('arbitrum-fork');
    expect(tokens.SETTLEMENT_SYMBOL).toBe('USDC');
    expect(Object.keys(tokens.TOKENS).sort()).toEqual(['ARB', 'ETH', 'GMX', 'USDC', 'USDG', 'WBTC', 'WETH']);
    expect(tokens.isRoutable('USDG')).toBe(false);
    expect(tokens.canonicalSymbol('usdc')).toBe('USDC');
  });
});
