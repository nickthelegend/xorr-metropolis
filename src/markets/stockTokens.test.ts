import { describe, expect, it } from 'vitest';
import {
  ageText,
  chainlinkLine,
  deviationLine,
  haltSentence,
  multiplierLine,
  poolAddress,
  poolLine,
  sessionLabel,
  sessionOpen,
  toMs,
} from './stockTokens';

const fmt = (n: number) => `$${n.toFixed(2)}`;
const NOW = Date.parse('2026-09-23T15:00:00Z');

describe('a Stock Token row says only what the executor reported', () => {
  it('names the four sessions and nothing else', () => {
    expect(['market', 'extended', 'overnight', 'closed'].map(sessionLabel)).toEqual(['Market', 'Extended', 'Overnight', 'Closed']);
    expect(sessionLabel(undefined)).toBeUndefined();
    expect(sessionLabel('lunch')).toBeUndefined();
    expect(sessionOpen('overnight')).toBe(true);
    expect(sessionOpen('closed')).toBe(false);
  });

  it('draws a halt only when halted is true', () => {
    expect(haltSentence({ symbol: 'NVDA', halted: true })).toContain('NVDA is halted');
    expect(haltSentence({ symbol: 'NVDA', halted: false })).toBeUndefined();
    expect(haltSentence({ symbol: 'NVDA' })).toBeUndefined();
  });

  it('reads the multiplier from a string or a number', () => {
    expect(multiplierLine('1.001148322800714293')).toBe('1 token = 1.0011 shares');
    expect(multiplierLine(1)).toBe('1 token = 1 share');
    expect(multiplierLine(undefined)).toBeUndefined();
    expect(multiplierLine('abc')).toBeUndefined();
    expect(multiplierLine(0)).toBeUndefined();
  });

  it('reads a time as ISO, seconds or milliseconds', () => {
    expect(toMs('2026-09-23T14:56:00Z')).toBe(NOW - 4 * 60_000);
    expect(toMs(NOW / 1000)).toBe(NOW);
    expect(toMs(NOW)).toBe(NOW);
    expect(toMs('')).toBeUndefined();
    expect(toMs(null)).toBeUndefined();
    expect(ageText(NOW - 30_000, NOW)).toBe('just now');
    expect(ageText(NOW - 3 * 3_600_000, NOW)).toBe('3 h ago');
  });

  it('prices Chainlink and the pool only when each arrived', () => {
    expect(chainlinkLine({ chainlinkPrice: 178.2, chainlinkUpdatedAt: '2026-09-23T14:56:00Z' }, fmt, NOW)).toBe('Chainlink $178.20 · 4 min ago');
    expect(chainlinkLine({ chainlinkPrice: 178.2 }, fmt, NOW)).toBe('Chainlink $178.20');
    expect(chainlinkLine({ chainlinkPrice: null }, fmt, NOW)).toBeUndefined();
    expect(poolLine({ poolPrice: 178.61 }, fmt)).toBe('Pool $178.61');
    expect(poolLine({}, fmt)).toBeUndefined();
  });

  it('says which way the pool sits from Chainlink, and nothing without a measurement', () => {
    expect(deviationLine(23)).toBe('Pool 0.23% above Chainlink');
    expect(deviationLine(-150)).toBe('Pool 1.50% below Chainlink');
    expect(deviationLine(0)).toBe('Pool matches Chainlink');
    expect(deviationLine(null)).toBeUndefined();
  });

  it('finds the pool address in either shape', () => {
    expect(poolAddress('0xabc')).toBe('0xabc');
    expect(poolAddress({ address: '0xdef', fee: 500 })).toBe('0xdef');
    expect(poolAddress(undefined)).toBeUndefined();
  });
});
