/**
 * The deployment list is the one place a chain is added, so what every row must carry is pinned here.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEPLOYMENTS, deploymentFor, thisDeployment } from './deployments';

describe('DEPLOYMENTS', () => {
  it('names each network once, with an https executor or none yet, a chain id and an explorer that is https or none', () => {
    expect(new Set(DEPLOYMENTS.map((d) => d.key)).size).toBe(DEPLOYMENTS.length);
    for (const d of DEPLOYMENTS) {
      expect(d.api === null || /^https:\/\//.test(d.api), d.key).toBe(true);
      expect(Number.isInteger(d.chainId) && d.chainId > 0, d.key).toBe(true);
      expect(d.explorer === null || /^https:\/\//.test(d.explorer), d.key).toBe(true);
      expect(d.name.trim().length, d.key).toBeGreaterThan(0);
    }
  });

  it('lists the Monad fork and Monad testnet, each a test network; only the testnet has a public explorer', () => {
    expect(DEPLOYMENTS.map((d) => [d.key, d.chainId, d.test, d.explorer])).toEqual([
      ['monad-fork', 143, true, null],
      ['monad-testnet', 10143, true, 'https://testnet.monadvision.com'],
    ]);
  });
});

describe('thisDeployment', () => {
  it('matches the executor this build talks to, with or without a trailing slash', async () => {
    vi.resetModules();
    vi.stubEnv('EXPO_PUBLIC_XORR_CHAIN', 'monad-fork');
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://executor-monad.example.app');
    const m = await import('./deployments');
    expect(m.thisDeployment('https://executor-monad.example.app')?.key).toBe('monad-fork');
    expect(m.thisDeployment('https://executor-monad.example.app/')?.key).toBe('monad-fork');
    expect(m.deploymentFor('monad-testnet')?.api).toBeNull();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('names none for an executor no deployment serves, rather than guessing from the chain', () => {
    expect(thisDeployment('http://localhost:8788')).toBeUndefined();
  });
});

describe('deploymentFor', () => {
  it('finds a deployment by chain key, and nothing for a key or no key', () => {
    expect(deploymentFor('monad-fork')?.chainId).toBe(143);
    expect(deploymentFor('base-fork')).toBeUndefined();
    expect(deploymentFor(undefined)).toBeUndefined();
  });
});
