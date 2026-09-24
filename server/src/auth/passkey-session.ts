/**
 * Sign-in with a Mera passkey account (PLAN.md P4.1; Agora's and Mera's bounties).
 *
 * The passkey never reaches the executor, and neither does a key. The app derives the account from the passkey's PRF
 * output on the device (`src/auth/mera/`), and proves it holds that account by signing a one-time challenge; the executor
 * checks the signature and answers with a session token of its own, which every later request carries like Privy's.
 * Nothing about the passkey is stored here: a user is `mera:<address>`, and their one wallet is that address.
 *
 *   POST /auth/passkey/challenge  {address}                        → {challenge, message, expiresAt}
 *   POST /auth/passkey/session    {address, challenge, signature}   → {token, userId, address, expiresAt}
 *
 * Both are public — they are how a signed-out person becomes signed in — and both are stateless: the challenge and the
 * token are MACed with a secret only the executor holds, so there is no table of nonces to keep, and a restart does not
 * sign anyone out.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from 'viem';
import type { AuthedUser } from './privy.js';

/** How long a challenge may wait to be signed. */
const CHALLENGE_TTL_MS = 5 * 60_000;
/** How long a session token stands before the passkey is asked again. */
export const SESSION_TTL_MS = 24 * 60 * 60_000;
const TOKEN_PREFIX = 'xorr1.';
const CHALLENGE_PREFIX = 'xorr1c.';

/**
 * The MAC key. `XORR_SESSION_SECRET` when the deployment sets one; otherwise derived from the delegate's private key,
 * which every executor already holds and never shares — so a deployment signs its own tokens without a second secret to
 * provision, and two executors with the same key accept each other's sessions. Without either, passkey sign-in is off.
 */
function secret(): Buffer | null {
  const own = process.env.XORR_SESSION_SECRET;
  if (own && own.length >= 32) return Buffer.from(own);
  const key = process.env.DELEGATE_PRIVATE_KEY;
  return key ? createHash('sha256').update(`xorr-session-v1:${key}`).digest() : null;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

function mac(body: string, key: Buffer): string {
  return createHmac('sha256', key).update(body).digest('base64url');
}

function seal(prefix: string, payload: object, key: Buffer): string {
  const body = b64(JSON.stringify(payload));
  return `${prefix}${body}.${mac(`${prefix}${body}`, key)}`;
}

function open<T>(prefix: string, sealed: string, key: Buffer): T | null {
  if (!sealed.startsWith(prefix)) return null;
  const [body, tag] = sealed.slice(prefix.length).split('.');
  if (!body || !tag) return null;
  const want = Buffer.from(mac(`${prefix}${body}`, key));
  const got = Buffer.from(tag);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    return JSON.parse(unb64(body)) as T;
  } catch {
    return null;
  }
}

/** The text a person's account signs: what it proves, and that it moves nothing. */
export function challengeMessage(address: Address, nonce: string, issuedAt: string): string {
  return [
    'Sign in to xorr with your passkey account.',
    '',
    `Account: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
    '',
    'This proves you hold the account. It sends no transaction and costs nothing.',
  ].join('\n');
}

export function isPasskeyToken(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX);
}

export class PasskeySessionError extends Error {
  constructor(
    readonly status: 400 | 401 | 503,
    readonly code: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'PasskeySessionError';
  }
}

export function issueChallenge(rawAddress: string, now = Date.now()): { challenge: string; message: string; expiresAt: string } {
  const key = secret();
  if (!key) throw new PasskeySessionError(503, 'passkey_sign_in_off', 'This executor has no key to sign sessions with, so passkey sign-in is off.');
  if (!isAddress(rawAddress)) throw new PasskeySessionError(400, 'bad_address', 'address is an EVM address (0x and 40 hex characters).');
  const address = getAddress(rawAddress);
  const nonce = randomBytes(16).toString('hex');
  const issuedAt = new Date(now).toISOString();
  const exp = now + CHALLENGE_TTL_MS;
  return {
    challenge: seal(CHALLENGE_PREFIX, { a: address, n: nonce, i: issuedAt, e: exp }, key),
    message: challengeMessage(address, nonce, issuedAt),
    expiresAt: new Date(exp).toISOString(),
  };
}

export async function openSession(
  input: { address: string; challenge: string; signature: string },
  now = Date.now(),
): Promise<{ token: string; userId: string; address: Address; expiresAt: string }> {
  const key = secret();
  if (!key) throw new PasskeySessionError(503, 'passkey_sign_in_off', 'This executor has no key to sign sessions with, so passkey sign-in is off.');
  const c = open<{ a: Address; n: string; i: string; e: number }>(CHALLENGE_PREFIX, input.challenge ?? '', key);
  if (!c) throw new PasskeySessionError(401, 'bad_challenge', 'That challenge was not issued here. Ask for a new one.');
  if (c.e < now) throw new PasskeySessionError(401, 'challenge_expired', 'That challenge expired. Ask for a new one and sign it within five minutes.');
  if (!isAddress(input.address) || getAddress(input.address) !== c.a) {
    throw new PasskeySessionError(401, 'wrong_account', 'The challenge was issued to a different account.');
  }
  const ok = await verifyMessage({ address: c.a, message: challengeMessage(c.a, c.n, c.i), signature: input.signature as Hex }).catch(() => false);
  if (!ok) throw new PasskeySessionError(401, 'bad_signature', 'The signature is not this account’s, so no session was opened.');
  const exp = now + SESSION_TTL_MS;
  const userId = `mera:${c.a.toLowerCase()}`;
  return { token: seal(TOKEN_PREFIX, { s: userId, a: c.a, e: exp }, key), userId, address: c.a, expiresAt: new Date(exp).toISOString() };
}

/** The person behind a passkey session token, or why not. Called by `verifyToken` for tokens it did not mint through Privy. */
export function verifyPasskeyToken(token: string, now = Date.now()): AuthedUser {
  const key = secret();
  if (!key) throw new PasskeySessionError(401, 'passkey_sign_in_off', 'Passkey sessions are not accepted by this executor.');
  const t = open<{ s: string; a: Address; e: number }>(TOKEN_PREFIX, token, key);
  if (!t) throw new PasskeySessionError(401, 'bad_token', 'Invalid passkey session.');
  if (t.e < now) throw new PasskeySessionError(401, 'session_expired', 'Your passkey session ended. Sign in with your passkey again.');
  return {
    userId: t.s,
    walletAddress: t.a,
    // The account the passkey derives is the one wallet this user may register (`/wallet/connect`).
    wallets: [{ address: t.a, embedded: true, chain: 'ethereum' }],
  };
}

export const passkeyRoutes = new Hono();

passkeyRoutes.post('/auth/passkey/challenge', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { address?: string };
  try {
    return c.json(issueChallenge(body.address ?? ''));
  } catch (e) {
    if (e instanceof PasskeySessionError) return c.json({ error: e.code, detail: e.message }, e.status);
    throw e;
  }
});

passkeyRoutes.post('/auth/passkey/session', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { address?: string; challenge?: string; signature?: string };
  try {
    return c.json(await openSession({ address: body.address ?? '', challenge: body.challenge ?? '', signature: body.signature ?? '' }));
  } catch (e) {
    if (e instanceof PasskeySessionError) return c.json({ error: e.code, detail: e.message }, e.status);
    throw e;
  }
});
