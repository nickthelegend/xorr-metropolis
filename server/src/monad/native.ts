/**
 * What xorr uses of Monad itself, read live (2026-10-07; MONAD-TECH items 3, 4, 5 and 8, and the
 * evidence behind the "Built on Monad" screen).
 *
 * Every reading here says where it was taken: Monad mainnet (public reads only — a block, an eth_call), or the executor's
 * own chain (the local fork of mainnet). Nothing is quoted from a spec, and a read that fails is reported as failed:
 *
 *   staking     the staking precompile (0x1000): the epoch, whether it is in its delay period, the validator proposing
 *               now, its stake and commission — through Monad's own viem actions (`@monad-crypto/viem`);
 *   p256        the P256VERIFY precompile (0x0100) checking a signature made here a moment ago, and refusing the same
 *               signature over a different message — on mainnet and on the fork (anvil carries the precompile too);
 *   txpool      `txpool_statusByHash` / `txpool_statusByAddress`, Monad's view of a transaction before it is in a block
 *               (`eth_getTransactionByHash` does not return pending ones on Monad): supported on mainnet, not on anvil;
 *   sync        `eth_sendRawTransactionSync` on the executor's chain (`evm/send.ts` sends every fill with it);
 *   reserve     the reserve-balance precompile (0x1001) answering `dippedIntoReserve()` — mainnet does, anvil returns
 *               nothing (a precompile has no code to look for, so it is called, not inspected);
 *   contracts   the canonical contracts xorr uses or could, with code present on mainnet and on the fork, and xorr's own
 *               on Monad testnet (Sourcify-verified, MonadVision links).
 */
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha2';
import { Staking } from '@monad-crypto/viem';
import { bytesToHex, concatHex, formatEther, numberToHex, type Address, type Hex, type PublicClient } from 'viem';
import { monadMainnet } from './mainnet.js';
import { publicClient } from '../evm/client.js';
import { CHAIN_KEY } from '../evm/chains.js';
import { RESERVE_PRECOMPILE } from './reserve.js';
import { txpoolStatus } from './txpool.js';

export { txpoolStatus };
import { COUNCIL_ROUTE, MONAD_TESTNET_USDC, X402_FACILITATOR, X402_NETWORK, X402_PRICE } from './x402.js';

export const P256_PRECOMPILE: Address = '0x0000000000000000000000000000000000000100';
export const STAKING_PRECOMPILE: Address = '0x0000000000000000000000000000000000001000';

type Read<T> = ({ ok: true } & T) | { ok: false; error: string };
const why = (e: unknown) => (e instanceof Error ? e.message.split('\n')[0]! : String(e)).slice(0, 200);
const where = CHAIN_KEY === 'monad-fork' ? 'the local fork of Monad mainnet' : CHAIN_KEY;

// ── P256 ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The precompile's 160-byte input: hash ‖ r ‖ s ‖ qx ‖ qy. */
export function p256Input(hash: Hex, r: bigint, s: bigint, qx: bigint, qy: bigint): Hex {
  return concatHex([hash, numberToHex(r, { size: 32 }), numberToHex(s, { size: 32 }), numberToHex(qx, { size: 32 }), numberToHex(qy, { size: 32 })]);
}

/** Whether the chain's P256VERIFY accepts `input`: it returns 32 bytes ending in 1, or nothing. */
export async function p256Verify(client: Pick<PublicClient, 'call'>, input: Hex): Promise<boolean> {
  const r = await client.call({ to: P256_PRECOMPILE, data: input });
  return r.data !== undefined && r.data !== '0x' && BigInt(r.data) === 1n;
}

/** A P-256 key's affine coordinates from its uncompressed or compressed encoding. */
export function p256Point(publicKey: Uint8Array): { x: bigint; y: bigint } {
  const p = p256.ProjectivePoint.fromHex(publicKey).toAffine();
  return { x: p.x, y: p.y };
}

/** A fresh key signs a fresh message; the chain must accept it, and refuse the same signature over another message. */
async function p256Probe(client: Pick<PublicClient, 'call'>): Promise<Read<{ accepts: boolean; refusesTampered: boolean }>> {
  try {
    const key = p256.utils.randomPrivateKey();
    const { x, y } = p256Point(p256.getPublicKey(key, false));
    const msg = sha256(new TextEncoder().encode(`xorr p256 probe ${Date.now()}`));
    const sig = p256.sign(msg, key, { prehash: false, lowS: true });
    const good = p256Input(bytesToHex(msg), sig.r, sig.s, x, y);
    const tampered = p256Input(bytesToHex(sha256(msg)), sig.r, sig.s, x, y);
    const [accepts, tamperedOk] = await Promise.all([p256Verify(client, good), p256Verify(client, tampered)]);
    return { ok: true, accepts, refusesTampered: !tamperedOk };
  } catch (e) {
    return { ok: false, error: why(e) };
  }
}

// ── Staking ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type StakingNow = Read<{
  epoch: string;
  inEpochDelayPeriod: boolean;
  proposerValId: string;
  validator: { authAddress: Address; stakeMon: string; commissionPct: number; unclaimedRewardsMon: string } | null;
}>;

async function stakingNow(client: PublicClient): Promise<StakingNow> {
  try {
    // The package types these from an ABI marked nonpayable (the precompile takes CALL only), which viem reads as never.
    const [[epoch, inDelay], proposer] = (await Promise.all([Staking.getEpoch(client as never), Staking.getProposerValId(client as never)])) as unknown as [readonly [bigint, boolean], bigint];
    const v = (await Staking.getValidator(client as never, { args: [proposer] } as never).catch(() => null)) as unknown as readonly unknown[] | null;
    // getValidator: (authAddress, flags, stake, accRewardPerToken, commission, unclaimedRewards, …); commission is 1e18 = 100%.
    const validator = v
      ? {
          authAddress: v[0] as Address,
          stakeMon: formatEther(v[2] as bigint),
          commissionPct: Number((v[4] as bigint) * 10_000n / 10n ** 18n) / 100,
          unclaimedRewardsMon: formatEther(v[5] as bigint),
        }
      : null;
    return { ok: true, epoch: epoch.toString(), inEpochDelayPeriod: inDelay, proposerValId: proposer.toString(), validator };
  } catch (e) {
    return { ok: false, error: why(e) };
  }
}

// ── txpool, sync send, reserve ──────────────────────────────────────────────────────────────────────────────────────

/** Whether a node answers a method at all: a refusal for the input is support; "method not found" is not. */
async function supports(client: Pick<PublicClient, 'request'>, method: string, params: unknown[]): Promise<Read<{ supported: boolean; answer: string }>> {
  try {
    const r = await client.request({ method: method as never, params: params as never });
    return { ok: true, supported: true, answer: JSON.stringify(r).slice(0, 160) };
  } catch (e) {
    const m = why(e);
    const missing = /method not found|not supported|does not exist|-32601|unknown method/i.test(m);
    return { ok: true, supported: !missing, answer: m };
  }
}

/** `dippedIntoReserve()` on 0x1001: a 32-byte bool from Monad, nothing from a node without the precompile. */
async function reserveAnswers(client: Pick<PublicClient, 'call'>): Promise<Read<{ answers: boolean; dipped: boolean | null }>> {
  try {
    const r = await client.call({ to: RESERVE_PRECOMPILE, data: '0x3a61584e' });
    const answers = r.data !== undefined && r.data !== '0x';
    return { ok: true, answers, dipped: answers ? BigInt(r.data!) === 1n : null };
  } catch (e) {
    return { ok: false, error: why(e) };
  }
}

async function hasCode(client: Pick<PublicClient, 'getCode'>, address: Address): Promise<boolean | null> {
  try {
    const code = await client.getCode({ address });
    return code !== undefined && code !== '0x';
  } catch {
    return null;
  }
}

// ── Canonical contracts ─────────────────────────────────────────────────────────────────────────────────────────────

export type Canonical = { name: string; address: Address; use: string; used: boolean };

/** Monad mainnet's canonical contracts (docs.monad.xyz; the fork carries the same state), and what xorr does with each. */
export const CANONICAL: readonly Canonical[] = [
  { name: 'WMON', address: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', use: 'The MON every buy and sell moves: the default buy, the council’s MON rounds, Kuru and Uniswap fills.', used: true },
  { name: 'USDC (Circle)', address: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', use: 'What a permission’s daily limit is counted in, and what a sale pays back.', used: true },
  { name: 'Multicall3', address: '0xcA11bde05977b3631167028862bE2a173976CA11', use: 'The council’s mainnet reads (Chainlink, Kuru, Uniswap) go out batched through it.', used: true },
  { name: 'Permit2', address: '0x000000000022d473030f116ddee9f6b43ac78ba3', use: 'Not used: venues pull through the delegation contract’s own allowance, which the owner can revoke in one hold.', used: false },
  { name: 'EntryPoint v0.7', address: '0x0000000071727De22E5E9d8BAf0edAc6f37da032', use: 'Not used: agents are plain accounts under the delegation contract, so there is no bundler in the path.', used: false },
  { name: 'CreateX', address: '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed', use: 'Not used: xorr’s contracts are deployed with forge and verified on Sourcify.', used: false },
];

/** xorr's own contracts on Monad testnet (contracts/deployments/monad-testnet.json): Sourcify-verified. */
export const DEPLOYED_TESTNET: readonly { name: string; address: Address; deployTx: Hex }[] = [
  { name: 'XorrDelegation', address: '0x5995925de0169574365cc7f6b65f765275b0bd4b', deployTx: '0x808687beb5699fc3a07353f65780e4e89f83d52452795b6871fb6b0c148d764e' },
  { name: 'XorrAuditAnchor', address: '0x5a717b204c77bfba8805ffe1f382b074a3d26203', deployTx: '0xeb90b3ebded116e7195da07942baade60e7bc21e763159469111f634107ce2fe' },
];

// ── All of it ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type MonadNative = {
  at: string;
  /** The executor's chain, in words: where the fork-side readings were taken. */
  executorChain: string;
  staking: StakingNow;
  p256: { mainnet: Awaited<ReturnType<typeof p256Probe>>; executor: Awaited<ReturnType<typeof p256Probe>> };
  txpool: { mainnet: Awaited<ReturnType<typeof supports>>; executor: Awaited<ReturnType<typeof supports>> };
  sync: { executor: Awaited<ReturnType<typeof supports>> };
  reserve: { mainnet: Awaited<ReturnType<typeof reserveAnswers>>; executor: Awaited<ReturnType<typeof reserveAnswers>> };
  contracts: (Canonical & { mainnet: boolean | null; executor: boolean | null })[];
  deployed: { name: string; address: Address; deployTx: Hex; explorer: string }[];
  /** The paid market read (x402.ts) and what Monad's facilitator says it supports, read now. */
  x402: { route: string; price: string; network: string; asset: Address; facilitator: string; supported: Read<{ kinds: string[] }> };
};

/** Monad's x402 facilitator's own list of what it settles: `scheme on network`. */
async function facilitatorKinds(): Promise<Read<{ kinds: string[] }>> {
  try {
    const r = await fetch(`${X402_FACILITATOR}/supported`, { signal: AbortSignal.timeout(6_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { kinds?: { scheme: string; network: string }[] };
    return { ok: true, kinds: (j.kinds ?? []).map((k) => `${k.scheme} on ${k.network}`) };
  } catch (e) {
    return { ok: false, error: why(e) };
  }
}

let cached: { at: number; v: MonadNative } | undefined;

/** Every reading at once, cached 20 s: one screen open does not cost the public RPC a dozen calls a second. */
export async function monadNative(opts: { mainnet?: PublicClient; executor?: PublicClient } = {}): Promise<MonadNative> {
  if (!opts.mainnet && cached && Date.now() - cached.at < 20_000) return cached.v;
  const m = opts.mainnet ?? monadMainnet();
  const x = opts.executor ?? publicClient;
  const probeHash = `0x${'0'.repeat(64)}` as Hex;
  const [staking, p256M, p256X, poolM, poolX, syncX, resM, resX, contracts, x402Kinds] = await Promise.all([
    stakingNow(m),
    p256Probe(m),
    p256Probe(x),
    supports(m, 'txpool_statusByHash', [probeHash]),
    supports(x, 'txpool_statusByHash', [probeHash]),
    // A malformed transaction: a node with the method refuses the bytes; one without it refuses the method.
    supports(x, 'eth_sendRawTransactionSync', ['0x00']),
    reserveAnswers(m),
    reserveAnswers(x),
    Promise.all(CANONICAL.map(async (c) => ({ ...c, mainnet: await hasCode(m, c.address), executor: await hasCode(x, c.address) }))),
    facilitatorKinds(),
  ]);
  const v: MonadNative = {
    at: new Date().toISOString(),
    executorChain: where,
    staking,
    p256: { mainnet: p256M, executor: p256X },
    txpool: { mainnet: poolM, executor: poolX },
    sync: { executor: syncX },
    reserve: { mainnet: resM, executor: resX },
    contracts,
    deployed: DEPLOYED_TESTNET.map((d) => ({ ...d, explorer: `https://testnet.monadvision.com/address/${d.address}` })),
    x402: { route: COUNCIL_ROUTE, price: X402_PRICE, network: X402_NETWORK, asset: MONAD_TESTNET_USDC, facilitator: X402_FACILITATOR, supported: x402Kinds },
  };
  if (!opts.mainnet) cached = { at: Date.now(), v };
  return v;
}
