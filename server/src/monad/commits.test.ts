import { describe, expect, it } from 'vitest';
import { CommitStream, CommitTracker, type SocketLike } from './commits.js';

const head = (number: number, blockId: string, commitState: string, extra: Record<string, unknown> = {}) => ({
  number: `0x${number.toString(16)}`,
  blockId,
  commitState,
  hash: `0x${blockId}`,
  gasUsed: '0x5208',
  ...extra,
});

describe('CommitTracker — the pipeline from monadNewHeads', () => {
  it('times each state from the Proposed message (as measured on mainnet, 7 Oct: 141 / 422 / 1,337 ms)', () => {
    const t = new CommitTracker();
    t.observe(head(111382128, 'aa', 'Proposed'), 1_000);
    t.observe(head(111382128, 'aa', 'Voted'), 1_141);
    t.observe(head(111382128, 'aa', 'Finalized'), 1_422);
    t.observe(head(111382128, 'aa', 'Verified'), 2_337);
    expect(t.recent()).toEqual([
      { number: 111382128, blockId: 'aa', hash: '0xaa', gasUsed: 21000, state: 'Verified', ms: { Voted: 141, Finalized: 422, Verified: 1337 } },
    ]);
  });

  it('a block that skips Voted goes straight to Finalized', () => {
    const t = new CommitTracker();
    t.observe(head(5, 'a', 'Proposed'), 0);
    t.observe(head(5, 'a', 'Finalized'), 480);
    expect(t.recent()[0]!.ms).toEqual({ Voted: null, Finalized: 480, Verified: null });
    expect(t.recent()[0]!.state).toBe('Finalized');
  });

  it('when a height finalizes, every other proposal at that height is dropped — the stream never says it died', () => {
    const t = new CommitTracker();
    t.observe(head(7, 'x', 'Proposed'), 0);
    t.observe(head(7, 'y', 'Proposed'), 10);
    expect(t.recent().map((b) => b.blockId)).toEqual(['x', 'y']);
    t.observe(head(7, 'y', 'Finalized'), 500);
    expect(t.recent().map((b) => b.blockId)).toEqual(['y']);
  });

  it('a block first seen mid-pipeline is shown, but never averaged: it has no start', () => {
    const t = new CommitTracker();
    t.observe(head(9, 'late', 'Verified'), 0);
    expect(t.recent()[0]!.ms).toBeNull();
    expect(t.stats()).toEqual({ samples: 0, votedMs: null, finalizedMs: null, verifiedMs: null });
  });

  it('a state arriving twice keeps its first time, and a later state never moves a block backwards', () => {
    const t = new CommitTracker();
    t.observe(head(3, 'a', 'Proposed'), 0);
    t.observe(head(3, 'a', 'Finalized'), 500);
    t.observe(head(3, 'a', 'Voted'), 600);
    t.observe(head(3, 'a', 'Finalized'), 900);
    expect(t.recent()[0]!.state).toBe('Finalized');
    expect(t.recent()[0]!.ms!.Finalized).toBe(500);
  });

  it('medians over the blocks seen from their proposal', () => {
    const t = new CommitTracker();
    [
      [1, 300, 500],
      [2, 200, 450],
      [3, 400, 600],
    ].forEach(([n, v, f]) => {
      t.observe(head(n!, `b${n}`, 'Proposed'), 0);
      t.observe(head(n!, `b${n}`, 'Voted'), v!);
      t.observe(head(n!, `b${n}`, 'Finalized'), f!);
    });
    expect(t.stats()).toEqual({ samples: 3, votedMs: 300, finalizedMs: 500, verifiedMs: null });
  });

  it('ignores what is not a commit-state header', () => {
    const t = new CommitTracker();
    expect(t.observe(null, 0)).toBe(false);
    expect(t.observe({ number: '0x1', blockId: 'a', commitState: 'Mined' }, 0)).toBe(false);
    expect(t.observe({ number: '0x1', commitState: 'Proposed' }, 0)).toBe(false);
    expect(t.recent()).toEqual([]);
  });

  it('keeps a bounded window of heights', () => {
    const t = new CommitTracker();
    for (let n = 1; n <= 200; n++) t.observe(head(n, `b${n}`, 'Proposed'), n);
    expect(t.recent(1000).length).toBe(60);
    expect(t.recent(1)[0]!.number).toBe(200);
  });
});

describe('CommitStream — one subscription, opened when asked, closed when nobody asks', () => {
  function fake() {
    const sockets: (SocketLike & { sent: string[]; closed: boolean })[] = [];
    const open = () => {
      const s = { onopen: null, onmessage: null, onerror: null, onclose: null, sent: [] as string[], closed: false, send(d: string) { this.sent.push(d); }, close() { this.closed = true; this.onclose?.(); } } as SocketLike & { sent: string[]; closed: boolean };
      sockets.push(s);
      return s;
    };
    return { sockets, open };
  }

  it('subscribes to monadNewHeads, goes live on the subscription id, and tracks what arrives', () => {
    const f = fake();
    let now = 0;
    const s = new CommitStream('wss://rpc.monad.xyz', f.open, () => now, 60_000);
    expect(s.snapshot()).toMatchObject({ network: 'Monad mainnet', live: false, blocks: [] });
    const sock = f.sockets[0]!;
    sock.onopen!();
    expect(JSON.parse(sock.sent[0]!)).toMatchObject({ method: 'eth_subscribe', params: ['monadNewHeads'] });
    sock.onmessage!({ data: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0xsub' }) });
    now = 1_000;
    sock.onmessage!({ data: JSON.stringify({ method: 'eth_subscription', params: { result: head(10, 'a', 'Proposed') } }) });
    now = 1_300;
    sock.onmessage!({ data: JSON.stringify({ method: 'eth_subscription', params: { result: head(10, 'a', 'Voted') } }) });
    const snap = s.snapshot();
    expect(snap.live).toBe(true);
    expect(snap.blocks[0]).toMatchObject({ number: 10, state: 'Voted', ms: { Voted: 300 } });
    expect(f.sockets.length).toBe(1);
    s.stop();
  });

  it('a refused subscription says why, and is not retried on every poll', () => {
    const f = fake();
    let now = 0;
    const s = new CommitStream('wss://localhost:8561', f.open, () => now, 60_000);
    s.snapshot();
    f.sockets[0]!.onmessage!({ data: JSON.stringify({ id: 1, error: { message: 'data did not match any variant' } }) });
    expect(s.snapshot()).toMatchObject({ live: false, error: 'monadNewHeads refused: data did not match any variant' });
    expect(f.sockets.length).toBe(1);
    now = 20_000;
    s.snapshot();
    expect(f.sockets.length).toBe(2);
    s.stop();
  });

  it('closes the socket once nobody has asked for the idle period', async () => {
    const f = fake();
    let now = 0;
    const s = new CommitStream('wss://rpc.monad.xyz', f.open, () => now, 50);
    s.snapshot();
    expect(s.holding).toBe(true);
    now = 1_000;
    await new Promise((r) => setTimeout(r, 120));
    expect(s.holding).toBe(false);
    expect(f.sockets[0]!.closed).toBe(true);
  });
});
