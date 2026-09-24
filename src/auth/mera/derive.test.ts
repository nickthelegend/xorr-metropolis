import { describe, expect, it } from 'vitest';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { toHex } from 'viem';
import { phraseFromPrf, privateKeyFromPrf } from './derive';

const PRF = new Uint8Array(32).fill(7);

describe('the account a passkey stands for', () => {
  it('is the same every time for the same PRF output', () => {
    expect(toHex(privateKeyFromPrf(PRF))).toBe(toHex(privateKeyFromPrf(new Uint8Array(32).fill(7))));
    expect(toHex(privateKeyFromPrf(PRF))).not.toBe(toHex(privateKeyFromPrf(new Uint8Array(32).fill(8))));
  });

  it("is the first account any BIP-39 wallet derives from the same phrase — so it can leave this app", () => {
    const phrase = phraseFromPrf(PRF);
    expect(phrase.split(' ')).toHaveLength(24);
    expect(privateKeyToAccount(toHex(privateKeyFromPrf(PRF))).address).toBe(mnemonicToAccount(phrase).address);
  });

  it('refuses anything that is not a 32-byte PRF output', () => {
    expect(() => privateKeyFromPrf(new Uint8Array(16))).toThrow(/32 bytes, not 16/);
  });
});
