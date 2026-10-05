/** `GET /indexed`: the wallet's on-chain record from Envio's HyperIndex (types and words in `indexedRecord.ts`). */
import { api } from './api';
import type { IndexedRecord } from './indexedRecord';

export type { IndexedRecord } from './indexedRecord';
export { indexedLines } from './indexedRecord';

export const indexed = () => api.get<IndexedRecord>('/indexed');
