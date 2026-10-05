/**
 * XorrDelegation: every grant, spend, close, revoke and venue change, kept as it happened — and the owner, the day and the
 * venue it belongs to, brought up to date as it arrives.
 */
import { indexer, type Owner, type Venue } from 'envio';
import { utcDay, venueName } from './venues.js';

const emptyOwner = (id: string, at: number): Owner => ({
  id,
  grants: 0,
  dailyCap: 0n,
  expiresAt: 0n,
  revoked: false,
  spends: 0,
  spentTotal: 0n,
  closes: 0,
  closedTotal: 0n,
  venues: 0,
  firstSeen: at,
  lastActive: at,
});

const emptyVenue = (address: string): Venue => ({ id: address.toLowerCase(), name: venueName(address), spends: 0, spentVolume: 0n, closes: 0, owners: 0 });

indexer.onEvent({ contract: 'XorrDelegation', event: 'Granted' }, async ({ event, context }) => {
  const owner = event.params.owner.toLowerCase();
  const at = event.block.timestamp;
  context.Grant.set({
    id: `${event.block.number}_${event.logIndex}`,
    owner,
    delegate: event.params.delegate.toLowerCase(),
    dailyCap: event.params.dailyCap,
    expiresAt: event.params.expiresAt,
    timestamp: at,
    block: event.block.number,
    txHash: event.transaction.hash,
  });
  const o = await context.Owner.getOrCreate(emptyOwner(owner, at));
  context.Owner.set({ ...o, grants: o.grants + 1, dailyCap: event.params.dailyCap, expiresAt: event.params.expiresAt, revoked: false, lastActive: at });
});

indexer.onEvent({ contract: 'XorrDelegation', event: 'Revoked' }, async ({ event, context }) => {
  const owner = event.params.owner.toLowerCase();
  const at = event.block.timestamp;
  context.Revocation.set({
    id: `${event.block.number}_${event.logIndex}`,
    owner,
    delegate: event.params.delegate.toLowerCase(),
    timestamp: at,
    block: event.block.number,
    txHash: event.transaction.hash,
  });
  // The zero address is the owner stopping every agent at once: the permission itself is revoked.
  if (/^0x0{40}$/.test(event.params.delegate)) {
    const o = await context.Owner.getOrCreate(emptyOwner(owner, at));
    context.Owner.set({ ...o, revoked: true, lastActive: at });
  }
});

indexer.onEvent({ contract: 'XorrDelegation', event: 'VenueAllowed' }, async ({ event, context }) => {
  const owner = event.params.owner.toLowerCase();
  const at = event.block.timestamp;
  context.VenueChange.set({
    id: `${event.block.number}_${event.logIndex}`,
    owner,
    venue: event.params.venue.toLowerCase(),
    allowed: event.params.allowed,
    timestamp: at,
    txHash: event.transaction.hash,
  });
  const o = await context.Owner.getOrCreate(emptyOwner(owner, at));
  context.Owner.set({ ...o, venues: Math.max(0, o.venues + (event.params.allowed ? 1 : -1)), lastActive: at });
  if (event.params.allowed) {
    const v = await context.Venue.getOrCreate(emptyVenue(event.params.venue));
    context.Venue.set({ ...v, owners: v.owners + 1 });
  }
});

indexer.onEvent({ contract: 'XorrDelegation', event: 'Spent' }, async ({ event, context }) => {
  const owner = event.params.owner.toLowerCase();
  const at = event.block.timestamp;
  const venue = event.params.venue.toLowerCase();
  context.Fill.set({
    id: `${event.block.number}_${event.logIndex}`,
    kind: 'spent',
    owner,
    delegate: event.params.delegate.toLowerCase(),
    venue,
    venueName: venueName(venue),
    token: event.params.token.toLowerCase(),
    amount: event.params.amount,
    spentToday: event.params.spentToday,
    timestamp: at,
    block: event.block.number,
    txHash: event.transaction.hash,
  });
  const o = await context.Owner.getOrCreate(emptyOwner(owner, at));
  context.Owner.set({ ...o, spends: o.spends + 1, spentTotal: o.spentTotal + event.params.amount, lastActive: at });
  const day = utcDay(at);
  const d = await context.DailySpend.getOrCreate({ id: `${owner}-${day}`, owner, day, spent: 0n, fills: 0, capAtDay: o.dailyCap });
  context.DailySpend.set({ ...d, spent: d.spent + event.params.amount, fills: d.fills + 1, capAtDay: o.dailyCap });
  const v = await context.Venue.getOrCreate(emptyVenue(venue));
  context.Venue.set({ ...v, spends: v.spends + 1, spentVolume: v.spentVolume + event.params.amount });
});

indexer.onEvent({ contract: 'XorrDelegation', event: 'Closed' }, async ({ event, context }) => {
  const owner = event.params.owner.toLowerCase();
  const at = event.block.timestamp;
  const venue = event.params.venue.toLowerCase();
  context.Fill.set({
    id: `${event.block.number}_${event.logIndex}`,
    kind: 'closed',
    owner,
    delegate: event.params.delegate.toLowerCase(),
    venue,
    venueName: venueName(venue),
    token: event.params.token.toLowerCase(),
    amount: event.params.amount,
    spentToday: undefined,
    timestamp: at,
    block: event.block.number,
    txHash: event.transaction.hash,
  });
  const o = await context.Owner.getOrCreate(emptyOwner(owner, at));
  context.Owner.set({ ...o, closes: o.closes + 1, closedTotal: o.closedTotal + event.params.amount, lastActive: at });
  const v = await context.Venue.getOrCreate(emptyVenue(venue));
  context.Venue.set({ ...v, closes: v.closes + 1 });
});
