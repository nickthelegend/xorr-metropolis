# How xorr uses Envio

xorr is a council of AI agents that trades for you on Monad, inside a limit you sign and the chain enforces. Envio's
**HyperIndex** (v3, `envio@3.12.1`) is how xorr reads that limit back: every grant, spend, close, revoke, Perpl desk and
audit anchor, indexed from the contracts' own events. On Monad testnet the index syncs over **HyperSync**.

## What Envio does in the product

An agent with authority over your money is only as trustworthy as your ability to see what it did. Before Envio, History
was a scan: the executor read a bounded stretch of the chain, so "nothing here" could only ever mean "nothing since
then". **The index makes the record complete from the contract's deploy block**, and it is the source of three things on
screen:

| Where | What it shows | Reads |
|---|---|---|
| History, the card at the top (`testID="history-indexed"`, "ON CHAIN · INDEXED BY ENVIO") | your spend over your orders, today against the cap, which venue carried how much, whether your Perpl desk can still be traded, and "HyperIndex, read to block N (E events since block S)" | `GET /indexed` |
| History and Runs when empty (`src/indexed/RecentOnXorr.tsx`) | "On xorr just now": the latest fills, **everyone's, and labelled so** ("Everyone's fills, not yours · Envio") | `GET /indexed/recent` |
| Built on Monad (`/monad`, row `monad-sponsor-envio`) | "Indexed to block N (at the head / K behind)", and events · fills | `GET /monad/sponsors` |

**What it never does:** fill a gap. Where the indexer has not run, `/indexed` answers 503 `index_unavailable` rather than
an empty record (which would read as "nothing happened"), and the History card is simply absent. A fill whose token this
build doesn't list keeps its address and no amount, rather than a guessed one.

## How it works

**Code:** `indexer/` (config, schema, handlers in `indexer/src/handlers/`), read by `server/src/routes/indexed.ts`.

**What is indexed** (`indexer/config.yaml`):

```yaml
contracts:
  - name: XorrDelegation
    events:
      - event: Granted(address indexed owner, address indexed delegate, uint256 dailyCap, uint64 expiresAt)
      - event: Revoked(address indexed owner, address indexed delegate)
      - event: VenueAllowed(address indexed owner, address indexed venue, bool allowed)
      - event: Spent(address indexed owner, address indexed delegate, address indexed venue, address token, uint256 amount, uint256 spentToday)
      - event: Closed(address indexed owner, address indexed delegate, address indexed venue, address token, uint256 amount)
  - name: XorrAuditAnchor
    events:
      - event: Anchored(address indexed anchorer, address indexed subject, bytes32 head, uint64 entryCount, uint64 blockNo)
  - name: PerplDeskFactory     # Perpl's own DelegatedAccount factory
  - name: PerplDesk            # each desk it creates, registered at runtime
```

Addresses, chain id and start block come from the environment, because the local fork's addresses change on every
re-fork. The same handlers and schema run against the fork and testnet.

**The schema** (`indexer/schema.graphql`) keeps events as they happened (`Grant`, `Fill`, `Revocation`, `VenueChange`,
`DeskOperatorChange`, `AuditAnchor`) and **derives the rest as they arrive**:

- `Owner`: grants, the cap in force, spend total, closes, allowed venues, and whether the permission is stopped.
- `DailySpend` (`owner-yyyy-mm-dd`): each UTC day's spend against the cap in force that day.
- `Venue`: orders and volume per venue (Kuru, Uniswap v3).
- `Desk`: a Perpl desk's operator, and whether it can still be traded.

**The handlers** do the derivation in one pass. A `Spent` event writes the `Fill`, then brings the owner, the day and the
venue up to date (`indexer/src/handlers/delegation.ts`):

```ts
const day = utcDay(at);
const d = await context.DailySpend.getOrCreate({ id: `${owner}-${day}`, owner, day, spent: 0n, fills: 0, capAtDay: o.dailyCap });
context.DailySpend.set({ ...d, spent: d.spent + event.params.amount, fills: d.fills + 1, capAtDay: o.dailyCap });
```

A `Revoked` with the zero address as delegate is the owner stopping every agent at once, so it marks the `Owner` revoked.

**Perpl desks are discovered, not listed** (`indexer/src/handlers/perpl.ts`). Every desk is created by Perpl's factory;
the handler registers each new one as a contract of its own, so its `OperatorAdded`/`OperatorRemoved` events (xorr's
key, and the owner's one-tap stop) are indexed too:

```ts
indexer.contractRegister({ contract: 'PerplDeskFactory', event: 'DelegatedAccountCreated' }, async ({ event, context }) => {
  context.chain.PerplDesk.add(event.params.proxy);
});
```

**The executor is the API.** The indexer writes into the executor's own Postgres, in a schema of its own
(`ENVIO_PG_SCHEMA`, default `envio`), with Hasura off (`ENVIO_HASURA=false`). `indexedFor()` in `indexed.ts` is one
query per table, run in parallel, plus Envio's `chain_metadata` for how far the index has read: no RPC, no scan.
Amounts stay base-unit strings and are never rounded through a float.

## Engineering notes

**One indexer, two sync modes.** `config.yaml` syncs over RPC (`for: sync`), so the local fork needs no token.
`config.testnet.yaml` is the same indexer with HyperSync carrying the sync and the RPC kept only as a fallback:

```yaml
chains:
  - id: ${ENVIO_CHAIN_ID}
    start_block: ${ENVIO_START_BLOCK}
    rpc:
      - url: ${ENVIO_RPC_URL}
        for: fallback
```

The hosted service selects it with `ENVIO_CONFIG=config.testnet.yaml`. This mattered on Monad testnet: the public RPC
rate-limits (the team-seeded evidence records 15 requests a second), and the index starts at the delegation's deploy
block, 65,123,156.

**Hosting.** The indexer is a second service in the Railway project `xorr-metropolis`, beside the executor and sharing
its Postgres (runbook: `docs/DEPLOY-LATER.md` §5). Getting it to start in production took more than the local setup:
the `HASURA_GRAPHQL_ENDPOINT`/`_ROLE`/`_ADMIN_SECRET` variables, `ENVIO_PG_SSL_MODE=false`, and the two
`ENVIO_THROTTLE_*` values all had to be set.

**Public by design, honest by label.** `/indexed` is per wallet and behind sign-in. `/indexed/recent` is public (the
fills are on chain already) and every place it appears says the fills are everyone's.

**Tests:**

- `server/src/routes/indexed-recent.test.ts`: a fill row in words; an unknown token keeps its address and no amount.
- `src/data/indexedRecord.test.ts`: the History card's lines, a stopped permission and desk, an empty record.
- `src/data/recent.test.ts`: "Bought with $… through Kuru", "Sold … through Uniswap v3".

**History:**

| Commit | Change |
|---|---|
| `626d1d6` | The indexer, `/indexed`, and History's card (6 Oct) |
| `93ad175` | Empty History and Runs show everyone's latest fills (9 Oct) |
| `d338a20` | Testnet config: HyperSync first, RPC as fallback (13 Oct) |

## The value Envio brought

**A complete record instead of a window.** The owner sees totals since the contract was deployed, and today against the
cap, as the contract itself counted it. A bounded scan can't say either.

**Derived state for free.** "Can this desk still be traded?" and "how much of today's cap is used?" are answered by
reading one row, because the handlers keep those rows current as events arrive. The app never replays logs.

**Dynamic contracts.** Perpl desks are created by users at any time. Envio's `contractRegister` follows each one from its
creation, so the owner's stop is in the index as soon as it is on chain.

**Fork to testnet with one file.** The same schema and handlers ran on a local fork of Monad mainnet over RPC and on
testnet over HyperSync; only the sync line differs.

## Live proof (Monad testnet)

Read on 13 Oct, 23:20 UTC, from the hosted executor:

- `GET /monad/sponsors` (the `/monad` row): `"processedBlock": 70810020, "chainHead": 70810077, "behind": 57,
  "events": 225, "fills": 0`. The index is live and within a minute of the head.
- `GET /indexed/recent`: `{"fills":[]}`.

**The honest limitation.** Spot fills (`Spent`/`Closed`, the `Fill` table behind `/indexed/recent`) come from buys on
Kuru and Uniswap v3, and **Monad testnet has no spot venue for them**. So on testnet that feed is empty, and the 225
events are the record's other event types (grants, revokes, venue changes, desk operators, anchors). Testnet's trades go through
Perpl desks, which the index follows through the factory. Spot fills are indexed on the local fork of Monad mainnet, and
the demo video's History step (`docs/demo/xorr-demo.mp4`, tagged as the fork on screen) shows the "Indexed by Envio" card
there.

**Check it yourself:**

- https://executor-monad-testnet-production.up.railway.app/monad/sponsors (the `envio` field)
- https://executor-monad-testnet-production.up.railway.app/indexed/recent
- https://xorr-metropolis.vercel.app/monad (Built on Monad, the Envio row)
- Public config, schema and handlers: `indexer/` in https://github.com/nickthelegend/xorr-metropolis
