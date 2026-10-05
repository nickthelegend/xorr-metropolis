import { CommandError, type CommandIO, InputFieldType, PluginCommand, schemaToFlags, type InputSchema } from '@metamask/agent-wallet/plugin';
import { erc20Abi } from 'viem';
import { networkInput, perplNet, selectedEvmAddress, send, type Sent } from '../../lib/host.js';
import { approveData, createAccountData, depositData, EXCHANGE_ABI, toCns } from '../../lib/perpl.js';
import { simulate } from '../../lib/preflight.js';

const inputs = {
  network: networkInput,
  amount: { type: InputFieldType.Text, flag: 'amount', message: 'AUSD to put on Perpl', required: true, validate: (v: string) => (Number(v) > 0 && Number.isFinite(Number(v))) || 'A positive amount of AUSD' },
} satisfies InputSchema;

type Result = { network: string; address: string; opened: boolean; amount: number; sent: (Sent & { what: string })[] };

/** Put AUSD on Perpl: approve the Exchange if needed, then open the account (first time) or add to it. */
export default class PerplDeposit extends PluginCommand<Result> {
  static override description = "Put AUSD margin on Perpl from this wallet: opens the wallet's Perpl account the first time.";
  static override examples = ['<%= config.bin %> perpl deposit --amount 150'];
  static override flags = schemaToFlags(inputs);
  protected readonly pluginCommandId = 'perpl:deposit';

  async execute(io: CommandIO): Promise<Result> {
    const { network, amount } = await io.resolveInputs(inputs);
    const net = perplNet(network);
    const usd = Number(amount);
    const cns = toCns(usd);
    const address = selectedEvmAddress(this.ctx.walletStateManager.read());
    const client = this.ctx.publicClient(net.chainId);
    const [account, held, allowed, minOpen] = await Promise.all([
      client.readContract({ address: net.exchange, abi: EXCHANGE_ABI, functionName: 'getAccountByAddr', args: [address] }),
      client.readContract({ address: net.collateral, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
      client.readContract({ address: net.collateral, abi: erc20Abi, functionName: 'allowance', args: [address, net.exchange] }),
      client.readContract({ address: net.exchange, abi: EXCHANGE_ABI, functionName: 'getMinAccountOpenCNS' }),
    ]);
    const opening = account.accountId === 0n;
    if (held < cns) {
      throw new CommandError('INSUFFICIENT_AUSD', `${address} holds ${Number(held) / 1e6} AUSD; ${usd} was asked for.`, net.key === 'testnet' ? "Test AUSD: Agora's testnet faucet, requestFunds(address) at 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C." : 'Move AUSD to this wallet first.');
    }
    if (opening && cns < minOpen) {
      throw new CommandError('BELOW_MINIMUM', `${net.name} opens an account with at least ${Number(minOpen) / 1e6} AUSD.`, `mm perpl deposit --amount ${Number(minOpen) / 1e6}`);
    }
    const sent: Result['sent'] = [];
    if (allowed < cns) {
      const s = await send(this.ctx, io, this.pluginCommandId, net, { to: net.collateral, data: approveData(net.exchange, cns) }, {
        summary: `Allow ${net.name}'s Exchange to take ${usd} AUSD`,
        action: 'perps.deposit',
        details: { spender: net.exchange, amount: `${usd} AUSD` },
      });
      sent.push({ what: 'approve', ...s });
    }
    const data = opening ? createAccountData(cns) : depositData(cns);
    await simulate(client, address, net.exchange, data, opening ? 'opening the account' : 'the deposit');
    const s = await send(this.ctx, io, this.pluginCommandId, net, { to: net.exchange, data }, {
      summary: opening ? `Open a ${net.name} account with ${usd} AUSD` : `Deposit ${usd} AUSD on ${net.name}`,
      action: 'perps.deposit',
      details: { exchange: net.exchange, amount: `${usd} AUSD` },
    });
    sent.push({ what: opening ? 'createAccount' : 'depositCollateral', ...s });
    return { network: net.name, address, opened: opening, amount: usd, sent };
  }

  override successHint(r: Result): string {
    return [`${r.opened ? 'Opened your account with' : 'Deposited'} ${r.amount} AUSD on ${r.network}.`, ...r.sent.map((s) => `${s.what}: ${s.explorer}`)].join('\n');
  }
}
