# How xorr uses Chainlink CRE and Chainlink Data Feeds

xorr is a council of AI agents that trades for you on Monad, inside a limit you sign and the chain enforces. Before any
trade is sent, its price is checked against Chainlink. On Monad mainnet that check reads Chainlink's Data Feeds directly.
Monad testnet, where xorr's agents trade MON perps on Perpl, has **no Chainlink MON/USD feed**. A Chainlink CRE workflow
(`cre/mon-price`) supplies one there.

## What Chainlink does in the product

Every trade goes to five seats. The two that read Chainlink are:

| Seat | Reads | Can veto? |
|---|---|---|
| Price Desk | Chainlink's price and its age, compared with the price the fill would get (Kuru's book or Perpl's) | Yes |
| Trend Reader | the asset's recent Chainlink rounds on Monad mainnet | No |

The **Price Desk** (`priceDesk` in `server/src/council/personas.ts`) vetoes the round in three cases:

- **Halted:** the reference says halt (on testnet, the CRE report's `halt` flag);
- **Stale:** the round is older than its 60-minute heartbeat;
- **Too far:** the fill is more than 150 bps from Chainlink.

An order placed by hand goes through the same check (`manualPriceGate` in `server/src/council/monad-inputs.ts`), so an
agent and a person pressing Buy are held to the same rule. If the price can't be checked, nothing is placed.

**Data Feeds** (`server/src/monad/chainlink.ts`) are Chainlink's proxies on Monad mainnet for MON, ETH, BTC, USDC and AUSD.
Each one is read with `latestRoundData()`. A round older than `maxAgeSec` is reported as stale and never used as a price.

**CRE** gives testnet the MON/USD price it lacks: a median checked against Chainlink, with a halt flag, written on chain
by the workflow.

## How the CRE workflow works

**Code:** `cre/mon-price/workflow.ts` (TypeScript, `@chainlink/cre-sdk`). Config is in `config.staging.json` and the
RPCs are in `cre/project.yaml`.

```
cron (every 5 min)
 ├─ HTTP with consensus (median across the DON): Perpl's MON mark, from Perpl's public context
 ├─ EVM read, monad-mainnet: Kuru's MON/USDC book, bestBidAsk()
 ├─ EVM read, monad-mainnet: Chainlink MON/USD 0xBcD7…22fb, latestRoundData() and decimals()
 └─ assess → runtime.report → writeReport on monad-testnet → XorrPriceReceiver
```

**The Perpl mark is agreed by the DON, not read by one node:**

```ts
perpl = new cre.capabilities.HTTPClient()
  .sendRequest(runtime, fetchPerpl, ConsensusAggregationByFields<{ perplMark: number }>({ perplMark: median }))(config)
  .result().perplMark
```

**EVM reads use the last finalized block** (`call()` passes `blockNumber: LAST_FINALIZED_BLOCK_NUMBER`).

**`assess()`** is a pure function, which is what the tests run. It returns:

- the median of the prices that answered, in 8 decimals;
- the number of sources;
- Kuru's spread;
- the furthest a market (Perpl or Kuru) sits from Chainlink.

It sets `halt` if:

- Chainlink's round is older than `maxAgeSec` (3600);
- a market sits more than `maxAnchorGapBps` (150) from Chainlink;
- fewer than two sources answered.

A stale Chainlink round is left out of the median rather than used.

**The report and the write:**

```ts
const report = runtime.report(prepareReportRequest(encodeReport(a, observedAt))).result()
const write = evmFor(config.writeChain, true)
  .writeReport(runtime, { receiver: config.receiver as Address, report, gasConfig: { gasLimit: config.gasLimit } })
  .result()
```

`encodeReport` ABI-encodes `(int256 answer, uint8 sources, uint16 spreadBps, uint16 anchorGapBps, bool halt, uint64 observedAt)`.
`observedAt` is the cron's scheduled time.

**The consumer:** `contracts/src/XorrPriceReceiver.sol` extends Chainlink's `ReceiverTemplate`, vendored from
`smartcontractkit/cre-templates` into `contracts/src/cre/`, so only the forwarder can call `onReport`.

- `_processReport` decodes the report and refuses a report with no price unless it is a halt (`NoPrice`).
- It refuses a late or replayed report (`StaleReport`), so rounds only move forward.
- It emits `PriceReported`.
- It serves `latestRoundData()` in AggregatorV3's shape, so code written for a Chainlink feed reads it unchanged. It
  also has `latestObservation()` and `halted()`.

**Where the executor reads it:** `server/src/monad/cre-price.ts` (`creMonUsdReceiver`, `readCrePrice`). In
`anchorOf()` (`council/monad-inputs.ts`), on `monad-testnet` for MON with `CRE_MON_USD_RECEIVER` set, the reference is
the receiver's latest observation, and its `halt` becomes the Price Desk's veto. Before the receiver's first report
(`NoRound`), and for every other symbol, the reference is Chainlink's Monad mainnet feed.

## Engineering notes

**Simulated, then broadcast; not deployed to a DON.** The report on chain was written with
`cre workflow simulate ./mon-price --target staging-settings --trigger-index 0 --broadcast`. This used CRE's
**simulation forwarder** on Monad testnet (`MockKeystoneForwarder`, `0xB9F79d863261869B234c481D1f9A7af84AeAd192`), which
is what the receiver was constructed with. The chain shows it: the report tx is sent by the team's deployer key to
`0xB9F7…D192`, and `getForwarderAddress()` on the receiver returns that address. The workflow has **not** been deployed
to a production DON, so the cron does not run on its own. Deploying it would need Chainlink's `cre account access`
approval and a `setForwarderAddress` call to the production forwarder (`0xF8344CFd5c43616a4366C34E3EEE75af79a74482`).

**Kuru's empty side is not a price.** Kuru quotes `2^256−1` or `0` for a side with no resting order. `kuruSide()` reads
both as absent, so an empty book can't drag the median.

**One answer from three sources, cross-checked.** Perpl comes over HTTP, and Kuru and Chainlink from EVM reads. Chainlink
is both a source and the anchor that the other two are measured against.

**Tests:**

- `cre/mon-price/workflow.test.ts` (`bun test`, 7 tests): the median, each halt, Kuru's empty side, the report encoding
  round-tripped against the receiver's ABI, Perpl's parsing.
- `contracts/test/XorrPriceReceiver.t.sol` (7 forge tests): forwarder-only, rounds only move forward, halts stored, no
  price only as a halt, nothing to read before the first report.
- `server/src/council/monad-cre-gate.test.ts` (4 tests): the gate passes near the CRE price, refuses on halt, measures
  the fill against the CRE price, and falls back to mainnet Chainlink before the first report.

**History:**

| Commit | Change |
|---|---|
| `602e11f` | The workflow, the receiver, and the executor's gate reading it |
| `4db15dc` | Receiver deployed on testnet and Sourcify-verified; first broadcast report |

## The value Chainlink brought

**A price gate that is the same everywhere.** On mainnet the gate uses Chainlink Data Feeds; on testnet it uses a CRE
report anchored to the same MON/USD feed. The Price Desk code doesn't change. The receiver speaks AggregatorV3, so the
gate reads a feed-shaped contract either way.

**Refusal is first-class.** A stale round, a market too far from Chainlink, or too few sources each stop the trade, and
the reason is written into the round. CRE puts the halt decision on chain, signed in the report, instead of leaving it
to the executor.

**An orchestration layer, not a script.** The workflow joins an external API (Perpl), two on-chain reads on another
chain (Kuru and Chainlink on Monad mainnet), DON consensus, and a verified consumer contract on testnet. Without it,
testnet MON could only be checked against a price the executor fetched for itself.

## Live proof (Monad testnet)

**The receiver:** `XorrPriceReceiver`, exact match on Sourcify (verified 13 Oct).

- Contract: https://testnet.monadvision.com/address/0x5309e806fA530426c0ad72F22D15E473F9b7aD42
- Deploy tx: https://testnet.monadvision.com/tx/0x11847c1d661bb75230ea78e75fbb59e1342d95a71de31abf41137a7dfb92b05c
- Constructor: forwarder `0xB9F79d863261869B234c481D1f9A7af84AeAd192`.
- Recorded in `contracts/deployments/monad-testnet.json`.

**The report** (13 Oct, from `cre workflow simulate --broadcast`):
https://testnet.monadvision.com/tx/0x0a228a1365c0873ca5c5f8d02b96fb818bd809a4ede68f3a1fb4977fe49fc101

The tx succeeded and the receiver emitted `PriceReported` for round 1:

| Field | Value |
|---|---|
| MON/USD | 0.023975 |
| Sources | 3 |
| Kuru spread | 14 bps |
| Gap to Chainlink | 7 bps |
| `halt` | false |
| `observedAt` | 1791894000 (12:20 UTC) |

`latestRoundData()` returns round 1 with that answer, and `halted()` returns false.

**The hosted executor reads it.** Team-seeded round 1 (13 Oct, 16:06 UTC) proposed "buy $50 of MON". Its price input
names the receiver: *"Chainlink CRE MON/USD 0x5309…aD42 on Monad testnet (median of 3: Perpl, Kuru, Chainlink
mainnet)"*, at $0.023975, updated 12:20 UTC.

- **Veto:** the Price Desk vetoed with *"Stale: Chainlink $0.02397 (226 min old), past its 60 min heartbeat."*
- **Why it went stale:** the workflow had run once, as a simulation, rather than on a deployed cron, so the report aged
  past the heartbeat.
- **What the gate did:** it refused to trade MON blind. The seeded rounds then proposed BTC, which is checked against
  Chainlink's mainnet feed.
- **Round 1:** https://executor-monad-testnet-production.up.railway.app/council/public/1
- **All seeded rounds:** `docs/evidence/seed-13oct.md`. Rounds 1–7 were vetoed.

**Data Feeds in every round.** The Trend Reader in the same round cites "Chainlink MON/USD
0xBcD78f76005B7515837af6b50c7C52BCf73822fb on Monad mainnet, 8 rounds". The BTC rounds that filled (8–11) were priced
against Chainlink's BTC/USD feed on Monad mainnet.

## Update, 14 Oct

A second run, `cre workflow simulate ./mon-price --target staging-settings --trigger-index 0 --broadcast`, is the one
recorded in the bounty video (`docs/demo/bounty-cre.mp4`).

**The report it wrote:**

| Field | Value |
|---|---|
| MON/USD | 0.02439 |
| Sources | Perpl 0.024401, Kuru 0.024365 / 0.024395, Chainlink 0.02439 |
| Spread | 12 bps |
| Gap to Chainlink | 5 bps |
| Halt | false |

**The transaction:** it went through CRE's simulation forwarder to XorrPriceReceiver on Monad testnet:
https://testnet.monadvision.com/tx/0xbc53d1bc8a9049db723a5d2f3bb71a93cb6ba82d732b795838c2025183753d93

This refreshed the stored price that had aged out on 13 Oct. The CLI's own output is kept at
`video/cre-run-2026-10-14.json`.
