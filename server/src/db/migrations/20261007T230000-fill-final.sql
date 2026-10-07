-- Two timers on a fill (2026-10-07, MONAD-TECH item 2): `tx_ms` is now the time to EXECUTED — on Monad, the duration of
-- the eth_sendRawTransactionSync call that returned the receipt (`tx_sync`) — and `tx_final_ms` the time until the chain's
-- finalized block reached the fill's block, with the hash at that height checked. Empty when it could not be measured.
ALTER TABLE strategy_runs ADD COLUMN IF NOT EXISTS tx_final_ms INTEGER;
ALTER TABLE strategy_runs ADD COLUMN IF NOT EXISTS tx_sync BOOLEAN;
