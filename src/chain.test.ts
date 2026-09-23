/**
 * The chain a build signs on, and what it tells a person about their money (src/chain.ts). Each flag follows what money on
 * the chain is, and a chain the app does not know is refused where the app is built.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function buildFor(key: string) {
  vi.stubEnv('EXPO_PUBLIC_XORR_CHAIN', key);
  vi.stubEnv('EXPO_PUBLIC_CHAIN_RPC', '');
  return import('./chain');
}

const facts = (c: typeof import('./chain')) => ({
  id: c.activeChain.id,
  label: c.chainLabel,
  test: c.testNetwork,
  chip: c.networkChip,
  code: c.depositQrWorks,
  signsOnly: c.walletSignsOnly,
});

const settlement = (c: typeof import('./chain')) => c.settlementSymbol;

describe('the chain a build signs on', () => {
  it('on Base, is real money: named on the chip, a deposit code, and the wallet sends', async () => {
    expect(facts(await buildFor('base'))).toEqual({
      id: 8453,
      label: 'Base',
      test: false,
      chip: 'Base',
      code: true,
      signsOnly: false,
    });
  });

  it('on Base Sepolia, is test funds, with a deposit code, and the wallet sends', async () => {
    expect(facts(await buildFor('base-sepolia'))).toEqual({
      id: 84532,
      label: 'Base Sepolia',
      test: true,
      chip: 'Base Sepolia',
      code: true,
      signsOnly: false,
    });
  });

  it('on the Robinhood Chain fork, is a copy of 4663: named a fork, no deposit code, the wallet only signs, USDG settles', async () => {
    const c = await buildFor('robinhood-fork');
    expect(facts(c)).toEqual({
      id: 4663,
      label: 'Robinhood Chain fork',
      test: true,
      chip: 'Robinhood Chain fork',
      code: false,
      signsOnly: true,
    });
    expect(settlement(c)).toBe('USDG');
    expect(c.depositQrNote).toBe('Robinhood Chain fork. Test funds only.');
  });

  it('on the Arbitrum fork, is a copy of 42161 that settles in USDC', async () => {
    const c = await buildFor('arbitrum-fork');
    expect(facts(c)).toEqual({
      id: 42161,
      label: 'Arbitrum fork',
      test: true,
      chip: 'Arbitrum fork',
      code: false,
      signsOnly: true,
    });
    expect(settlement(c)).toBe('USDC');
  });

  it('on Arbitrum One, is real money with an EIP-681 deposit code', async () => {
    const c = await buildFor('arbitrum');
    expect(facts(c)).toMatchObject({ id: 42161, test: false, code: true, signsOnly: false });
    expect(c.depositUri('0x95A0b368588713011a15f4b1041423f31B08e615')).toBe('ethereum:0x95A0b368588713011a15f4b1041423f31B08e615@42161');
    expect(c.depositQrNote).toBe('Send only USDC on Arbitrum.');
  });

  it('on the Monad fork, is a copy of 143: named a fork, no deposit code, the wallet only signs, USDC settles', async () => {
    const c = await buildFor('monad-fork');
    expect(facts(c)).toEqual({
      id: 143,
      label: 'Monad fork',
      test: true,
      chip: 'Monad fork',
      code: false,
      signsOnly: true,
    });
    expect(settlement(c)).toBe('USDC');
    expect(c.depositQrNote).toBe('Monad fork. Test funds only.');
  });

  it('on Monad mainnet, is real money with an EIP-681 deposit code for chain 143, and offers Monad testnet next to it', async () => {
    const c = await buildFor('monad');
    expect(facts(c)).toMatchObject({ id: 143, test: false, code: true, signsOnly: false });
    expect(c.depositUri('0x95A0b368588713011a15f4b1041423f31B08e615')).toBe('ethereum:0x95A0b368588713011a15f4b1041423f31B08e615@143');
    expect(c.depositQrNote).toBe('Send only USDC on Monad.');
    expect(c.supportedChains.map((x) => x.id)).toEqual([143, 10143]);
  });

  it('on Monad testnet, is test funds on chain 10143', async () => {
    const c = await buildFor('monad-testnet');
    expect(facts(c)).toMatchObject({ id: 10143, label: 'Monad testnet', test: true, code: true, signsOnly: false });
  });

  it('refuses a Solana cluster: this app signs on EVM chains', async () => {
    await expect(buildFor('solana-fork')).rejects.toThrow('is a Solana cluster');
  });

  it('refuses a chain the app does not know', async () => {
    await expect(buildFor('optimism')).rejects.toThrow('EXPO_PUBLIC_XORR_CHAIN=optimism is not a chain this app knows');
  });

  it('does not take a name every object has for a chain', async () => {
    await expect(buildFor('constructor')).rejects.toThrow('is not a chain this app knows');
  });
});
