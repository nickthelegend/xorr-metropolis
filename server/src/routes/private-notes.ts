/**
 * Private notes (Mera's "one passkey, many keys"): the app encrypts on the device with a key derived from the owner's
 * passkey under its own PRF salt — not the wallet's — and this stores what it is given. It cannot read a note: it never
 * has the passkey, the PRF output or the key. What it can check is the shape: a subject it knows, an IV and a ciphertext
 * of sane sizes, and that the note belongs to the caller's wallet.
 *
 *   GET    /notes/:subject   → {subject, note: {iv, ciphertext, updatedAt} | null}
 *   PUT    /notes/:subject   {iv, ciphertext} → {subject, updatedAt}
 *   DELETE /notes/:subject
 */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { one, query } from '../db/index.js';
import { requireWallet } from './wallet-context.js';

export const privateNotes = new Hono();

/** `run:<uuid>` — a note on one of the caller's runs. */
const SUBJECT = /^run:[0-9a-f-]{36}$/;
/** 12-byte AES-GCM IV, base64. */
const IV = /^[A-Za-z0-9+/]{16}$/;
/** A note of a few thousand characters, encrypted and base64'd, is well under this. */
const MAX_CIPHERTEXT = 24_000;

function badSubject(subject: string) {
  return { error: 'bad_subject', detail: `A note is kept on a run: subject is run:<id>, not "${subject.slice(0, 60)}".` };
}

privateNotes.get('/notes/:subject', async (c) => {
  const w = await requireWallet(c);
  const subject = c.req.param('subject');
  if (!SUBJECT.test(subject)) return c.json(badSubject(subject), 400);
  const row = await one<{ iv: string; ciphertext: string; updated_at: Date }>(
    `SELECT iv, ciphertext, updated_at FROM private_notes WHERE wallet_id = $1 AND subject = $2`,
    [w.id, subject],
  );
  // No note yet is an answer, not a failure: a 404 here was logged by the browser as an error on every first open.
  return c.json({ subject, note: row ? { iv: row.iv, ciphertext: row.ciphertext, updatedAt: row.updated_at.toISOString() } : null });
});

privateNotes.put('/notes/:subject', async (c) => {
  const w = await requireWallet(c);
  const subject = c.req.param('subject');
  if (!SUBJECT.test(subject)) return c.json(badSubject(subject), 400);
  const body = (await c.req.json().catch(() => ({}))) as { iv?: unknown; ciphertext?: unknown };
  if (typeof body.iv !== 'string' || !IV.test(body.iv)) {
    return c.json({ error: 'bad_iv', detail: 'iv is a 12-byte AES-GCM nonce, base64.' }, 400);
  }
  if (typeof body.ciphertext !== 'string' || body.ciphertext.length === 0 || body.ciphertext.length > MAX_CIPHERTEXT || !/^[A-Za-z0-9+/=]+$/.test(body.ciphertext)) {
    return c.json({ error: 'bad_ciphertext', detail: `ciphertext is base64, at most ${MAX_CIPHERTEXT} characters.` }, 400);
  }
  const row = await one<{ updated_at: Date }>(
    `INSERT INTO private_notes (id, wallet_id, subject, iv, ciphertext) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (wallet_id, subject) DO UPDATE SET iv = EXCLUDED.iv, ciphertext = EXCLUDED.ciphertext, updated_at = now()
     RETURNING updated_at`,
    [randomUUID(), w.id, subject, body.iv, body.ciphertext],
  );
  return c.json({ subject, updatedAt: row!.updated_at.toISOString() });
});

privateNotes.delete('/notes/:subject', async (c) => {
  const w = await requireWallet(c);
  const subject = c.req.param('subject');
  if (!SUBJECT.test(subject)) return c.json(badSubject(subject), 400);
  await query(`DELETE FROM private_notes WHERE wallet_id = $1 AND subject = $2`, [w.id, subject]);
  return c.json({ subject, deleted: true });
});
