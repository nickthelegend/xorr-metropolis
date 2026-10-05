# xorr's indexer — Envio HyperIndex on Monad

HyperIndex v3 over xorr's contracts and Perpl's desks, feeding the app's on-chain record (`GET /indexed` on the executor,
the card at the top of History).

**Indexed:** `XorrDelegation` — grants, spends, closes, revokes, venue changes; `XorrAuditAnchor` — every published head
of the audit trail; Perpl's `DelegatedAccountFactory` — each desk it creates, then registered as a contract of its own so
every operator added or removed (xorr's key, the owner's one-tap stop) is indexed too.

**Derived as events arrive** (`schema.graphql`): `Owner` (grants, the cap in force, spend total, closes, stopped or not),
`DailySpend` (each UTC day's spend against that day's cap), `Venue` (orders and volume per venue — Kuru, Uniswap v3), `Desk`
(can the desk still be traded).

**Synced over RPC** (`rpc: … for: sync`), so it runs against any Monad node with no HyperSync token: the local fork for
development, testnet or mainnet later. Self-hosted into the executor's own Postgres in a schema of its own
(`ENVIO_PG_SCHEMA=envio`) with Hasura off — the executor is its API.

```bash
cd indexer && npm install                       # Node 22 (Envio's engines)
set -a && . ./.env.example && set +a            # addresses: from server/.env.fork after a rebuild
npx envio start
```

`sh infra/monad-fork/local-stack.sh refork` does this with the fork's current addresses. For a hosted index, Envio Cloud
or HyperSync with an API token (`ENVIO_API_TOKEN`).
