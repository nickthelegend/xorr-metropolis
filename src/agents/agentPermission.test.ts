import { describe, expect, it } from 'vitest';
import { decodeFunctionData, type Address } from 'viem';
import {
  AGENT_CAPS,
  AGENT_DAYS,
  AGENT_DELEGATION_ABI,
  allowanceShortfall,
  capUnits,
  convenedByLabel,
  encodeGrantAgent,
  encodeRevokeAgent,
  expiryFrom,
  gasLine,
  nearestStep,
  permissionLine,
  permissionState,
  roundSigner,
  stepFrom,
} from './agentPermission';

const AGENT = '0x5cf6000000000000000000000000000000000c34' as Address;
const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const DAY = 86_400_000;

describe('grantAgent / revokeAgent calldata', () => {
  it('encodes the delegate, the cap in 6-dp units and an expiry in seconds', () => {
    const data = encodeGrantAgent(AGENT, 50, 7, NOW);
    const { functionName, args } = decodeFunctionData({ abi: AGENT_DELEGATION_ABI, data });
    expect(functionName).toBe('grantAgent');
    expect(args).toEqual([AGENT, 50_000_000n, BigInt(NOW / 1000 + 7 * 86_400)]);
  });

  it('revokes one agent by its address', () => {
    const { functionName, args } = decodeFunctionData({ abi: AGENT_DELEGATION_ABI, data: encodeRevokeAgent(AGENT) });
    expect(functionName).toBe('revokeAgent');
    expect(args).toEqual([AGENT]);
  });

  it('parses the cap from digits, not float arithmetic', () => {
    expect(capUnits(100)).toBe(100_000_000n);
    expect(capUnits(0.1 + 0.2)).toBe(300_000n);
    expect(expiryFrom(NOW, 1)).toBe(BigInt(NOW / 1000 + 86_400));
  });
});

describe('allowance a hire needs', () => {
  it('asks for nothing when the allowance covers the whole term', () => {
    expect(allowanceShortfall(1_000_000_000n, 100, 7)).toBe(0n);
  });
  it('asks for the term when it does not', () => {
    expect(allowanceShortfall(10n, 50, 7)).toBe(350_000_000n);
  });
});

describe('steppers', () => {
  it('lands a suggestion on a step and holds at the ends', () => {
    expect(nearestStep(AGENT_CAPS, 100, 100)).toBe(100);
    expect(nearestStep(AGENT_CAPS, 60, 100)).toBe(50);
    expect(nearestStep(AGENT_DAYS, undefined, 7)).toBe(7);
    expect(stepFrom(AGENT_CAPS, 100, -1)).toBe(50);
    expect(stepFrom(AGENT_CAPS, 25, -1)).toBe(25);
    expect(stepFrom(AGENT_DAYS, 30, 1)).toBe(30);
  });
});

describe('permission line — only what the executor read', () => {
  const live = { dailyCapUsd: 100, remainingTodayUsd: 80, spentTodayUsd: 20, expiresAt: NOW + 3 * DAY, revoked: false };

  it('live: cap, left today, end date', () => {
    expect(permissionState({ permission: live }, NOW)).toBe('live');
    expect(permissionLine({ permission: live }, NOW)).toBe('$100/day · $80.00 left today · ends Sep 26');
  });

  it('none granted asks for one', () => {
    expect(permissionState({ permission: null }, NOW)).toBe('needs');
    expect(permissionLine({ permission: null }, NOW)).toBe('Needs your permission');
  });

  it('stopped and ended are said as such', () => {
    expect(permissionLine({ permission: { ...live, revoked: true } }, NOW)).toBe('Stopped');
    expect(permissionState({ permission: { ...live, expiresAt: NOW - DAY } }, NOW)).toBe('ended');
  });

  it('an unreadable or missing answer is not "no permission"', () => {
    expect(permissionState({ permission: null, permissionError: 'rpc down' }, NOW)).toBe('unknown');
    expect(permissionState({}, NOW)).toBe('unknown');
    expect(permissionLine({}, NOW)).toBe('Permission unreadable right now');
  });

  it('gas only when the executor read it', () => {
    expect(gasLine('0.05')).toBe('0.0500 ETH');
    expect(gasLine(null)).toBeNull();
    expect(gasLine(undefined)).toBeNull();
  });
});

describe('council rounds name their agent', () => {
  const roster = [
    { id: 'row-1', personaId: 'yield-keeper', name: 'Yield Keeper', wallet: '0xabc0000000000000000000000000000000000001' },
  ];
  it('maps agent:<id> to the name and the wallet that signed', () => {
    expect(convenedByLabel('agent:yield-keeper', roster)).toBe('Yield Keeper');
    expect(roundSigner('agent:yield-keeper', roster)).toBe(roster[0]!.wallet);
  });
  it('keeps "you asked" and never invents a signer', () => {
    expect(convenedByLabel('user', roster)).toBe('you asked');
    expect(roundSigner('user', roster)).toBeUndefined();
    expect(convenedByLabel('agent:momentum-scout', undefined)).toBe('momentum-scout');
    expect(roundSigner('agent:momentum-scout', roster)).toBeUndefined();
  });
});
