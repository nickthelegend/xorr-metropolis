# Roadmap to win — a judge's-eye review (7 Oct)

**How this was done.** The running app on the local fork, met the way a judge meets it: five minutes, no context, a
laptop at 1440 × 900 first and then a phone at 390. Built on the scored screens (`docs/screens/REVIEW.md`, 103 screens,
average 4.09) and the recorded flows (`docs/demo/flows/`) — a review of what a judge *takes away*, not of each screen's
craft, which REVIEW.md already covers.

**What judges weigh.** Main track: product quality, technical excellence, Monad integration, track fit and innovation,
20% each. Bounties: meeting the stated requirement 40%, technical 30%, Monad integration 20%, innovation 10%.

## The 10 biggest weaknesses, by what each costs with judges

| # | Weakness | What a judge sees | What it costs |
|---|---|---|---|
| 1 | **Monad's advantage is told, not shown.** | The block time is a sentence in the README (and was out of date: "400 ms", where MIP-12 made it 300 ms). In the app, a fill's receipt shows a hash — no time, no block, no cost. Nothing shows the chain is live and fast. | Monad integration (20% of the main track, 20% of every bounty). The single biggest gap. |
| 2 | **The first 60 seconds don't say what xorr is.** | Welcome says "a bot that trades while you get on with your life", then a wallet form. The three ideas that make it different — a council votes on every trade, the chain enforces the limit, one hold stops everything — appear nowhere before sign-up. | Product quality and track fit: a judge decides in a minute what this is. |
| 3 | **The council — the core idea — reads as a wall of text after the fact.** | Four paragraphs of desk reasons under a verdict. The deliberation (the readings, each desk's vote, the verdict, the fill, in seconds) is invisible, and there is no moment worth showing in a video. | Innovation and product; the demo has no "wow". |
| 4 | **Bounty evidence lives in docs, not in the app.** | Kuru, Perpl, Chainlink, AUSD, Envio, Mera, Kimi, CRE and MetaMask are named in the README. In the app, the Sources screen lists six sources in grey text. A bounty judge cannot point at "Kuru's live book" or "Envio's index at block N". | The 40% "meets the stated requirement", on every bounty. |
| 5 | **The agents' depth is buried.** | Home shows four "Not hired" faces. The strategy library — 313 strategies run through a gauntlet with out-of-sample tests, 10 survivors — is a tab under the agents, a list of names. | Technical excellence and innovation: the work that would most impress is the least visible. |
| 6 | **Too many secondary screens.** | 116 routes from four builds; Explore lists twenty links, several generic (Disposals, Export). A judge who wanders leaves the story. | Product focus. |
| 7 | **Kimi reads as unfinished.** | "The Strategist seat (Kimi) is not configured on this executor — it needs MOONSHOT_API_KEY." Honest, but it is the first line under the Council's title. | Polish on the Kimi credits; needs the key to fix properly. |
| 8 | **Live flows are on a fork.** | The app says "Monad fork"; the testnet transactions are from 24 Sep. | Bounties that ask for "deployed on Monad with transactions". Needs the owner's testnet go. |
| 9 | **The phone app is shown in a phone browser.** | Agora asks for a mobile app with Mera; the native passkey path is built but not run on a device. | Agora's 40%. Needs the passkey domain and a device. |
| 10 | **A new account has nothing to watch.** | History, Activity and Runs are empty until a trade; the empty states are honest and lit, but there is no motion until the first fill. | First impression. |

## The plan: impact × effort

Only what needs no MON and no key, and fits this wave. Impact is what it moves with judges (weaknesses above); effort is
build plus tests plus screenshots.

| Improvement | Fixes | Impact | Effort | Pick |
|---|---|---|---|---|
| **Monad speed receipt** — send-to-confirm in ms, block, gas, cost on Monad against the same call on Ethereum, and Monad mainnet's live cadence | 1 | 5 | 3 | **F1** |
| **First-run explainer** — three steps before sign-up, the last with Monad live | 2 | 5 | 2 | **F2** |
| **Council replay** — each desk's readings and vote, one by one, then the verdict and the fill with its speed | 3 | 4 | 3 | **F3** |
| **Built on Monad** — every sponsor integration with a live reading from it, named for its bounty | 4 | 4 | 3 | **F4** |
| **The strategy gauntlet** — the library as a browsable page: 313 tested, the survivors' out-of-sample numbers | 5 | 3 | 2 | **F5** |
| Trim Explore to the Monad story | 6 | 2 | 1 | next |
| Friendlier Kimi line | 7 | 1 | 1 | next |
| A "what you'll see here" preview on empty History | 10 | 2 | 2 | next |
| Testnet re-run, phone run | 8, 9 | 4 | — | needs the owner |

## Acceptance criteria

**F1 — Monad speed receipt.**
- Every fill records, from its own receipt: the time from broadcast to confirmation in ms, the block, gas used, the gas
  limit and the price paid (executor; a migration).
- `GET /monad/pulse` (public): Monad mainnet's head block and its block interval measured over the last 100 blocks,
  Monad's gas price, and Ethereum mainnet's gas price from a public RPC (null when it cannot be read).
- `GET /speed/:tx` (the owner's own fills): that fill's speed and cost — on Monad, the gas limit at the price paid in MON
  at Chainlink's MON/USD (Monad bills the limit); and the same gas used on Ethereum at today's price and Chainlink's ETH/USD.
- The Run receipt shows a speed card; a council round says how long it took from the vote to the fill.
- Honest about the fork: a fork seals a block on each send, so the card says so and shows Monad mainnet's measured cadence
  beside it. No number is invented: a value that could not be read is absent.
- Unit tests for the cost and cadence arithmetic; the e2e checks the card renders a time and Monad's live block.

**F2 — First-run explainer.**
- "Get started" opens three steps before the wallet: the council (its five faces), the limit the chain enforces (cap,
  end date, venues; it cannot withdraw), and the stop — with Monad mainnet's live block and cadence from `/monad/pulse`.
- Skippable; shown once (remembered on the device); reachable again from Settings.
- e2e walks the three steps to the wallet screen; screenshots at 390 and 1440.

**F3 — Council replay.**
- Each round has "Replay" (`/council/<id>`): the proposal, then each desk's readings (from the round's recorded inputs)
  and its vote, one at a time, then the verdict, then the transaction with its speed receipt and the time from the vote
  to the fill.
- Play and play-again; under reduced motion everything is shown at once.
- e2e: convene a round, open its replay, every seat and the verdict appear.

**F4 — Built on Monad.**
- One screen, every sponsor integration with a live reading from it: Kuru (book mid and spread), Uniswap v3 (the pool
  price), Chainlink (MON/USD and its age), Perpl (open markets and interest), Agora AUSD (its peg), Envio (indexed block
  against the chain head), Mera (this session), Kimi (sits or not, and why), Chainlink CRE (the receiver set or not),
  MetaMask (the `mm perpl` plugin and its commands).
- Each card names its bounty and links to where the app uses it. A reading that failed says so; nothing is filled in.
- Reachable from Home and Settings; e2e: renders with live values and no error.

**F5 — The strategy gauntlet.**
- A browse page for the library: the headline (how many tested, how many survived), filter by family, and a card per
  strategy with its out-of-sample return, drawdown, Sharpe and trades; survivors first; tap opens the existing detail.
- Reachable from Home's Strategies tab and Explore; e2e: lists strategies with their numbers.

Each feature: real fork data, unit and e2e tests, console and network clean, before and after at 1440 and 390 in
`docs/screens/wave/`, one commit, pushed, CI green.

## Monad-native coverage (7 Oct, the user: "all Monad tech in every project")

One line per item of `MONAD-TECH.md`. Where it runs is said the same way in the app (`/monad`, "Built on Monad"): live
on Monad mainnet or testnet, the local fork, or awaiting the testnet go. A fork's timing is never shown as Monad's.

| # | Item | Status | Where it runs | In xorr | Evidence |
|---|---|---|---|---|---|
| 1 | Commit states (`monadNewHeads`) | **built · live read** | Monad mainnet's WebSocket, one lazily opened subscription | [`server/src/monad/commits.ts`](../server/src/monad/commits.ts), [`src/speed/CommitStrip.tsx`](../src/speed/CommitStrip.tsx): the explainer's Monad step, every fill's speed card, `/monad` | voted ~290 ms, final ~560 ms, verified ~1.5 s (medians, 7 Oct); `e2e:explainer` requires live finalized blocks; `screens/wave/m1-*` |
| 2 | Two-timer receipts (`eth_sendRawTransactionSync`) | **built · fork now; final timer awaiting testnet go** | every fill on the executor's chain (anvil implements the method); "final" only means something on a Monad network | [`server/src/evm/send.ts`](../server/src/evm/send.ts), `delegation.ts` `sendCall`, `executor/run.ts`, the speed card | fork fills executed in 150–971 ms with the receipt returned by the send; `e2e:fork`; `screens/wave/m2-*` |
| 3 | `txpool_statusByHash` | **built · live read on mainnet; none on the fork** | the executor's "is this hash pending or absent" check on Monad networks; `/monad/txpool/:hash` | [`server/src/monad/txpool.ts`](../server/src/monad/txpool.ts), `evm/delegation.ts` `waitForReceipt` | mainnet answers; anvil "method does not exist"; on `/monad` |
| 4 | Passkeys on chain (Mera + P256 `0x0100`) | **built · live `eth_call` on mainnet and the fork** | "Check my passkey on Monad" on `/monad` (web) | [`server/src/monad/passkey-p256.ts`](../server/src/monad/passkey-p256.ts), [`src/monad/passkeyCheck.ts`](../src/monad/passkeyCheck.ts) | `e2e:monad`: a passkey's own signature valid on mainnet's and the fork's `0x0100`, the same signature over another message refused; `screens/wave/f4-monad-passkey-*` |
| 5 | Native staking (`0x1000`) | **live read · delegating awaits testnet go** | Monad mainnet, through `@monad-crypto/viem` | [`server/src/monad/native.ts`](../server/src/monad/native.ts) | epoch, delay period, the proposing validator, its stake and commission, on `/monad` |
| 6 | Gas correctness | **built · measured on the fork; `0x1001` live read** | the executor's limits and fees; the reserve rule before any MON moves | [`server/src/evm/gas-limit.ts`](../server/src/evm/gas-limit.ts), [`gas-price.ts`](../server/src/evm/gas-price.ts), [`monad/reserve.ts`](../server/src/monad/reserve.ts), [`docs/MONAD-GAS.md`](MONAD-GAS.md) | a Kuru fill declares 424,989 gas, not 502,260 (−15% billed); the fee before an order in MON on the declared limit (it was priced as ETH, ~100,000× high); reserve rules unit-tested; 128 KB and storage notes |
| 7 | Payments (x402 via Monad's facilitator) | **built · facilitator read live; settlement awaits testnet go** | Monad testnet (`eip155:10143`), Circle's testnet USDC | [`server/src/monad/x402.ts`](../server/src/monad/x402.ts): `POST /x402/council`, the council's market read at $0.01 | [`evidence/x402-live-2026-10-07.txt`](evidence/x402-live-2026-10-07.txt): Monad's facilitator refused an unfunded signed payment (`insufficient_funds`); the paid path tested with the official client |
| 8 | Canonical contracts | **built · checked live on mainnet and the fork** | WMON, USDC and Multicall3 used; Permit2, EntryPoint and CreateX present, unused, and said why | [`server/src/monad/native.ts`](../server/src/monad/native.ts) `CANONICAL`; `monad/mainnet.ts` batches through Multicall3 | code present on both; `XorrDelegation` and `XorrAuditAnchor` Sourcify-verified on MonadVision; `screens/wave/f4-monad-contracts-*` |

Not taken, and why: `@monad-crypto/mpp` (x402 is the one payments rail, through Monad's own facilitator; a second rail
would be the same feature twice); EIP-7702 gasless onboarding (the agents already sign as their own EOAs under the
delegation contract, and on Monad a 7702-delegated account's transactions revert when they leave it under 10 MON, where
the agents hold ~0.05 MON for gas);
the Execution Events SDK and Monad Solonet (both need a Linux Monad node on the machine).

## Wave 2 (8 Oct, the user: "start the next 5 for all of them, keep going")

The "next" rows of the plan above, with the two that need the owner swapped for the next-best items that do not:

| | Improvement | Fixes | Instead of |
|---|---|---|---|
| W1 | **Explore tells the Monad story first** | 6 | |
| W2 | **A friendlier Kimi line** | 7 | |
| W3 | **Empty screens preview what will appear**, with real fills from Envio's index | 10 | |
| W4 | **For judges: every bounty's requirement, met where in the app** | 4 | testnet re-run (needs the go and MON) |
| W5 | **Speed history: a wallet's recent fills, timed and gas-checked** | 1 | phone run (needs the passkey domain and a device) |

Acceptance criteria:

- **W1.** Explore opens on the story — Built on Monad, the council and its replay, the gauntlet, how xorr works — and
  shows at most twelve links before a tap; every other screen stays one tap away under "Everything else"; no route is
  removed (the crawl still opens all of them).
- **W2.** The Council no longer leads with "not configured". The first line under its title is what the council is; the
  Strategist seat on the bench says, on the seat, that Kimi sits when its key is set, and the full sentence stays on the
  screen below. `e2e:flows` B7 still passes.
- **W3.** A new account's History and Runs show, until it has its own, the latest fills on xorr read from Envio's index —
  labelled as everyone's, not theirs, addresses shortened — and Monad's blocks going final. Nothing invented; once the
  account has a fill, its own record replaces the preview.
- **W4.** `/judges`: each bounty in SUBMISSION with its stated requirement, the screen that meets it (a link that
  opens), a live reading where one exists, and its evidence. e2e opens every link with no error.
- **W5.** The Runs screen leads with the wallet's recent fills as a speed history: each one's time to executed, the
  median, and the gas declared against used. Real rows from the executor; absent with no fills.

Same rules as wave 1: real data, unit and e2e tests, console and network clean, before and after at 1440 and 390 in
`docs/screens/wave2/`, one commit each, pushed, CI green.

## Status

Tracked in `PLAN.md` (phases P-I and P-J) as each lands. Wave 1 (F1–F5) and the Monad-native items done 7–8 Oct; wave 2 under way.
