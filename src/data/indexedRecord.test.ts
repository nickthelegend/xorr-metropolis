import { describe, expect, it } from 'vitest';
import { indexedLines, type IndexedRecord } from './indexedRecord';

const base: IndexedRecord = {
  source: 'envio-hyperindex',
  chainId: 143,
  synced: { block: 110842222, head: 110842222, fromBlock: 110838470, events: 86 },
  owner: { grants: 1, dailyCap: '100000000', revoked: false, spends: 2, spentTotal: '70000000', closes: 1, venues: 2 },
  days: [{ day: '2026-10-06', spent: '70000000', fills: 2, capAtDay: '100000000' }],
  fills: [],
  venues: [
    { name: 'Kuru', spends: 8, spentVolume: '190000000', closes: 1 },
    { name: 'Uniswap v3', spends: 0, spentVolume: '0', closes: 0 },
  ],
  desks: [{ id: '0xd', operatorActive: true, operatorChanges: 0 }],
  revocations: [],
};

describe('the indexed record, in words', () => {
  it('says the spend, today against the cap, where fills went and the desk', () => {
    expect(indexedLines(base, '2026-10-06')).toEqual([
      '$70.00 spent over 2 orders, 1 closed.',
      'Today: $70.00 of the $100.00 cap.',
      'Where fills went, every wallet: Kuru 9 ($190.00 in).',
      'Perpl desk: 1 tradable.',
    ]);
  });

  it('says a stopped permission and a stopped desk, and nothing about today', () => {
    const r = { ...base, owner: { ...base.owner!, revoked: true }, desks: [{ id: '0xd', operatorActive: false, operatorChanges: 1 }] };
    expect(indexedLines(r, '2026-10-06')).toEqual([
      '$70.00 spent over 2 orders, 1 closed · permission stopped on chain.',
      'Where fills went, every wallet: Kuru 9 ($190.00 in).',
      'Perpl desk: stopped.',
    ]);
  });

  it('says plainly when the chain holds nothing for the wallet', () => {
    expect(indexedLines({ ...base, owner: null }, '2026-10-06')).toEqual(['Nothing on chain for this wallet yet.']);
  });
});
