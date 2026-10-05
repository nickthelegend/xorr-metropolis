import { type CommandIO, PluginCommand, schemaToFlags, type InputSchema } from '@metamask/agent-wallet/plugin';
import { networkInput, perplNet, selectedEvmAddress } from '../../lib/host.js';
import { readAccount, type Position } from '../../lib/account.js';
import { readContext } from '../../lib/perpl.js';

const inputs = { network: networkInput } satisfies InputSchema;

type Result = { network: string; address: string; account: null | { id: string; balance: number; locked: number; positions: Position[] } };

/** The agent wallet's Perpl account: balance, and each position's distance to liquidation and funding per hour. */
export default class PerplAccount extends PluginCommand<Result> {
  static override description = "Show this wallet's Perpl account: AUSD on Perpl, positions, liquidation distance, funding per hour.";
  static override examples = ['<%= config.bin %> perpl account', '<%= config.bin %> perpl account --json'];
  static override flags = schemaToFlags(inputs);
  protected readonly pluginCommandId = 'perpl:account';

  async execute(io: CommandIO): Promise<Result> {
    const { network } = await io.resolveInputs(inputs);
    const net = perplNet(network);
    const address = selectedEvmAddress(this.ctx.walletStateManager.read());
    const { markets } = await readContext(net);
    const a = await readAccount(this.ctx.publicClient(net.chainId), net, address, markets);
    return {
      network: net.name,
      address,
      account: a && { id: a.accountId.toString(), balance: a.balance, locked: a.locked, positions: a.positions },
    };
  }

  override successHint(r: Result): string {
    if (!r.account) return `${r.address} has no account on ${r.network} yet. Open one: mm perpl deposit --amount 100`;
    const lines = r.account.positions.map(
      (p) =>
        `${p.market} ${p.long ? 'long' : 'short'} ${p.lots} @ $${p.entry} · mark $${p.mark ?? '—'} · PnL ${p.pnlUsd === null ? '—' : `$${p.pnlUsd.toFixed(2)}`} · ` +
        `liquidation $${p.liquidation?.toPrecision(4) ?? '—'} (${p.liqDistance === null ? '—' : `${(p.liqDistance * 100).toFixed(1)}% away`}) · ` +
        `${p.fundingUsdPerHour === null ? 'funding —' : `${p.fundingUsdPerHour >= 0 ? 'pays' : 'earns'} $${Math.abs(p.fundingUsdPerHour).toFixed(4)}/h`}`,
    );
    return [`${r.network} account #${r.account.id}: ${r.account.balance.toFixed(2)} AUSD (${r.account.locked.toFixed(2)} in positions)`, ...(lines.length ? lines : ['No open positions.'])].join('\n');
  }
}
