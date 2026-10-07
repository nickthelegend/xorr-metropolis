import { describe, expect, it } from 'vitest';
import { finalTimed, noSyncMethod } from './send.js';

const block = (number: bigint, hash: string) => ({ number, hash }) as never;

describe('finalTimed — the time until the fill’s block is final', () => {
  it('waits until finalized reaches the block, then checks it is the same block', async () => {
    let t = 1_000;
    let asked = 0;
    // finalized lags two blocks behind, as on Monad: 98, 99, then 100.
    const client = { getBlock: async () => block(98n + BigInt(Math.min(2, asked++)), '0xfill') };
    const ms = await finalTimed(client as never, { blockNumber: 100n, blockHash: '0xfill' }, 1_000, { pollMs: 1, now: () => (t += 200) });
    expect(asked).toBe(3);
    expect(ms).toBe(600);
  });

  it('a finalized head past the block is looked up at the block’s height', async () => {
    const client = { getBlock: async (q: { blockTag?: string; blockNumber?: bigint }) => (q.blockTag ? block(105n, '0xhead') : block(q.blockNumber!, '0xfill')) };
    expect(await finalTimed(client as never, { blockNumber: 100n, blockHash: '0xfill' }, 0, { now: () => 550 })).toBe(550);
  });

  it('a different block at that height means the receipt’s proposal lost: not final there', async () => {
    const client = { getBlock: async () => block(100n, '0xother') };
    expect(await finalTimed(client as never, { blockNumber: 100n, blockHash: '0xfill' }, 0, { now: () => 500 })).toBeUndefined();
  });

  it('gives up after its timeout', async () => {
    let t = 0;
    const client = { getBlock: async () => block(1n, '0x') };
    expect(await finalTimed(client as never, { blockNumber: 100n, blockHash: '0xfill' }, 0, { timeoutMs: 1_000, pollMs: 1, now: () => (t += 600) })).toBeUndefined();
  });

  it('on a fork, every block is final at once: the time is the lookup’s', async () => {
    const client = { getBlock: async () => block(100n, '0xfill') };
    expect(await finalTimed(client as never, { blockNumber: 100n, blockHash: '0xfill' }, 1_000, { now: () => 1_004 })).toBe(4);
  });
});

describe('noSyncMethod — a node without eth_sendRawTransactionSync, not a failed transaction', () => {
  it('knows the refusals', () => {
    expect(noSyncMethod({ name: 'MethodNotFoundRpcError' })).toBe(true);
    expect(noSyncMethod({ code: -32601 })).toBe(true);
    expect(noSyncMethod({ message: 'eth_sendRawTransactionSync: method not supported' })).toBe(true);
    expect(noSyncMethod({ name: 'X', cause: { name: 'MethodNotSupportedRpcError' } })).toBe(true);
  });
  it('a revert or a nonce error is the transaction’s own, and is not swallowed', () => {
    expect(noSyncMethod({ message: 'execution reverted: CapExceeded' })).toBe(false);
    expect(noSyncMethod({ message: 'nonce too low' })).toBe(false);
  });
});
