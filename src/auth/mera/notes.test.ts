import { describe, expect, it } from 'vitest';
import { noteKeyFrom, notesSalt, openNote, sealNote } from './notes';

describe('a note sealed with a key from the passkey', () => {
  it('opens with the same key — the same passkey, on any device', async () => {
    const sealed = await sealNote(await noteKeyFrom(new Uint8Array(32).fill(9)), 'Sold into strength; Kuru filled better than Uniswap.');
    expect(await openNote(await noteKeyFrom(new Uint8Array(32).fill(9)), sealed)).toBe('Sold into strength; Kuru filled better than Uniswap.');
  });

  it('is ciphertext to anyone else — another passkey fails the check rather than reading garbage', async () => {
    const sealed = await sealNote(await noteKeyFrom(new Uint8Array(32).fill(9)), 'private');
    expect(sealed.ciphertext).not.toContain('private');
    await expect(openNote(await noteKeyFrom(new Uint8Array(32).fill(10)), sealed)).rejects.toThrow();
  });

  it('never repeats a nonce, so the same note seals differently each time', async () => {
    const key = await noteKeyFrom(new Uint8Array(32).fill(9));
    const [a, b] = [await sealNote(key, 'same'), await sealNote(key, 'same')];
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('lives in its own namespace: a salt that is not the wallet’s', async () => {
    const salt = await notesSalt();
    expect(salt).toHaveLength(32);
    // Mera's default (the wallet's) salt is sha256("mera.prf.salt.v1"); this one is not it.
    const walletSalt = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mera.prf.salt.v1')));
    expect(Buffer.from(salt).equals(Buffer.from(walletSalt))).toBe(false);
  });
});
