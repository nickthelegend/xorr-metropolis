-- The council (PLAN.md P3.1, 2026-09-23).
--
-- Every trade an agent proposes is put to a council of personas before anything is signed. Each persona reads the same
-- real inputs (Robinhood's session and halt state, the Chainlink feed and its recent rounds, the pool's own quote, GMX
-- funding and open interest, the owner's on-chain permission and holdings) and casts a vote with a reason. The round
-- remembers the inputs exactly as they were read, every vote, the decision, and — when it was approved and executed —
-- the transaction hash it produced, or the refusal that stopped it. The dashboard shows each vote next to that hash.
CREATE TABLE IF NOT EXISTS council_rounds (
  id          BIGSERIAL PRIMARY KEY,
  wallet_id   TEXT NOT NULL,
  owner       TEXT NOT NULL,
  -- What was proposed: {"side":"buy","symbol":"NVDA","usd":50,"venue":"uniswap-v3"}.
  proposal    JSONB NOT NULL,
  -- The inputs every persona voted on, as read (prices, session, feed age, funding, cap, holdings), with their sources.
  inputs      JSONB NOT NULL,
  -- 'approved' | 'rejected' | 'vetoed'.
  decision    TEXT NOT NULL,
  -- 'pending' | 'executed' | 'refused' | 'failed' | 'not_executed'.
  outcome     TEXT NOT NULL DEFAULT 'pending',
  tx_hash     TEXT,
  outcome_detail TEXT,
  -- Who asked: 'agent:<persona>' for the autonomous sweep, 'user' when the owner convened it.
  convened_by TEXT NOT NULL,
  chain       TEXT NOT NULL DEFAULT current_setting('xorr.chain_key'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS council_rounds_wallet ON council_rounds (wallet_id, created_at DESC);

CREATE TABLE IF NOT EXISTS council_votes (
  round_id    BIGINT NOT NULL REFERENCES council_rounds(id) ON DELETE CASCADE,
  persona     TEXT NOT NULL,
  -- 'yes' | 'no' | 'veto' | 'abstain'.
  vote        TEXT NOT NULL,
  confidence  NUMERIC NOT NULL,
  reason      TEXT NOT NULL,
  -- The input keys this persona's reason rests on.
  cites       TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (round_id, persona)
);
