# Zero-mock test plan — xorr on Monad (6 Oct)

Every component and flow, what "correct" means for it, and its status from a real run today. **PASS** = run for real and
matched exactly; **FAIL** = did not (and was then fixed — see §7); **UNTESTED** = cannot be run without a real dependency
this machine does not have (named). Never PASS on assumption.

**Where it ran.** The local stack (`sh infra/monad-fork/local-stack.sh up`): an anvil fork of Monad mainnet with Perpl's,
Kuru's, Uniswap's, Chainlink's and Agora's real contracts; our contracts deployed on it; the executor with its real
Postgres; the Envio indexer; the web app. Every on-chain step is a real signed transaction on that chain. Monad testnet
itself is on hold until the owner says go.

**How it ran.** Chromium driven by Playwright with a WebAuthn virtual authenticator that has PRF — the only browser on this
machine that can hold a PRF passkey (Claude in Chrome had no connected browser; the app pane has no PRF provider). Every
browser step fails on any console error and on any API response ≥ 400. Specs: `e2e/web/fork-journey.mjs`,
`e2e/web/flows.mjs`, `e2e/web/crawl.mjs` (all at 375 px except the journey at 390); proofs: `server/src/prove-monad.ts`,
`server/src/prove-perpl-desk.ts`. Evidence: `docs/evidence/*-2026-10-06.txt`.

## 1. Flows

| # | Flow | Correct means | Status | Evidence |
|---|---|---|---|---|
| F01 | Create a passkey account (Mera) | one ceremony, an address from the PRF output, an executor session; nothing that signs stored | PASS | journey 1 |
| F02 | Fund from the fork faucet | "Added 1,000.00 USDC." and the balance on chain | PASS | journey 2 |
| F03 | Grant the permission | Mera's signing session signs, no popup; confirmed on chain; ≤ 10 s from the app on screen | PASS (3.1–5.6 s) | journey 3 |
| F04 | Stateless sign-in | storage cleared → "Sign in with a passkey" → the same address | PASS | journey 4 |
| F05 | Buy MON from the ticket | "Bought …"; the run names the venue and what the other venue would have delivered | PASS | journey 5 |
| F06 | History, indexed by Envio | the card states the spend, today against the cap, venues, the block read to | PASS | journey 6 |
| F07 | Perpl desk: test funds, create, fund, allow | AUSD in the wallet; desk on Perpl's factory; account opened | PASS | journey 7 |
| F08 | Perpl long and close | position with entry, mark, liquidation; closed to "No open positions" | PASS | journey 8 |
| F09 | Hold to stop | "Trading stopped"; permission revoked; the desk's operator inactive, read back from the chain | PASS | journey 9 |
| F10 | Zero amount | the Buy button is disabled | PASS | flows E2 |
| F11 | More than the wallet holds | "You have $1,000.00." and the button disabled | PASS | flows E1 |
| F12 | Close a holding | the position is gone; USDC back | PASS | flows B6 |
| F13 | Private note | sealed with the second PRF key, the server holds ciphertext only, reopens after a reload | PASS | flows B15 |
| F14 | Send to an allowlisted address | a new address waits 24 h (shown "Pending"); once usable, 5 USDC arrives, read on chain | PASS (cooling-off backdated in the test database) | flows B12 |
| F15 | Council round | four desks vote on live readings; "Approved 4–0. Executed"; Kimi shows "not configured" | PASS | flows B7 |
| F16 | Hire an agent; it trades by itself | Yield Keeper convenes the council and its buy executes with its own key | PASS | flows B8 |
| F17 | Signing window lock | page load = locked; a signature opens it; Lock closes it; the next signature asks the passkey again | PASS | flows B16 |
| F18 | Executor unreachable | "Can’t reach xorr. Your funds and your permission are on chain and unaffected." + Try again; recovers | PASS | flows E3 |
| F19 | Daily cap on chain | the executor refuses; a raw spend over the cap mines as `DailyCapExceeded` | PASS | `prove-monad.ts` |
| F20 | Revoke on chain | the executor refuses; a raw spend mines as `PolicyRevoked()` | PASS | `prove-monad.ts` |
| F21 | Perpl exit guard | a live position closed by rule, the reason in Activity | PASS | `prove-perpl-desk.ts` 6b |
| F22 | Perpl per-order cap | "$300 is over your $250 per-order limit" before signing | PASS | `prove-perpl-desk.ts` 5 |
| F23 | Perpl operator removed | executor refuses; a raw operator order reverts on chain (`OnlyOwnerOrOperator`); withdrawal reaches the owner | PASS | `prove-perpl-desk.ts` 7–8 |
| F24 | Email sign-in (Privy) | an emailed code signs in to the embedded wallet | UNTESTED (not re-run on 6 Oct; last passed 24 Sep) | — |
| F25 | Any flow on Monad testnet | the same flows with testnet MON | UNTESTED (awaiting the owner's testnet go and MON) | — |

## 2. Screens (116 routes)

**Correct means:** signed in with funds, a permission and a fill, the route renders its content with no console error, no
API response ≥ 400, no error state, no copy naming an older xorr chain, and no sideways scroll at 375 px; a route this build
hides on Monad shows its own "not here" page. **PASS — 91 render, 25 hidden as designed, 0 failures**
(`docs/evidence/crawl-fork-2026-10-06.txt`).

## 3. Executor endpoints (169)

**Correct means:** every endpoint a screen or flow calls answers 2xx with real data (or a deliberate, worded refusal) —
exercised by §1 and §2 with the network checked — and each route group has its own unit tests. **PASS**: no response ≥ 400
in any run above except the refusals a step expected; executor suite 1,545 tests green.

## 4. Contracts

| # | Correct means | Status |
|---|---|---|
| C1 | `forge test` (66 + a fork test) | PASS |
| C2 | XorrDelegation on chain: grant, spend via Kuru and Uniswap, close, cap, revoke, venue allowlist | PASS (§1 F03, F05, F12, F19, F20) |
| C3 | XorrAuditAnchor: heads anchored per wallet | PASS (executor log: wallets anchored each sweep) |
| C4 | KuruVenue: buys and sells through Kuru's book | PASS (fills "via kuru" on the fork, 5–6 Oct) |
| C5 | XorrPriceReceiver: a CRE report written on chain | UNTESTED (`cre login`, then a simulate with `--broadcast`) |
| C6 | slither | PASS (every finding triaged; `quality-gate-2026-10-06.txt`) |

## 5. External integrations

| # | Correct means | Status |
|---|---|---|
| X1 | Chainlink: the fill held to the feed (the fork's own on a fork) | PASS |
| X2 | Kuru's book: read, measured, filled | PASS |
| X3 | Uniswap v3: quoted and filled | PASS |
| X4 | Perpl: public API (risk screen, marks) and the Exchange (orders) | PASS |
| X5 | Agora AUSD: balance and Perpl margin | PASS |
| X6 | Envio HyperIndex: events and derived entities, read by `/indexed` | PASS |
| X7 | Kimi as the Strategist | UNTESTED (`MOONSHOT_API_KEY`); without it the seat does not sit and the screen says so — PASS |
| X8 | Chainlink CRE simulate | UNTESTED (`cre login`) |
| X9 | MetaMask Agent Wallet: `mm perpl` trading commands | UNTESTED (`mm login` and a funded agent wallet); `markets`/`risk` ran in `mm` 7.0.0 on 5 Oct |
| X10 | Mera on the phone | UNTESTED (passkey domain files served; a development build) |

## 6. Zero mocks

`git grep -iE "mock|stub|fake|dummy|fixture"` over the product path (`app/`, `src/`, `server/src`; tests, proofs and dev
screens excluded): the one product mock — Kimi's fixture seat — was removed (`6d19112`). The rest are comments recording
mocks removed earlier, product configuration in files named `fixtures/` (the market catalog holds no prices; onboarding
choices; sleeve weights), and the inactive Solana path. Test setup outside the product: the allowlist cooling-off is
backdated in the test database (F14), and the fork's Perpl marks come from a local keeper that posts Perpl's live marks to
Perpl's real Exchange (fork only). **Zero mocks, stubs or fallback data in the tested surface; zero console or network
errors in the runs recorded above.**

## 7. Failures found and fixed while running this plan

| Found | Root cause | Fix |
|---|---|---|
| Fork buys refused after an hour ("178 bps from Chainlink") | the fork's pools frozen, Chainlink read live | gate uses the fork's own Chainlink and Kuru, aged at the fork block (`626d1d6`) |
| Perpl IOC on the fork filled nothing | priced off the API's live ask, below every resting ask on the fork | orders priced from the Exchange's on-chain book; keeper keeps the mark inside it (`626d1d6`) |
| An order waited 149 s | the exit sweep read 20 values per desk every tick | two-read pre-check per desk (`b247aaa`) |
| `/perps` "not here" on the fork; `/order/MON` a dead end | route gate by chain; ticket took the market symbol literally | `PERPL_DESK_HERE`; the ticket opens the token MON trades as (`93ff7ac`) |
| Kimi's fixture in the council | product mock | removed; "not configured" (`6d19112`) |
| `local-stack up` re-forked silently | empty `REFORKED_AT` read as a change | passes the saved mark; rebuilds when contracts are missing (`708c0fb`) |
| `local-stack down` left servers running | only the top pid was stopped | whole process tree (`2b27918`) |
