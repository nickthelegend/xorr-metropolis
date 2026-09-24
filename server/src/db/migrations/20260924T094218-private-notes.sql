-- Private notes: end-to-end encrypted with a key only the owner's passkey derives (Mera PRF, its own salt), 2026-09-24.
--
-- The executor stores the ciphertext and the IV and nothing else it could read: it has neither the passkey nor the key.
-- One note per wallet and subject (a run, for now); `ciphertext` is base64 AES-256-GCM output, tag included.
CREATE TABLE IF NOT EXISTS private_notes (
  id          TEXT PRIMARY KEY,
  wallet_id   TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  subject     TEXT NOT NULL,
  iv          TEXT NOT NULL,
  ciphertext  TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (wallet_id, subject)
);
