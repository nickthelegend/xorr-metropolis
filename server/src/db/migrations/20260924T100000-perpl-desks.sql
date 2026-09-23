-- The Perpl desk: a user's Perpl account held by Perpl's own DelegatedAccount, operated by xorr's agent key
-- (FEATURES-100 #2, 2026-09-24).
--
-- The chain is the truth for everything that matters — who owns the desk, whether xorr's key is still its operator, the
-- account's balance and positions are all read from the DelegatedAccount and the Exchange on every request. What this
-- table keeps is what the chain cannot say: which desk belongs to which xorr user, the caps the user set for the agent,
-- and the orders the agent sent, so a fill can be shown beside the reason it was placed.
CREATE TABLE IF NOT EXISTS perpl_desks (
  -- The owner (the user's wallet) and the chain: one desk per owner per chain.
  owner             TEXT NOT NULL,
  chain             TEXT NOT NULL DEFAULT current_setting('xorr.chain_key'),
  -- Perpl's DelegatedAccount (a BeaconProxy made by Perpl's factory).
  desk              TEXT NOT NULL,
  -- xorr's operator key for this owner (derived per owner; can trade, can never withdraw).
  operator          TEXT NOT NULL,
  factory           TEXT NOT NULL,
  create_tx         TEXT NOT NULL,
  -- Caps the owner set for the agent, enforced by the executor before every order (USD, human units).
  max_order_usd     NUMERIC NOT NULL DEFAULT 250,
  max_day_usd       NUMERIC NOT NULL DEFAULT 1000,
  -- Leverage in hundredths, as Perpl encodes it (200 = 2x).
  max_leverage_hdths INTEGER NOT NULL DEFAULT 200,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, chain)
);

CREATE TABLE IF NOT EXISTS perp_orders (
  id                TEXT PRIMARY KEY,
  owner             TEXT NOT NULL,
  desk              TEXT NOT NULL,
  chain             TEXT NOT NULL DEFAULT current_setting('xorr.chain_key'),
  perp_id           INTEGER NOT NULL,
  market            TEXT NOT NULL,
  -- 'open_long' | 'open_short' | 'close_long' | 'close_short'
  side              TEXT NOT NULL,
  lots              NUMERIC NOT NULL,
  -- The IOC limit sent (human price) and the notional it commits (USD).
  limit_price       NUMERIC NOT NULL,
  notional_usd      NUMERIC NOT NULL,
  leverage_hdths    INTEGER NOT NULL,
  -- 'sent' | 'filled' | 'reverted' | 'refused'
  status            TEXT NOT NULL,
  tx_hash           TEXT,
  -- Who placed it: an agent id, 'council', or 'owner' for the user's own tap.
  placed_by         TEXT NOT NULL,
  reason            TEXT,
  detail            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS perp_orders_owner_day ON perp_orders (owner, chain, created_at);
