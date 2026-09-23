/**
 * The deployment list is the one place a chain is added, so what every row must carry is pinned here.
 */
import { describe, expect, it } from 'vitest';
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

  it('lists the Robinhood Chain and Arbitrum forks, each a test network with no explorer', () => {
    expect(DEPLOYMENTS.map((d) => [d.key, d.chainId, d.test, d.explorer])).toEqual([
      ['robinhood-fork', 4663, true, null],
      ['arbitrum-fork', 42161, true, null],
    ]);
  });
});

describe('thisDeployment', () => {
  it('matches the executor this build talks to, with or without a trailing slash', () => {
    expect(thisDeployment('https://executor-fork-production-ba80.up.railway.app')?.key).toBe('arbitrum-fork');
    expect(thisDeployment('https://executor-fork-production-ba80.up.railway.app/')?.key).toBe('arbitrum-fork');
  });

  it('names none for an executor no deployment serves, rather than guessing from the chain', () => {
    expect(thisDeployment('http://localhost:8788')).toBeUndefined();
  });
});

describe('deploymentFor', () => {
  it('finds a deployment by chain key, and nothing for a key or no key', () => {
    expect(deploymentFor('robinhood-fork')?.chainId).toBe(4663);
    expect(deploymentFor('base-fork')).toBeUndefined();
    expect(deploymentFor(undefined)).toBeUndefined();
  });
});
