import { describe, expect, it } from 'vitest';
import { cadenceMs, confirmTimed, costUsd, speedReceipt, type Pulse } from './speed.js';

describe('cadenceMs — the block interval measured between two blocks', () => {
  it('a hundred blocks over thirty seconds is 300 ms', () => {
    expect(cadenceMs(1_791_300_030, 1_791_300_000, 100)).toBe(300);
  });
  it('refuses a span it cannot use', () => {
    expect(cadenceMs(100, 200, 100)).toBeNull();
    expect(cadenceMs(100, 100, 100)).toBeNull();
    expect(cadenceMs(200, 100, 0)).toBeNull();
  });
});

describe('costUsd — gas at a price, in dollars', () => {
  it('300,000 gas at 100 gwei and $0.03 a MON is $0.0009', () => {
    expect(costUsd(300_000n, 100_000_000_000n, 0.03)).toBeCloseTo(0.0009, 10);
  });
  it('the same gas at 2 gwei and $2,600 an ETH is $1.56', () => {
    expect(costUsd(300_000n, 2_000_000_000n, 2600)).toBeCloseTo(1.56, 10);
  });
  it('is absent without any of its inputs, never a guess', () => {
    expect(costUsd(null, 1n, 1)).toBeNull();
    expect(costUsd(1n, null, 1)).toBeNull();
    expect(costUsd(1n, 1n, null)).toBeNull();
    expect(costUsd(1n, 1n, 0)).toBeNull();
  });
});

describe('confirmTimed — the ms from broadcast to a readable receipt', () => {
  it('measures to the moment the receipt appears', async () => {
    let t = 1_000;
    let asked = 0;
    const client = { getTransactionReceipt: async () => (++asked >= 3 ? { status: 'success' } : Promise.reject(new Error('not yet'))) };
    const ms = await confirmTimed('0x' as `0x${string}`, 1_000, {
      client: client as never,
      now: () => (t += 150),
    });
    expect(asked).toBe(3);
    expect(ms).toBe(450);
  });
  it('gives up after its timeout and says nothing', async () => {
    let t = 0;
    const client = { getTransactionReceipt: async () => Promise.reject(new Error('never')) };
    const ms = await confirmTimed('0x' as `0x${string}`, 0, { client: client as never, timeoutMs: 1_000, now: () => (t += 600) });
    expect(ms).toBeUndefined();
  });
});

describe('speedReceipt — a fill priced at the pulse', () => {
  const pulse: Pulse = {
    at: '2026-10-07T00:00:00.000Z',
    monad: { block: '52000000', blockMs: 400, gasGwei: '102', monUsd: 0.03 },
    ethereum: { gasGwei: '2', ethUsd: 2600 },
  };
  const row = { signature: '0xabc', tx_ms: 312, tx_block: '110900000', tx_gas_used: '250000', tx_gas_limit: '325000', tx_gas_price: '100000000000' };
  it('prices Monad on the gas LIMIT and Ethereum on the gas used', () => {
    const r = speedReceipt(row, pulse, false);
    expect(r.confirmMs).toBe(312);
    expect(r.costUsd).toBeCloseTo(325_000 * 100e-9 * 0.03, 10);
    expect(r.pricedAt).toBe('paid');
    expect(r.ethereumUsd).toBeCloseTo(250_000 * 2e-9 * 2600, 10);
    expect(r.gasPriceGwei).toBe('100');
    expect(r.fork).toBe(false);
  });
  it('on a fork, Monad is priced at mainnet’s gas price, not the price the fork charged', () => {
    const r = speedReceipt(row, pulse, true, 1000);
    expect(r.pricedAt).toBe('mainnet');
    expect(r.monadGasGwei).toBe('102');
    expect(r.costUsd).toBeCloseTo(325_000 * 102e-9 * 0.03, 10);
    expect(r.chainBlockMs).toBe(1000);
  });
  it('a fill recorded before the receipt existed has no costs, not invented ones', () => {
    const r = speedReceipt({ ...row, tx_ms: null, tx_gas_used: null, tx_gas_limit: null, tx_gas_price: null }, pulse, false);
    expect(r.confirmMs).toBeNull();
    expect(r.costUsd).toBeNull();
    expect(r.ethereumUsd).toBeNull();
  });
  it('without Ethereum in the pulse there is no comparison', () => {
    expect(speedReceipt(row, { ...pulse, ethereum: null }, false).ethereumUsd).toBeNull();
  });
});
