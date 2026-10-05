import { type CommandIO, PluginCommand, schemaToFlags, type InputSchema } from '@metamask/agent-wallet/plugin';
import { networkInput, perplNet } from '../../lib/host.js';
import { fundingPctPerHour, readContext } from '../../lib/perpl.js';

const inputs = { network: networkInput } satisfies InputSchema;

type Row = { market: string; id: number; mark: number | null; fundingPctPerHour: number | null; fundingAprPct: number | null; openInterestUsd: number | null; maxLeverage: number };
type Result = { network: string; markets: Row[]; notOfferedIn: string[] };

/** Every open market on Perpl, from its public API. No sign-in: nothing here touches the wallet. */
export default class PerplMarkets extends PluginCommand<Result> {
  static override description = "List Perpl's open perpetual markets on Monad: mark, funding, open interest, leverage.";
  static override examples = ['<%= config.bin %> perpl markets', '<%= config.bin %> perpl markets --network mainnet --json'];
  static override requiresAuth = false;
  static override requiresInit = false;
  static override flags = schemaToFlags(inputs);
  protected readonly pluginCommandId = 'perpl:markets';

  async execute(io: CommandIO): Promise<Result> {
    const { network } = await io.resolveInputs(inputs);
    const net = perplNet(network);
    const ctx = await readContext(net);
    const markets = ctx.markets
      .filter((m) => m.open)
      .map((m) => {
        const f = fundingPctPerHour(m);
        return {
          market: m.name,
          id: m.id,
          mark: m.mark,
          fundingPctPerHour: f,
          fundingAprPct: f === null ? null : f * 24 * 365,
          openInterestUsd: m.openInterest !== null && m.mark !== null ? Math.round(m.openInterest * m.mark) : null,
          maxLeverage: m.maxLeverage,
        };
      })
      .sort((a, b) => (b.openInterestUsd ?? 0) - (a.openInterestUsd ?? 0));
    return { network: net.name, markets, notOfferedIn: ctx.geoBlock };
  }

  override successHint(r: Result): string {
    const lines = r.markets.map(
      (m) =>
        `${m.market.padEnd(6)} ${m.mark === null ? '—' : `$${m.mark.toLocaleString('en-US', { maximumSignificantDigits: 6 })}`}  ` +
        `${m.fundingPctPerHour === null ? 'funding —' : m.fundingPctPerHour === 0 ? 'funding flat' : `${m.fundingPctPerHour > 0 ? 'longs' : 'shorts'} pay ${Math.abs(m.fundingPctPerHour).toFixed(4)}%/h`}  ` +
        `${m.openInterestUsd === null ? '' : `$${m.openInterestUsd.toLocaleString('en-US')} open`}  up to ${m.maxLeverage}x`,
    );
    return [`${r.network}: ${r.markets.length} open markets`, ...lines].join('\n');
  }
}
