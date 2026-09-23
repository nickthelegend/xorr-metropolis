-- What the agent saw, per wallet AND chain (2026-09-24).
--
-- `agent_looks` had no chain, so one database serving several chains showed a Monad wallet another build's sweep:
-- the Monad fork's Schedule screen listed NVDAx, TSLAx and AAPLx, which no Monad agent ever looked at. Rows written
-- before this carry no chain and are read by none; every sweep from now writes its own chain's.
ALTER TABLE agent_looks ADD COLUMN IF NOT EXISTS chain TEXT;
