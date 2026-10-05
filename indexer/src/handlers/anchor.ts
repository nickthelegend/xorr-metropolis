/** The audit trail's head, published on chain: every anchor, so a history can be checked against what was committed. */
import { indexer } from 'envio';

indexer.onEvent({ contract: 'XorrAuditAnchor', event: 'Anchored' }, async ({ event, context }) => {
  context.AuditAnchor.set({
    id: `${event.block.number}_${event.logIndex}`,
    anchorer: event.params.anchorer.toLowerCase(),
    subject: event.params.subject.toLowerCase(),
    head: event.params.head,
    entryCount: event.params.entryCount,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});
