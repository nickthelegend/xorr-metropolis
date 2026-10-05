-- What the venue not chosen would have delivered, on a fill where both were measured (Kuru's book and Uniswap; settle.ts,
-- 2026-10-06), beside the chosen venue's own measurement — so a fill can show what routing it was worth.
ALTER TABLE strategy_runs ADD COLUMN IF NOT EXISTS compared_venue TEXT;
ALTER TABLE strategy_runs ADD COLUMN IF NOT EXISTS compared_units NUMERIC(24, 9);
ALTER TABLE strategy_runs ADD COLUMN IF NOT EXISTS measured_units NUMERIC(24, 9);
