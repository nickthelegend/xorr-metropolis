# xorr × Chainlink CRE — a MON/USD price for Monad testnet

xorr's agents trade MON perps on Perpl's testnet, and every order passes a price gate first: the fill against Chainlink,
refused past 150 bps or on a stale round. Monad testnet has **no Chainlink MON/USD feed** (its five feeds are BTC, ETH,
USDC, USDT and LINK). This CRE workflow is the orchestration layer that brings one there, built from the markets it gates:

```
cron (every 5 min)
 ├─ HTTP with consensus (median across the DON) — Perpl's MON mark, from Perpl's public context
 ├─ EVM read, monad-mainnet — Kuru's MON/USDC book: best bid and ask
 ├─ EVM read, monad-mainnet — Chainlink MON/USD: latest round, its age
 └─ assess → report → writeReport, monad-testnet → XorrPriceReceiver
```

The report is the median of the prices that answered, Kuru's spread, how far the markets sit from Chainlink, and a
**halt** when a market is more than 150 bps from Chainlink, Chainlink's round is over an hour old, or fewer than two
sources answered.

**Where it is used.** `contracts/src/XorrPriceReceiver.sol` extends Chainlink's `ReceiverTemplate` (only the forwarder may
write; rounds only move forward) and answers `latestRoundData()` in AggregatorV3's shape. On the testnet build, with
`CRE_MON_USD_RECEIVER` set, the executor anchors MON to it (`server/src/monad/cre-price.ts`): the council's price desk
vetoes and a manual order is refused while the report says halt, and every fill is measured against the CRE price. Before
the receiver's first report, the gate reads Chainlink's mainnet feed as before.

| File | |
|---|---|
| `mon-price/workflow.ts` | The workflow: trigger, HTTP consensus, EVM reads, `assess`, the report and the write |
| `mon-price/workflow.test.ts` | `bun test`: the median, each halt, Kuru's empty side, the report encoding, Perpl's parsing |
| `mon-price/config.staging.json` | Addresses: Perpl market 10, Kuru `0x065C…C394`, Chainlink MON/USD `0xBcD7…22fb`; `receiver` once deployed |
| `project.yaml` | RPCs for `monad-testnet` and `monad-mainnet` |
| `../contracts/src/XorrPriceReceiver.sol` | The consumer; `forge test --match-contract XorrPriceReceiverTest` (7 tests) |

## Status (2026-10-05)

- Built and tested: the workflow typechecks, its 7 tests pass, and it compiles to WASM locally
  (`npx cre-compile main.ts out.wasm`, 2.7 MB). The receiver's 7 forge tests pass; the executor's gate has 4 tests on the
  testnet path (`server/src/council/monad-cre-gate.test.ts`).
- **Not yet simulated**: the CRE CLI refuses every command, `init` included, until `cre login`.
- **Receiver not yet deployed**: deploying it costs about 0.12 MON on Monad testnet (1.14M gas at 102 gwei), more than any of
  this project's testnet keys holds.

## Run it

```bash
cre login                                    # once, in a browser
cd cre/mon-price && bun install && bun test
cd .. && cre workflow simulate ./mon-price --target staging-settings --trigger-index 0
```

To write a real report on Monad testnet (`--broadcast`), deploy the receiver with CRE's **simulation** forwarder
(`MockKeystoneForwarder` on testnet: `0xB9F79d863261869B234c481D1f9A7af84AeAd192`), put its address in
`mon-price/config.staging.json` → `receiver` and in the executor's env as `CRE_MON_USD_RECEIVER`, put a funded testnet key
in `cre/.env` as `CRE_ETH_PRIVATE_KEY`, then:

```bash
cd contracts && forge create src/XorrPriceReceiver.sol:XorrPriceReceiver --constructor-args 0xB9F79d863261869B234c481D1f9A7af84AeAd192 --rpc-url https://testnet-rpc.monad.xyz --private-key "$KEY" --broadcast
cd ../cre && cre workflow simulate ./mon-price --target staging-settings --trigger-index 0 --broadcast
```

A deployed workflow writes through the production forwarder instead (`0xF8344CFd5c43616a4366C34E3EEE75af79a74482` on
testnet): `setForwarderAddress` on the receiver when it moves.
