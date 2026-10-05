import { type CommandIO, InputFieldType, PluginCommand, schemaToFlags, type InputSchema } from '@metamask/agent-wallet/plugin';
import { networkInput, perplNet } from '../../lib/host.js';
import { readContext } from '../../lib/perpl.js';
import { marketRisks, riskAlerts, type MarketRisk, type RiskAlert } from '../../lib/risk.js';

const inputs = {
  network: networkInput,
  hours: { type: InputFieldType.Text, flag: 'hours', message: 'Window, in hours (1–168)', required: false, prompt: false, validate: (v: string) => (/^\d+$/.test(v) && +v >= 1 && +v <= 168) || 'A whole number of hours, 1 to 168' },
} satisfies InputSchema;

type Result = { network: string; hours: number; alerts: RiskAlert[]; markets: MarketRisk[] };

/** What each market has cost its longs over the window, where its price went, and what deserves a look. Public data. */
export default class PerplRisk extends PluginCommand<Result> {
  static override description = 'Perpl risk: funding paid over a window, its yearly pace, price moves, crowded or stale markets.';
  static override examples = ['<%= config.bin %> perpl risk', '<%= config.bin %> perpl risk --hours 168 --network mainnet'];
  static override requiresAuth = false;
  static override requiresInit = false;
  static override flags = schemaToFlags(inputs);
  protected readonly pluginCommandId = 'perpl:risk';

  async execute(io: CommandIO): Promise<Result> {
    const { network, hours } = await io.resolveInputs(inputs);
    const net = perplNet(network);
    const h = hours ? Number(hours) : 24;
    const { markets } = await readContext(net);
    const risks = await marketRisks(net, markets, h);
    return { network: net.name, hours: h, alerts: riskAlerts(risks, h), markets: risks };
  }

  override successHint(r: Result): string {
    const pct = (n: number | null, d = 3) => (n === null ? '—' : `${Math.abs(n).toFixed(d)}%`);
    const paid = (m: MarketRisk) =>
      m.longsPaidPct === null ? 'no funding history' : m.longsPaidPct === 0 ? 'no funding changed hands' : `longs ${m.longsPaidPct > 0 ? 'paid' : 'were paid'} ${pct(m.longsPaidPct)} (${pct(m.aprPct, 1)} a year)`;
    const lines = r.markets.map(
      (m) => `${m.market.padEnd(6)} ${paid(m)} in ${r.hours}h · price ${m.priceChangePct === null ? '—' : `${m.priceChangePct >= 0 ? '+' : '−'}${pct(m.priceChangePct, 2)}`} · ${m.trades ?? '—'} trades`,
    );
    const alerts = r.alerts.length ? r.alerts.map((a) => `${a.level === 'high' ? '!' : '·'} ${a.text}`) : ['Nothing stands out.'];
    return [`${r.network}, last ${r.hours}h`, ...alerts, '', ...lines].join('\n');
  }
}
