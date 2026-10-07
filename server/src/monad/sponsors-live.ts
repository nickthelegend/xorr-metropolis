/**
 * The sponsors' technology on Monad, each with a live reading from it (2026-10-07; docs/ROADMAP-WIN.md F4).
 *
 * A list of logos proves nothing; each row here is a read made now, through the integration it names: Kuru's book and
 * Uniswap's pool and Chainlink's feed pricing MON against each other, Perpl's markets, Agora AUSD's peg through Chainlink,
 * Envio's index against the chain head, Kimi's seat on the council, and Chainlink CRE's receiver where one is configured.
 * A read that fails is reported as failed, never filled in. (Mera is the passkey account in the app itself, and MetaMask
 * is a command-line plugin; neither has a server-side reading, and the screen says so.)
 */
import { crosscheckMon } from './crosscheck.js';
import { perplContext } from './perpl.js';
import { readFeed } from './chainlink.js';
import { creMonUsdReceiver } from './cre-price.js';
import { kimiConfigured } from '../council/strategist.js';
import { one } from '../db/index.js';
import { publicClient } from '../evm/client.js';
import { CHAIN_KEY } from '../evm/chains.js';

type Read<T> = ({ ok: true } & T) | { ok: false; error: string };
const why = (e: unknown) => (e instanceof Error ? e.message.split('\n')[0]! : String(e)).slice(0, 200);
async function read<T>(f: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, ...(await f()) };
  } catch (e) {
    return { ok: false, error: why(e) };
  }
}

export type SponsorsLive = {
  at: string;
  prices: Read<{ kuru: { mid: number; spreadBps: number | null } | null; uniswap: { price: number; pool: string } | null; chainlink: { price: number; ageSec: number } | null; maxGapBps: number | null }>;
  perpl: Read<{ network: string; open: number; markets: { name: string; mark: number | null; fundingPctPerHour: number | null }[] }>;
  ausd: Read<{ price: number; ageSec: number }>;
  envio: Read<{ processedBlock: number; chainHead: number; behind: number; events: number; fills: number }>;
  kimi: { configured: boolean; needs: string | null };
  cre: { receiver: string | null; where: string };
};

let cached: { at: number; v: SponsorsLive } | undefined;

export async function sponsorsLive(): Promise<SponsorsLive> {
  if (cached && Date.now() - cached.at < 20_000) return cached.v;
  const [prices, perpl, ausd, envio] = await Promise.all([
    read(async () => {
      const x = await crosscheckMon();
      return {
        kuru: x.kuru.ok ? { mid: x.kuru.price, spreadBps: (x.kuru.detail as { spreadBps?: number } | undefined)?.spreadBps ?? null } : null,
        uniswap: x.uniswap.ok ? { price: x.uniswap.price, pool: String((x.uniswap.detail as { pool?: string } | undefined)?.pool ?? 'Uniswap v3') } : null,
        chainlink: x.chainlink.ok ? { price: x.chainlink.price, ageSec: Number((x.chainlink.detail as { ageSec?: number } | undefined)?.ageSec ?? NaN) } : null,
        maxGapBps: x.maxGapBps ?? null,
      };
    }),
    read(async () => {
      const p = await perplContext();
      const open = p.markets.filter((m) => m.open);
      return { network: p.network, open: open.length, markets: open.slice(0, 6).map((m) => ({ name: m.name, mark: m.mark, fundingPctPerHour: m.fundingPctPerHour })) };
    }),
    read(async () => {
      const f = await readFeed('AUSD');
      return { price: f.price, ageSec: f.ageSec };
    }),
    read(async () => {
      const schema = process.env.ENVIO_PG_SCHEMA ?? 'envio';
      const [meta, fills, head] = await Promise.all([
        one<{ latest_processed_block: string; num_events_processed: string }>(`SELECT latest_processed_block::text, num_events_processed::text FROM ${schema}.chain_metadata LIMIT 1`),
        one<{ n: string }>(`SELECT count(*)::text AS n FROM ${schema}."Fill"`),
        publicClient.getBlockNumber(),
      ]);
      if (!meta) throw new Error('the indexer has not started');
      const processed = Number(meta.latest_processed_block);
      return { processedBlock: processed, chainHead: Number(head), behind: Math.max(0, Number(head) - processed), events: Number(meta.num_events_processed), fills: Number(fills?.n ?? 0) };
    }),
  ]);
  const receiver = creMonUsdReceiver();
  const v: SponsorsLive = {
    at: new Date().toISOString(),
    prices,
    perpl,
    ausd,
    envio,
    kimi: { configured: kimiConfigured(), needs: kimiConfigured() ? null : 'MOONSHOT_API_KEY' },
    cre: { receiver, where: receiver ? CHAIN_KEY : CHAIN_KEY === 'monad-testnet' ? 'no receiver configured' : 'Monad testnet only (the workflow writes there); awaiting testnet go' },
  };
  cached = { at: Date.now(), v };
  return v;
}
