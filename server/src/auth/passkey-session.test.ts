/**
 * Passkey sign-in: a signed challenge becomes a session the executor verifies itself — and nothing else does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

vi.stubEnv('XORR_SESSION_SECRET', 'a-test-secret-that-is-at-least-thirty-two-chars');
const { issueChallenge, openSession, verifyPasskeyToken, isPasskeyToken, SESSION_TTL_MS, PasskeySessionError } = await import('./passkey-session.js');

const me = privateKeyToAccount(generatePrivateKey());
const someoneElse = privateKeyToAccount(generatePrivateKey());
const NOW = Date.parse('2026-09-24T12:00:00Z');

async function signIn(signer = me, now = NOW) {
  const c = issueChallenge(me.address, now);
  const signature = await signer.signMessage({ message: c.message });
  return openSession({ address: me.address, challenge: c.challenge, signature }, now + 1_000);
}

describe('a passkey account signing in', () => {
  beforeEach(() => vi.stubEnv('XORR_SESSION_SECRET', 'a-test-secret-that-is-at-least-thirty-two-chars'));

  it('turns a signed challenge into a session that names the account as its only wallet', async () => {
    const s = await signIn();
    expect(s.userId).toBe(`mera:${me.address.toLowerCase()}`);
    expect(isPasskeyToken(s.token)).toBe(true);
    expect(verifyPasskeyToken(s.token, NOW + 2_000)).toEqual({
      userId: s.userId,
      walletAddress: me.address,
      wallets: [{ address: me.address, embedded: true, chain: 'ethereum' }],
    });
  });

  it('says what it signs: an account, a nonce, and that it moves nothing', () => {
    const c = issueChallenge(me.address, NOW);
    expect(c.message).toContain(`Account: ${me.address}`);
    expect(c.message).toMatch(/Nonce: [0-9a-f]{32}/);
    expect(c.message).toContain('It sends no transaction and costs nothing.');
  });

  it("refuses another account's signature", async () => {
    await expect(signIn(someoneElse)).rejects.toMatchObject({ code: 'bad_signature', status: 401 });
  });

  it('refuses a challenge signed after five minutes', async () => {
    const c = issueChallenge(me.address, NOW);
    const signature = await me.signMessage({ message: c.message });
    await expect(openSession({ address: me.address, challenge: c.challenge, signature }, NOW + 5 * 60_000 + 1)).rejects.toMatchObject({ code: 'challenge_expired' });
  });

  it('refuses a challenge presented for a different account', async () => {
    const c = issueChallenge(me.address, NOW);
    const signature = await someoneElse.signMessage({ message: c.message });
    await expect(openSession({ address: someoneElse.address, challenge: c.challenge, signature }, NOW + 1_000)).rejects.toMatchObject({ code: 'wrong_account' });
  });

  it('refuses a tampered token and an expired one', async () => {
    const s = await signIn();
    const [prefixBody, tag] = s.token.split('.').slice(0, 2).join('.').length ? [s.token.slice(0, s.token.lastIndexOf('.')), s.token.slice(s.token.lastIndexOf('.') + 1)] : ['', ''];
    const forged = Buffer.from(JSON.stringify({ s: 'mera:0xattacker', a: someoneElse.address, e: NOW + 1e9 })).toString('base64url');
    expect(() => verifyPasskeyToken(`xorr1.${forged}.${tag}`, NOW)).toThrow(PasskeySessionError);
    expect(() => verifyPasskeyToken(`${prefixBody}.AAAA`, NOW)).toThrow(/Invalid passkey session/);
    expect(() => verifyPasskeyToken(s.token, NOW + SESSION_TTL_MS + 2_000)).toThrow(/session ended/);
  });

  it('is off, and says so, on an executor with no key to sign sessions with', () => {
    vi.stubEnv('XORR_SESSION_SECRET', '');
    vi.stubEnv('DELEGATE_PRIVATE_KEY', '');
    expect(() => issueChallenge(me.address, NOW)).toThrow(/passkey sign-in is off/);
  });
});
