-- The Monad speed receipt (2026-10-07, docs/ROADMAP-WIN.md F1): what each fill can prove about itself, read from its own
-- receipt when it confirmed — the ms from broadcast to receipt, the block, the gas used and declared, the price paid.
-- Best-effort: a fill whose receipt could not be re-read keeps these empty and is a fill all the same.
ALTER TABLE strategy_runs ADD COLUMN IF NOT EXISTS tx_ms INTEGER;
ALTER TABLE strategy_runs ADD COLUMN IF NOT EXISTS tx_block BIGINT;
ALTER TABLE strategy_runs ADD COLUMN IF NOT EXISTS tx_gas_used NUMERIC(20, 0);
ALTER TABLE strategy_runs ADD COLUMN IF NOT EXISTS tx_gas_limit NUMERIC(20, 0);
ALTER TABLE strategy_runs ADD COLUMN IF NOT EXISTS tx_gas_price NUMERIC(30, 0);
