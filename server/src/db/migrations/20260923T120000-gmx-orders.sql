-- GMX V2 orders placed for an owner by its agent (PLAN.md P2.5, 2026-09-23).
--
-- A GMX market order is two transactions by two parties: the agent creates it, and some time later a GMX keeper
-- executes, cancels or freezes it. Between the two the app has to say "waiting for the keeper" and afterwards say what
-- happened and why, so the order is remembered by its key from the moment it is created. The chain stays the truth —
-- `venues/gmx/tracker.ts` reads the order and its OrderExecuted/OrderCancelled/OrderFrozen events and writes the
-- outcome here; nothing in this table is believed over a read of the chain.
CREATE TABLE IF NOT EXISTS gmx_orders (
  -- GMX's order key (bytes32, 0x-hex), from the OrderCreated event.
  key            TEXT PRIMARY KEY,
  -- The GMX account the order is for: the owner, never the agent.
  owner          TEXT NOT NULL,
  -- The GMX market token address.
  market         TEXT NOT NULL,
  is_long        BOOLEAN NOT NULL,
  -- 'increase' | 'decrease'.
  kind           TEXT NOT NULL DEFAULT 'increase',
  -- USD, human units (GMX's 30-decimal values divided out).
  size_usd       NUMERIC NOT NULL,
  collateral_usd NUMERIC NOT NULL DEFAULT 0,
  -- 'pending' | 'executed' | 'cancelled' | 'frozen'.
  status         TEXT NOT NULL DEFAULT 'pending',
  created_tx     TEXT NOT NULL,
  executed_tx    TEXT,
  -- Why a keeper cancelled or froze it (GMX's reason string / decoded error name).
  reason         TEXT,
  chain          TEXT NOT NULL DEFAULT current_setting('xorr.chain_key'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS gmx_orders_owner_idx ON gmx_orders (chain, lower(owner), created_at DESC);
