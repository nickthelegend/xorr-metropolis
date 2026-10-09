import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOUNTIES } from './bounties';

const ROOT = join(__dirname, '..', '..');

describe('the bounty map', () => {
  it('has every bounty SUBMISSION enters, and the main track first', () => {
    const sub = readFileSync(join(ROOT, 'docs/SUBMISSION.md'), 'utf8');
    const headings = [...sub.matchAll(/^### (.+?) — (.+?) \(/gm)].map((m) => `${m[1]} — ${m[2]}`);
    for (const h of headings) {
      const [sponsor, title] = h.split(' — ');
      expect(BOUNTIES.some((b) => b.sponsor === sponsor && b.title === title), h).toBe(true);
    }
    expect(BOUNTIES[0]!.id).toBe('monad');
  });
  it('every screen it links is a route the app has', () => {
    for (const b of BOUNTIES)
      for (const s of b.screens) {
        const base = s.route.replace(/^\//, '').split('/')[0]!;
        const file = s.route.startsWith('/order/') ? 'app/order/[symbol].tsx' : `app/${base}.tsx`;
        const alt = `app/${base}/index.tsx`;
        const group = `app/(onboarding)/${base}.tsx`;
        expect(existsSync(join(ROOT, file)) || existsSync(join(ROOT, alt)) || existsSync(join(ROOT, group)), `${b.id}: ${s.route}`).toBe(true);
      }
  });
  it('every piece of evidence it links is a file in the repo', () => {
    for (const b of BOUNTIES) for (const e of b.evidence) expect(existsSync(join(ROOT, e.path)), `${b.id}: ${e.path}`).toBe(true);
  });
});
