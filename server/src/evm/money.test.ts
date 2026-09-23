/**
 * What money on each chain is (`evm/money.ts`): what the mainnet guard, the faucet and the gas drip read, so nothing is
 * handed out on a chain whose money is real, including one the list has never heard of.
 */
import { describe, expect, it } from 'vitest';
import { KNOWN_CHAINS, isKnownChain, moneyOn, networkName } from './money.js';

describe('what money on a chain is', () => {
  it('is real on Base mainnet, test funds on Base Sepolia, and a copy on a fork or a local chain', () => {
    expect(moneyOn('base')).toBe('real');
    expect(moneyOn('base-sepolia')).toBe('test');
    expect(moneyOn('base-fork')).toBe('copy');
    expect(moneyOn('localnet')).toBe('copy');
    expect(moneyOn('arbitrum')).toBe('real');
    expect(moneyOn('arbitrum-sepolia')).toBe('test');
    expect(moneyOn('arbitrum-fork')).toBe('copy');
    expect(moneyOn('robinhood')).toBe('real');
    expect(moneyOn('robinhood-testnet')).toBe('test');
    expect(moneyOn('robinhood-fork')).toBe('copy');
    expect(moneyOn('monad')).toBe('real');
    expect(moneyOn('monad-testnet')).toBe('test');
    expect(moneyOn('monad-fork')).toBe('copy');
    expect([...KNOWN_CHAINS].sort()).toEqual([
      'arbitrum',
      'arbitrum-fork',
      'arbitrum-sepolia',
      'base',
      'base-fork',
      'base-sepolia',
      'localnet',
      'monad',
      'monad-fork',
      'monad-testnet',
      'robinhood',
      'robinhood-fork',
      'robinhood-testnet',
    ]);
  });

  it('is real on a chain the list does not know, so nothing is handed out on a guess', () => {
    for (const key of ['optimism', 'BASE', '', 'constructor', 'toString', '__proto__']) {
      expect(isKnownChain(key)).toBe(false);
      expect(moneyOn(key)).toBe('real');
    }
  });

  it('names each network as a sentence says it, and a chain it does not know as its key', () => {
    expect(networkName('base')).toBe('Base mainnet');
    expect(networkName('base-fork')).toBe('a fork of Base mainnet');
    expect(networkName('arbitrum')).toBe('Arbitrum One');
    expect(networkName('robinhood-fork')).toBe('a fork of Robinhood Chain');
    expect(networkName('monad-fork')).toBe('a fork of Monad mainnet');
    expect(networkName('optimism')).toBe('optimism');
  });
});
