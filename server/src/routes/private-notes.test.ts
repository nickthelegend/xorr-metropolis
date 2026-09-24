/**
 * Private notes on the executor: it keeps what the device sealed, for the caller's wallet only, and refuses anything that
 * is not the shape of a sealed note.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ rows: new Map<string, { iv: string; ciphertext: string; updated_at: Date }>() }));
vi.mock('../db/index.js', () => ({
  one: vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.startsWith('SELECT')) return db.rows.get(`${params[0]}|${params[1]}`) ?? null;
    const [, wallet, subject, iv, ciphertext] = params as [string, string, string, string, string];
    const row = { iv, ciphertext, updated_at: new Date('2026-09-24T10:00:00Z') };
    db.rows.set(`${wallet}|${subject}`, row);
    return row;
  }),
  query: vi.fn(async (_sql: string, params: unknown[]) => {
    db.rows.delete(`${params[0]}|${params[1]}`);
    return [];
  }),
}));
vi.mock('./wallet-context.js', () => ({ requireWallet: vi.fn(async () => ({ id: 'wallet-1', address: '0x1' })) }));

const { privateNotes } = await import('./private-notes.js');
const RUN = 'run:3cabe066-1ed4-4536-80fd-eb0dbcac7da3';
const put = (subject: string, body: unknown) =>
  privateNotes.request(`/notes/${encodeURIComponent(subject)}`, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

beforeEach(() => db.rows.clear());

describe('a private note', () => {
  it('is kept exactly as sealed, and given back to the same wallet', async () => {
    const sealed = { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'q83vEjRWeJA=' };
    expect((await put(RUN, sealed)).status).toBe(200);
    const res = await privateNotes.request(`/notes/${encodeURIComponent(RUN)}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ subject: RUN, note: sealed });
  });

  it('is null — an answer, not a 404 — until one is written, and gone once deleted', async () => {
    expect(await (await privateNotes.request(`/notes/${encodeURIComponent(RUN)}`)).json()).toEqual({ subject: RUN, note: null });
    await put(RUN, { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'q83vEjRWeJA=' });
    await privateNotes.request(`/notes/${encodeURIComponent(RUN)}`, { method: 'DELETE' });
    expect(await (await privateNotes.request(`/notes/${encodeURIComponent(RUN)}`)).json()).toEqual({ subject: RUN, note: null });
  });

  it('refuses what is not a sealed note: plaintext, a bad nonce, an unknown subject', async () => {
    expect(await (await put(RUN, { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'my plain note, not base64!' })).json()).toMatchObject({ error: 'bad_ciphertext' });
    expect(await (await put(RUN, { iv: 'short', ciphertext: 'q83vEjRWeJA=' })).json()).toMatchObject({ error: 'bad_iv' });
    expect(await (await put('wallet:everything', { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'q83vEjRWeJA=' })).json()).toMatchObject({ error: 'bad_subject' });
  });
});
