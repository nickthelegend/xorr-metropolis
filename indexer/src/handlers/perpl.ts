/**
 * Perpl desks: Perpl's own DelegatedAccount factory creates each one; from then on the desk is indexed as a contract of
 * its own, and every operator added or removed (xorr's key, the owner's one-tap stop) updates whether it can be traded.
 */
import { indexer } from 'envio';

indexer.contractRegister({ contract: 'PerplDeskFactory', event: 'DelegatedAccountCreated' }, async ({ event, context }) => {
  context.chain.PerplDesk.add(event.params.proxy);
});

indexer.onEvent({ contract: 'PerplDeskFactory', event: 'DelegatedAccountCreated' }, async ({ event, context }) => {
  context.Desk.set({
    id: event.params.proxy.toLowerCase(),
    owner: event.params.owner.toLowerCase(),
    operator: event.params.operator.toLowerCase(),
    operatorActive: true,
    operatorChanges: 0,
    createdAt: event.block.timestamp,
    createdTx: event.transaction.hash,
    lastChange: event.block.timestamp,
  });
});

async function operatorChanged(
  added: boolean,
  { event, context }: { event: { srcAddress: string; params: { operator: string }; block: { number: number; timestamp: number }; logIndex: number; transaction: { hash: string } }; context: any },
) {
  const desk = event.srcAddress.toLowerCase();
  context.DeskOperatorChange.set({
    id: `${event.block.number}_${event.logIndex}`,
    desk,
    operator: event.params.operator.toLowerCase(),
    added,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  const d = await context.Desk.get(desk);
  if (d) {
    context.Desk.set({
      ...d,
      operator: event.params.operator.toLowerCase(),
      operatorActive: added,
      operatorChanges: d.operatorChanges + 1,
      lastChange: event.block.timestamp,
    });
  }
}

indexer.onEvent({ contract: 'PerplDesk', event: 'OperatorAdded' }, (args) => operatorChanged(true, args));
indexer.onEvent({ contract: 'PerplDesk', event: 'OperatorRemoved' }, (args) => operatorChanged(false, args));
