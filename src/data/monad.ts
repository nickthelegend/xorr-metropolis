/**
 * What xorr uses of Monad, read live by the executor (`server/src/monad/native.ts`, `sponsors-live.ts`), and the passkey
 * check against Monad's P256 precompile (`passkey-p256.ts`). Shapes mirror the server's; a failed read is `ok: false`.
 */
import { api } from './api';

type Read<T> = ({ ok: true } & T) | { ok: false; error: string };
type Support = Read<{ supported: boolean; answer: string }>;
type P256Probe = Read<{ accepts: boolean; refusesTampered: boolean }>;
type ReserveProbe = Read<{ answers: boolean; dipped: boolean | null }>;

export type MonadNative = {
  at: string;
  executorChain: string;
  staking: Read<{
    epoch: string;
    inEpochDelayPeriod: boolean;
    proposerValId: string;
    validator: { authAddress: string; stakeMon: string; commissionPct: number; unclaimedRewardsMon: string } | null;
  }>;
  p256: { mainnet: P256Probe; executor: P256Probe };
  txpool: { mainnet: Support; executor: Support };
  sync: { executor: Support };
  reserve: { mainnet: ReserveProbe; executor: ReserveProbe };
  contracts: { name: string; address: string; use: string; used: boolean; mainnet: boolean | null; executor: boolean | null }[];
  deployed: { name: string; address: string; deployTx: string; explorer: string }[];
  x402?: { route: string; price: string; network: string; asset: string; facilitator: string; supported: Read<{ kinds: string[] }> };
};

export type SponsorsLive = {
  at: string;
  prices: Read<{
    kuru: { mid: number; spreadBps: number | null } | null;
    uniswap: { price: number; pool: string } | null;
    chainlink: { price: number; ageSec: number } | null;
    maxGapBps: number | null;
  }>;
  perpl: Read<{ network: string; open: number; markets: { name: string; mark: number | null; fundingPctPerHour: number | null }[] }>;
  ausd: Read<{ price: number; ageSec: number }>;
  envio: Read<{ processedBlock: number; chainHead: number; behind: number; events: number; fills: number }>;
  kimi: { configured: boolean; needs: string | null };
  cre: { receiver: string | null; where: string };
};

export type PasskeyCheck = {
  publicKey: string;
  origin: string;
  input: string;
  offChain: boolean;
  mainnet: { valid: boolean | null; tamperedValid: boolean | null };
  executor: { valid: boolean | null; tamperedValid: boolean | null };
};

export type Assertion = { authenticatorData: string; clientDataJSON: string; signature: string };

export const monad = {
  native: () => api.get<MonadNative>('/monad/native'),
  sponsors: () => api.get<SponsorsLive>('/monad/sponsors'),
  p256Challenge: () => api.post<{ challenge: string; expiresAt: number }>('/monad/p256/challenge', {}),
  p256Verify: (body: { assertions: Assertion[]; publicKey?: string }) => api.post<PasskeyCheck>('/monad/p256/verify', body),
};

/** "2.2B", "11.5M", "4,800": a large MON amount as a person reads it. */
export function bigMon(v: string | number): string {
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1 })}B`;
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}
