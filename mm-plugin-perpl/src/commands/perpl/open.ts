import { CommandError, type CommandIO, InputFieldType, PluginCommand, schemaToFlags, type InputSchema } from '@metamask/agent-wallet/plugin';
import { networkInput, perplNet, selectedEvmAddress, send, type Sent } from '../../lib/host.js';
import { readAccount, type Position } from '../../lib/account.js';
import { execOrderData, findMarket, liquidationPrice, planOrder, readContext } from '../../lib/perpl.js';
import { simulate } from '../../lib/preflight.js';

const inputs = {
  network: networkInput,
  market: { type: InputFieldType.Text, flag: 'market', message: 'Market (MON, BTC, ETH…)', required: true, index: 0 },
  side: {
    type: InputFieldType.Select,
    flag: 'side',
    message: 'Long or short',
    required: true,
    options: [
      { value: 'long', label: 'Long' },
      { value: 'short', label: 'Short' },
    ],
  },
  usd: { type: InputFieldType.Text, flag: 'usd', message: 'Size, in dollars', required: true, validate: (v: string) => (Number(v) > 0 && Number.isFinite(Number(v))) || 'A positive dollar amount' },
  leverage: { type: InputFieldType.Text, flag: 'leverage', message: 'Leverage (default 2)', required: false, prompt: false, validate: (v: string) => (Number(v) >= 1 && Number(v) <= 50) || 'Between 1 and 50' },
} satisfies InputSchema;

type Result = Sent & { network: string; market: string; side: 'long' | 'short'; lots: number; limitPrice: number; notionalUsd: number; leverage: number; expectedLiquidation: number | null; position: Position | null };

/** Open a position from the wallet's own Perpl account: an IOC order through the book top, checked before it is signed. */
export default class PerplOpen extends PluginCommand<Result> {
  static override description = 'Open a long or short on Perpl from this wallet — sized in dollars, leverage capped by the market, simulated before signing.';
  static override examples = ['<%= config.bin %> perpl open MON --side long --usd 50', '<%= config.bin %> perpl open BTC --side short --usd 100 --leverage 3'];
  static override flags = schemaToFlags(inputs);
  protected readonly pluginCommandId = 'perpl:open';

  async execute(io: CommandIO): Promise<Result> {
    const { network, market: query, side, usd, leverage } = await io.resolveInputs(inputs);
    const net = perplNet(network);
    const lev = leverage ? Number(leverage) : 2;
    const size = Number(usd);
    const address = selectedEvmAddress(this.ctx.walletStateManager.read());
    const client = this.ctx.publicClient(net.chainId);
    const { markets } = await readContext(net);
    const m = findMarket(markets, query);
    if (!m || !m.open) throw new CommandError('UNKNOWN_MARKET', `${net.name} has no open market "${query}".`, 'mm perpl markets lists them.');
    if (lev > m.maxLeverage) throw new CommandError('LEVERAGE_TOO_HIGH', `${m.name} opens at most ${m.maxLeverage}x on ${net.name}.`, `--leverage ${m.maxLeverage}`);
    const account = await readAccount(client, net, address, markets);
    if (!account) throw new CommandError('NO_ACCOUNT', `${address} has no ${net.name} account.`, 'mm perpl deposit --amount 100');
    const margin = size / lev;
    const free = account.balance - account.locked;
    if (margin > free) throw new CommandError('MARGIN_SHORT', `$${size} at ${lev}x needs $${margin.toFixed(2)} of margin; ${free.toFixed(2)} AUSD is free.`, `mm perpl deposit --amount ${Math.ceil(margin - free)}`);

    const long = side === 'long';
    const plan = planOrder(m, long ? 'open_long' : 'open_short', size, Math.round(lev * 100));
    const top = (long ? m.ask : m.bid)!;
    const expectedLiquidation = liquidationPrice({ long, entry: top, lots: plan.lots, deposit: plan.notionalUsd / lev, maintLeverage: m.maintLeverage });
    const data = execOrderData(plan, await client.getBlockNumber(), BigInt(Date.now()));
    await simulate(client, address, net.exchange, data, 'this order');
    const sent = await send(this.ctx, io, this.pluginCommandId, net, { to: net.exchange, data }, {
      summary: `Open a $${plan.notionalUsd.toFixed(2)} ${m.name} ${side} at ${lev}x on ${net.name}`,
      action: 'perps.open',
      details: {
        size: `${plan.lots} ${m.name}`,
        limit: `$${plan.limitPrice} (IOC, ${long ? 'ask' : 'bid'} ±1%)`,
        margin: `$${margin.toFixed(2)} AUSD`,
        liquidation: expectedLiquidation === null ? undefined : `≈ $${expectedLiquidation.toPrecision(4)}`,
      },
    });
    const after = await readAccount(client, net, address, markets);
    return {
      ...sent,
      network: net.name,
      market: m.name,
      side: long ? 'long' : 'short',
      lots: plan.lots,
      limitPrice: plan.limitPrice,
      notionalUsd: plan.notionalUsd,
      leverage: lev,
      expectedLiquidation,
      position: after?.positions.find((p) => p.perpId === m.id) ?? null,
    };
  }

  override successHint(r: Result): string {
    const p = r.position;
    return p
      ? `${r.market} ${r.side}: ${p.lots} at $${p.entry}, liquidation $${p.liquidation?.toPrecision(4) ?? '—'}. ${r.explorer}`
      : `Sent (${r.status}), but no ${r.market} position is open now: the IOC did not fill. ${r.explorer}`;
  }
}
