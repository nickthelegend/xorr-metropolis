-- What an executed council round actually bought or sold, so each agent's record is its own fills (2026-09-23).
ALTER TABLE council_rounds ADD COLUMN IF NOT EXISTS fill JSONB;
