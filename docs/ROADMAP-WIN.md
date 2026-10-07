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

## Status

Tracked in `PLAN.md` (phase P-I) as each lands.
