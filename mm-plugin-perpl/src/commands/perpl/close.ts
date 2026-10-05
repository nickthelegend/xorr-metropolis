import { CommandError, type CommandIO, InputFieldType, PluginCommand, schemaToFlags, type InputSchema } from '@metamask/agent-wallet/plugin';
import { networkInput, perplNet, selectedEvmAddress, send, type Sent } from '../../lib/host.js';
import { readAccount } from '../../lib/account.js';
import { execOrderData, findMarket, planOrder, readContext } from '../../lib/perpl.js';
import { simulate } from '../../lib/preflight.js';

const inputs = {
  network: networkInput,
  market: { type: InputFieldType.Text, flag: 'market', message: 'Market to close (MON, BTC, ETH…)', required: true, index: 0 },
} satisfies InputSchema;

type Result = Sent & { network: string; market: string; closed: 'long' | 'short'; lots: number; pnlUsd: number | null; stillOpen: boolean };

/** Close the wallet's whole position in a market: exactly the lots it holds, through the book top. */
export default class PerplClose extends PluginCommand<Result> {
  static override description = "Close this wallet's whole position in a Perpl market.";
  static override examples = ['<%= config.bin %> perpl close MON'];
  static override flags = schemaToFlags(inputs);
  protected readonly pluginCommandId = 'perpl:close';

  async execute(io: CommandIO): Promise<Result> {
    const { network, market: query } = await io.resolveInputs(inputs);
    const net = perplNet(network);
    const address = selectedEvmAddress(this.ctx.walletStateManager.read());
    const client = this.ctx.publicClient(net.chainId);
    const { markets } = await readContext(net);
    const m = findMarket(markets, query);
    if (!m) throw new CommandError('UNKNOWN_MARKET', `${net.name} has no market "${query}".`, 'mm perpl markets lists them.');
    const account = await readAccount(client, net, address, markets);
    const pos = account?.positions.find((p) => p.perpId === m.id);
    if (!pos) throw new CommandError('NO_POSITION', `No ${m.name} position on ${net.name} to close.`, 'mm perpl account shows what is open.');

    const side = pos.long ? 'close_long' : 'close_short';
    const top = pos.long ? m.bid : m.ask;
    const plan = planOrder(m, side, pos.lots * (top ?? pos.entry), Math.round(m.maxLeverage * 100));
    // Close exactly what is open: the plan's lots come from a dollar value, which rounds; the position's do not.
    plan.lotLNS = BigInt(Math.round(pos.lots * 10 ** m.lotDecimals));
    plan.lots = pos.lots;
    const data = execOrderData(plan, await client.getBlockNumber(), BigInt(Date.now()));
    await simulate(client, address, net.exchange, data, 'closing this position');
    const sent = await send(this.ctx, io, this.pluginCommandId, net, { to: net.exchange, data }, {
      summary: `Close the ${m.name} ${pos.long ? 'long' : 'short'} (${pos.lots} ${m.name}) on ${net.name}`,
      action: 'perps.close',
      details: { pnl: pos.pnlUsd === null ? undefined : `$${pos.pnlUsd.toFixed(2)} at the mark`, limit: `$${plan.limitPrice} (IOC)` },
    });
    const after = await readAccount(client, net, address, markets);
    return { ...sent, network: net.name, market: m.name, closed: pos.long ? 'long' : 'short', lots: pos.lots, pnlUsd: pos.pnlUsd, stillOpen: Boolean(after?.positions.some((p) => p.perpId === m.id)) };
  }

  override successHint(r: Result): string {
    return r.stillOpen ? `Sent (${r.status}), but the ${r.market} position is still open: the IOC did not fill all of it. ${r.explorer}` : `Closed the ${r.market} ${r.closed} (${r.lots}). ${r.explorer}`;
  }
}
