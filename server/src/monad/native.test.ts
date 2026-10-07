import { describe, expect, it, vi } from 'vitest';

vi.mock('../evm/client.js', async (orig) => ({ ...(await orig<typeof import('../evm/client.js')>()), publicClient: {} }));
vi.mock('../evm/chains.js', async (orig) => ({ ...(await orig<typeof import('../evm/chains.js')>()), CHAIN_KEY: 'monad-fork' }));
const { CANONICAL, p256Input, p256Verify, txpoolStatus } = await import('./native.js');

describe('the P256VERIFY input', () => {
  it('is hash ‖ r ‖ s ‖ qx ‖ qy, 32 bytes each', () => {
    const input = p256Input(`0x${'11'.repeat(32)}`, 2n, 3n, 4n, 5n);
    expect(input.length).toBe(2 + 320);
    expect(input.slice(66, 130)).toBe(`${'0'.repeat(63)}2`);
    expect(input.slice(258)).toBe(`${'0'.repeat(63)}5`);
  });
  it('is valid only when the precompile answers 1; empty is invalid', async () => {
    expect(await p256Verify({ call: async () => ({ data: `0x${'0'.repeat(63)}1` }) } as never, '0x')).toBe(true);
    expect(await p256Verify({ call: async () => ({ data: '0x' }) } as never, '0x')).toBe(false);
    expect(await p256Verify({ call: async () => ({ data: undefined }) } as never, '0x')).toBe(false);
  });
});

describe('txpool status', () => {
  it('reads Monad’s {status, reason}', async () => {
    const client = { request: async () => ({ status: 'pending', reason: null }) };
    expect(await txpoolStatus(client as never, '0xab')).toEqual({ ok: true, status: 'pending', reason: null });
  });
  it('says so when the node has no such method (anvil)', async () => {
    const client = { request: async () => Promise.reject(new Error('Method not found')) };
    expect(await txpoolStatus(client as never, '0xab')).toEqual({ ok: false, error: 'Method not found' });
  });
});

describe('the canonical contracts', () => {
  it('names a use for each, and says plainly which xorr does not use', () => {
    for (const c of CANONICAL) expect(c.use.length).toBeGreaterThan(20);
    expect(CANONICAL.filter((c) => !c.used).every((c) => c.use.startsWith('Not used'))).toBe(true);
    expect(CANONICAL.find((c) => c.name === 'WMON')!.address).toBe('0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A');
  });
});
