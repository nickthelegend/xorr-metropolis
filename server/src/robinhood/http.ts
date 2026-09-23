/**
 * The HTTP layer for the Robinhood read module: timeouts, retries on 429/5xx, and a TTL cache.
 *
 * Why not `http/get.ts`: that layer spaces requests 1.1s apart per host, which is right for the
 * public price tiers it was built for and wrong for `api.robinhood.com`, which allows 60 requests a
 * second without auth. Pricing four tokens should not take five seconds. The retry and timeout
 * behaviour is the same idea, sized for this API.
 */

export class RobinhoodHttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`GET ${url} → HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    this.name = 'RobinhoodHttpError';
  }
}

export type FetchJsonOptions = {
  /** Per attempt. */
  timeoutMs?: number;
  /** Total attempts, including the first. */
  attempts?: number;
  backoffBaseMs?: number;
  fetchImpl?: typeof fetch;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

/**
 * GET a URL and parse JSON. Retries 429 and 5xx (honouring Retry-After) and network errors /
 * timeouts; a 4xx other than 429 is an answer, not a failure to get one, so it throws at once.
 */
export async function fetchJson(url: string, opts: FetchJsonOptions = {}): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const attempts = opts.attempts ?? 4;
  const base = opts.backoffBaseMs ?? 400;
  const doFetch = opts.fetchImpl ?? fetch;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let waitMs = base * 2 ** (attempt - 1);
    try {
      const res = await doFetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return await res.json();
      const body = await res.text().catch(() => '');
      const err = new RobinhoodHttpError(url, res.status, body);
      if (res.status !== 429 && res.status < 500) throw err;
      lastErr = err;
      waitMs = retryAfterMs(res) ?? waitMs;
    } catch (e) {
      if (e instanceof RobinhoodHttpError && e.status !== 429 && e.status < 500) throw e;
      lastErr = e;
    }
    if (attempt < attempts) await sleep(Math.min(waitMs, 10_000));
  }
  throw lastErr instanceof Error ? lastErr : new Error(`GET ${url} failed: ${String(lastErr)}`);
}

/**
 * A small TTL cache that also coalesces concurrent misses into one upstream call. Failures are not
 * cached: the next caller tries again.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { at: number; value: V }>();
  private readonly inflight = new Map<string, Promise<V>>();

  constructor(
    readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = load()
      .then((value) => {
        this.entries.set(key, { at: this.now(), value });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  clear(): void {
    this.entries.clear();
  }
}
