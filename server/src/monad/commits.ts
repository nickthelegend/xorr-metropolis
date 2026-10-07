/**
 * Monad's commit states, live (2026-10-07; MONAD-TECH item 1, docs/ROADMAP-WIN.md "Monad-native coverage").
 *
 * A Monad block is not simply "mined". It is Proposed (and executed speculatively), then Voted a slot later, Finalized a
 * slot after that, and Verified once the state root is agreed three blocks on. Monad's RPC streams that pipeline: the
 * `monadNewHeads` WebSocket subscription sends a block's header again at each state, with its `blockId` (one proposal;
 * two can share a height) and `commitState`. No other EVM chain has it, and the speed card's "300 ms" is a number until
 * a reader watches a block go Proposed → Voted → Finalized in about half a second.
 *
 * This holds one subscription to Monad mainnet, opened when someone asks for the pipeline and closed a minute after the
 * last ask, so an executor nobody is watching holds no socket. Each block's times are measured here, from the moment its
 * Proposed message arrived to each later state's message — the RPC's delivery, not a quoted spec. A block first seen
 * mid-pipeline (the subscription opened after its proposal) has no start, so it is shown but never averaged.
 *
 * The rules the stream itself sets (docs.monad.xyz, block states): a block may skip Voted; there is no abandonment message,
 * so when a height finalizes every other proposal at that height is dead, and is dropped here.
 *
 * Mainnet, whatever chain the executor settles on: the local fork has no consensus (every block is final at once, and
 * anvil refuses `monadNewHeads`), so the pipeline it would show is not Monad's. The screen says which network it is.
 */

export type CommitState = 'Proposed' | 'Voted' | 'Finalized' | 'Verified';
const ORDER: readonly CommitState[] = ['Proposed', 'Voted', 'Finalized', 'Verified'];

/** One proposal as the stream has shown it: when each state arrived, in ms after its Proposed message. */
export type CommitBlock = {
  number: number;
  blockId: string;
  hash: string;
  gasUsed: number;
  /** The furthest state reached. */
  state: CommitState;
  /** ms after Proposed at which each later state arrived; null for one not (yet) seen. Absent when Proposed was missed. */
  ms: { Voted: number | null; Finalized: number | null; Verified: number | null } | null;
};

export type CommitStats = { samples: number; votedMs: number | null; finalizedMs: number | null; verifiedMs: number | null };

type Tracked = { number: number; blockId: string; hash: string; gasUsed: number; state: CommitState; at: Partial<Record<CommitState, number>> };

/** How many heights are kept: enough for the strip and for the averages, small enough to never grow. */
const KEEP_HEIGHTS = 60;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return Math.round(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2);
};

/** The pipeline from a stream of `monadNewHeads` results. Pure apart from the clock it is handed. */
export class CommitTracker {
  private readonly blocks = new Map<string, Tracked>();

  /** One subscription message's `result`. Returns false for a payload that is not a commit-state header. */
  observe(r: unknown, now: number): boolean {
    if (!r || typeof r !== 'object') return false;
    const h = r as Record<string, unknown>;
    const state = h.commitState as CommitState;
    if (typeof h.blockId !== 'string' || typeof h.number !== 'string' || !ORDER.includes(state)) return false;
    const number = Number.parseInt(h.number, 16);
    if (!Number.isFinite(number)) return false;
    let b = this.blocks.get(h.blockId);
    if (!b) {
      b = { number, blockId: h.blockId, hash: String(h.hash ?? ''), gasUsed: Number.parseInt(String(h.gasUsed ?? '0x0'), 16) || 0, state, at: {} };
      this.blocks.set(h.blockId, b);
    }
    b.at[state] ??= now;
    if (ORDER.indexOf(state) > ORDER.indexOf(b.state)) b.state = state;
    // A finalized height has one block; any other proposal seen at it is dead, and the stream will not say so.
    if (state === 'Finalized') for (const [id, o] of this.blocks) if (o.number === number && id !== h.blockId) this.blocks.delete(id);
    this.prune();
    return true;
  }

  private prune(): void {
    const heights = [...new Set([...this.blocks.values()].map((b) => b.number))].sort((a, b) => b - a);
    const floor = heights[KEEP_HEIGHTS - 1];
    if (floor === undefined) return;
    for (const [id, b] of this.blocks) if (b.number < floor) this.blocks.delete(id);
  }

  private view(b: Tracked): CommitBlock {
    const p = b.at.Proposed;
    const since = (s: CommitState) => (p !== undefined && b.at[s] !== undefined ? b.at[s]! - p : null);
    return {
      number: b.number,
      blockId: b.blockId,
      hash: b.hash,
      gasUsed: b.gasUsed,
      state: b.state,
      ms: p === undefined ? null : { Voted: since('Voted'), Finalized: since('Finalized'), Verified: since('Verified') },
    };
  }

  /** The newest `n` proposals, newest first. */
  recent(n = 8): CommitBlock[] {
    return [...this.blocks.values()]
      .sort((a, b) => b.number - a.number || (a.at.Proposed ?? 0) - (b.at.Proposed ?? 0))
      .slice(0, n)
      .map((b) => this.view(b));
  }

  /** Median time from Proposed to each later state, over every block seen from its proposal. */
  stats(): CommitStats {
    const vs = [...this.blocks.values()].map((b) => this.view(b)).filter((b) => b.ms);
    const pick = (s: 'Voted' | 'Finalized' | 'Verified') => vs.map((b) => b.ms![s]).filter((x): x is number => x !== null);
    return { samples: vs.filter((b) => b.ms!.Finalized !== null).length, votedMs: median(pick('Voted')), finalizedMs: median(pick('Finalized')), verifiedMs: median(pick('Verified')) };
  }
}

/** The socket this needs: the platform's WebSocket, or a stand-in in tests. */
export type SocketLike = {
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
};

export const MONAD_COMMITS_WS = process.env.MONAD_COMMITS_WS ?? 'wss://rpc.monad.xyz';
/** A minute after the last reader asked, the socket closes. */
const IDLE_MS = 60_000;

export type CommitsSnapshot = {
  network: 'Monad mainnet' | 'Monad testnet' | string;
  /** The socket is open and subscribed. */
  live: boolean;
  /** Why it is not, when it is not: a refused socket, an RPC error. */
  error: string | null;
  blocks: CommitBlock[];
  stats: CommitStats;
};

/** One lazily opened, idly closed `monadNewHeads` subscription. */
export class CommitStream {
  readonly tracker = new CommitTracker();
  private socket: SocketLike | null = null;
  private live = false;
  private error: string | null = null;
  private lastAsk = 0;
  private idle: ReturnType<typeof setInterval> | null = null;
  private retryAt = 0;

  constructor(
    private readonly url: string = MONAD_COMMITS_WS,
    private readonly open: (url: string) => SocketLike = (u) => new WebSocket(u) as unknown as SocketLike,
    private readonly now: () => number = Date.now,
    private readonly idleMs: number = IDLE_MS,
  ) {}

  /** The pipeline now; opens the subscription if it is not open, and keeps it open for another minute. */
  snapshot(): CommitsSnapshot {
    this.lastAsk = this.now();
    this.ensure();
    return {
      network: /testnet/.test(this.url) ? 'Monad testnet' : /rpc\.monad\.xyz|monadinfra|mainnet/.test(this.url) ? 'Monad mainnet' : this.url,
      live: this.live,
      error: this.live ? null : this.error,
      blocks: this.tracker.recent(),
      stats: this.tracker.stats(),
    };
  }

  /** Whether a socket is held: for the idle rule's test and for /health. */
  get holding(): boolean {
    return this.socket !== null;
  }

  private ensure(): void {
    if (this.socket || this.now() < this.retryAt) return;
    let s: SocketLike;
    try {
      s = this.open(this.url);
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
      return;
    }
    this.socket = s;
    s.onopen = () => s.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['monadNewHeads'] }));
    s.onmessage = (e) => {
      let m: { id?: number; result?: unknown; error?: { message?: string }; params?: { result?: unknown } };
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.id === 1) {
        if (m.error) this.fail(`monadNewHeads refused: ${m.error.message ?? 'error'}`);
        else this.live = true;
        return;
      }
      this.tracker.observe(m.params?.result, this.now());
    };
    s.onerror = () => this.fail('the WebSocket to Monad failed');
    s.onclose = () => {
      if (this.socket === s) {
        this.socket = null;
        this.live = false;
      }
    };
    this.idle ??= setInterval(() => {
      if (this.now() - this.lastAsk > this.idleMs) this.stop();
    }, Math.min(10_000, this.idleMs));
    this.idle.unref?.();
  }

  private fail(why: string): void {
    this.error = why;
    this.live = false;
    // Backed off, so a refusing endpoint is not hammered by every poll.
    this.retryAt = this.now() + 15_000;
    const s = this.socket;
    this.socket = null;
    try {
      s?.close();
    } catch {
      // already closed
    }
  }

  /** Close the socket and the idle timer. */
  stop(): void {
    const s = this.socket;
    this.socket = null;
    this.live = false;
    if (this.idle) clearInterval(this.idle);
    this.idle = null;
    try {
      s?.close();
    } catch {
      // already closed
    }
  }
}

let stream: CommitStream | undefined;
/** The executor's one stream. */
export function commitStream(): CommitStream {
  stream ??= new CommitStream();
  return stream;
}
