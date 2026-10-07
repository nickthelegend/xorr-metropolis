/**
 * On Monad the delegate's sends go out signed here, through `broadcast` (MONAD-TECH item 2), still recorded before they
 * are signed; a wallet that does not sign locally keeps the plain `writeContract`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, type Address, type Hex } from 'viem';

const h = vi.hoisted(() => {
  process.env.DELEGATION_ADDRESS = '0x6c5528Fd8E74a047A85bAb413856A9239E73540e';
  return { events: [] as string[], wallet: {} as Record<string, unknown>, broadcast: vi.fn(), write: vi.fn() };
});

vi.mock('./client.js', () => ({
  publicClient: {
    simulateContract: async (call: unknown) => {
      h.events.push('simulate');
      return { request: call };
    },
    estimateContractGas: async () => 200_000n,
  },
  get walletClient() {
    return h.wallet;
  },
  delegateAccount: { address: '0xC38f38f45463f77bD823FebE16b15714Eb98c8A5' },
}));
vi.mock('./chains.js', async (orig) => ({ ...(await orig<typeof import('./chains.js')>()), IS_MONAD: true }));
vi.mock('./send.js', () => ({ broadcast: h.broadcast }));

const { spendAsDelegate } = await import('./delegation.js');
const { DELEGATION_ABI } = await import('./delegation.js');
const { withRequestScope } = await import('../http/request-id.js');

const OWNER: Address = '0x95A0b368588713011a15f4b1041423f31B08e615';
const WMON: Address = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';
const spend = () => spendAsDelegate({ owner: OWNER, venue: OWNER, usd: 20, data: '0x12' as Hex, tokenOut: WMON, minOut: 1n });

beforeEach(() => {
  h.events.length = 0;
  h.broadcast.mockReset();
  h.broadcast.mockImplementation(async () => {
    h.events.push('broadcast');
    return { hash: '0xsynced', sentAt: 0, sync: null };
  });
  h.write.mockReset();
  h.write.mockImplementation(async () => {
    h.events.push('write');
    return '0xwritten';
  });
});

describe('the delegate’s send on Monad', () => {
  it('a locally signing wallet sends through broadcast, with the encoded call, the gas and the sync send', async () => {
    h.wallet = { account: { type: 'local', address: OWNER }, writeContract: h.write };
    const out = await withRequestScope(async (scope) => {
      scope.beforeFirstBroadcast = async () => {
        h.events.push('recorded');
      };
      return spend();
    });
    expect(out).toBe('0xsynced');
    expect(h.events).toEqual(['simulate', 'recorded', 'broadcast']);
    const [wallet, req, opts] = h.broadcast.mock.calls[0]!;
    expect(wallet).toBe(h.wallet);
    expect(opts).toEqual({ useSync: true });
    expect(req.to).toBe(process.env.DELEGATION_ADDRESS);
    expect(typeof req.gas).toBe('bigint');
    expect(decodeFunctionData({ abi: DELEGATION_ABI, data: req.data }).functionName).toBe('spend');
  });

  it('a wallet that does not sign locally keeps writeContract', async () => {
    h.wallet = { writeContract: h.write };
    expect(await spend()).toBe('0xwritten');
    expect(h.broadcast).not.toHaveBeenCalled();
  });
});
