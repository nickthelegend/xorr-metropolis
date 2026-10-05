-- Standing exit rules on each Perpl desk, checked every scheduler tick (`server/src/monad/perpl-exits.ts`, 2026-10-05).
--
-- Percentages, human units; NULL is "off". The defaults protect a desk that never set them: close before liquidation
-- (within 10% of the liquidation price), at a loss of half the margin, or when losing and paying funding at 50% a year.
-- Take-profit is the owner's choice, so it starts off.
ALTER TABLE perpl_desks ADD COLUMN IF NOT EXISTS take_profit_pct     NUMERIC;
ALTER TABLE perpl_desks ADD COLUMN IF NOT EXISTS stop_loss_pct       NUMERIC DEFAULT 50;
ALTER TABLE perpl_desks ADD COLUMN IF NOT EXISTS liq_buffer_pct      NUMERIC DEFAULT 10;
ALTER TABLE perpl_desks ADD COLUMN IF NOT EXISTS max_funding_apr_pct NUMERIC DEFAULT 50;
