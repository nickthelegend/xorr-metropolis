# xorr on Monad — the plan (source of truth)

Rewritten 2026-10-06 for the master pipeline (coordinator's `METROPOLIS-ORCHESTRATION.md`): goals, phases, tasks, an
honest gap audit, and completion measured against the checklist in §5. Nothing is DONE until it was run for real and the
evidence is named. The previous plan (24 Sep – 5 Oct) is in git history at `ecc9d6b`.

**Standing constraints (6 Oct):** no Monad testnet or mainnet transactions and no hosting until the owner funds the
deployers and says go; everything on-chain runs as real signed transactions on a local anvil fork of Monad mainnet
(`infra/monad-fork/local-stack.sh`). No production mocks: a missing credential shows an honest "not configured" state.

## 1. Goals

**Pitch.** xorr is a non-custodial AI trading desk on Monad. You sign in with a passkey (Mera), grant a council of agents
a capped, revocable, on-chain permission, and they trade for you — spot through Kuru's order book or Uniswap, whichever
delivers more, perps on Perpl through Perpl's own DelegatedAccount — each vote shown beside the transaction it produced.
Monad's 300 ms blocks, final two blocks later (about 600 ms), are why a council can deliberate and still fill at the
price it voted on.

**Done** (for Metropolis, track 01 Onchain Finance & Trading, deadline 2026-10-13 23:59 ET):
- every flow a judge would try works end to end with real signed transactions, verified in a real browser with console and
  network clean;
- every sponsor requirement we claim is met by running code, or recorded as blocked with the exact missing dependency;
- the judge package is complete: README, SUBMISSION.md with the portal's fields and a 3-minute demo script,
  DEPLOY-LATER.md so that "go" to live takes under an hour.

**Winning.** Bounty scoring weights *meets the stated requirement* at 40%, technical 30%, Monad integration 20%,
innovation 10%. So: requirements first, then proof. Track-1-locked bounties (Agora Mobile, Kuru ×2, Perpl Risk, MetaMask
plugin) have the fewest competitors; Agora Mobile ($10k) is the largest single prize and stacks with Perpl API and both Mera
bounties.

## 2. Architecture (decided)

| Piece | Decision |
|---|---|
| Chains | `monad-fork` (anvil fork of mainnet 143, real Kuru/Uniswap/Perpl/Chainlink/AUSD state) for development and the demo; `monad-testnet` (10143) where the contracts are deployed and verified; `monad` (143) only with `ALLOW_MAINNET`. |
| Permission | `XorrDelegation`: daily cap, venue allowlist, expiry, revoke, min-out measured on the owner's balance. |
| Spot | Kuru's MON/USDC book through `KuruVenue`, or Uniswap v3 — both measured per order through the contract; the better one fills. |
| Perps | Perpl via Perpl's own `DelegatedAccount` (operator trades, never withdraws); standing exits; on the fork, a local keeper posts Perpl's marks. |
| Prices | Chainlink on Monad (live on mainnet/testnet; on a fork, the fork's own, aged at the fork block), Kuru mid, Perpl API; the fill-to-Chainlink gap gates every buy. Testnet MON: a CRE workflow. |
| Accounts | Mera passkeys on web and native (D1); Privy email sign-in remains for people without a PRF passkey. |
| Data | Postgres (executor); Envio HyperIndex into its own schema of the same database; `GET /indexed`. |
| AI | Four rule-based desks + Kimi (Moonshot) as the Strategist seat; no key → "not configured", the seat does not sit. |

**Decisions.** D1 Mera is the account layer (Agora + Mera bounties need it). D2 USDC settles spot on the fork (deep MON
books are USDC); AUSD is Perpl's margin and shown as a balance. D3 No stock screens (Monad has no tokenized equities).
D4 Testnet settles in AUSD.

## 3. Phases and tasks

Status: **DONE** (verified, evidence named) · **IN PROGRESS** · **NOT STARTED** · **BLOCKED** (exact dependency).
Critical path: **P-B → P-D → P-E → P-F**, then P-G when the owner says go.

### P-A — Foundation (DONE)
- A1 **DONE** Contracts `XorrDelegation`, `XorrAuditAnchor`, `KuruVenue`, `XorrPriceReceiver`; `forge test` 66 pass.
- A2 **DONE** Deployed and Sourcify-verified on Monad testnet: XorrDelegation `0x5995…0bd4b`, anchor `0x5a71…6203`.
- A3 **DONE** Repo public (since 1 Oct, after a secret scan), MIT, README discloses foundation and AI tools.

### P-B — Product on the local fork (real signed transactions)
Each: *objective* — *acceptance* — *verify* — status.
- B1 Passkey account (Mera) — account from PRF, nothing that signs stored — `npm run e2e:fork` step 1 — **DONE**; email sign-in (Privy) beside it — `npm run e2e:email` — **DONE**
- B2 Stateless sign-in — storage cleared → same account — e2e step 4 — **DONE**
- B3 Fund on the fork — USDC arrives, said on screen — e2e step 2 — **DONE**
- B4 Grant the permission — Mera-signed, confirmed on chain, ≤ 10 s from landing — e2e step 3 (3.1–5.6 s across runs; the 5.6 s run under load from other sessions) — **DONE**
- B5 Manual buy — fills on the better venue; the run shows the other venue's number — e2e step 5 — **DONE**
- B6 Close / sell a holding — USDC back in the owner's wallet, `Closed` event — `prove-monad.ts` step 5; `e2e:flows` B6 — **DONE**
- B7 Council round — live readings, vote, executed fill — `e2e:flows` B7 (Approved 4–0, Executed) — **DONE**
- B8 Hire an agent; it trades on its own on the fork — a filled run by the agent's own key inside its cap — `e2e:flows` B8 (Yield Keeper's round executed) — **DONE**
- B9 Perpl desk lifecycle — create, fund, allow, long, close — e2e steps 7–8 — **DONE**
- B10 Perpl exit guard — closes a live position by rule — `prove-perpl-desk.ts` step 6b — **DONE**
- B11 Hold to stop — permission revoked and desk operator removed, read back — e2e step 9 — **DONE**
- B12 Send / withdraw to an allowlisted address — both balances move on chain — `e2e:flows` B12 (24 h cooling-off backdated in the test database; 5 USDC read on chain) — **DONE**
- B13 History with the Envio record — e2e step 6 — **DONE**
- B14 Perpl risk screen — live data, alerts — the crawl renders `/perpl` — **DONE**
- B15 Private notes (second PRF key) — sealed, server stores ciphertext, reopens — `e2e:flows` B15 — **DONE**
- B16 Signing window: lock and unlock in Settings — `e2e:flows` B16 — **DONE**

### P-C — Sponsor integrations
- C1 **DONE** Chainlink feeds gate every buy (council and manual).
- C2 **DONE** Kuru routing with per-fill comparison; `docs/KURU.md`.
- C3 **DONE** Perpl via DelegatedAccount, caps, exits, risk tool.
- C4 **DONE** AUSD balance and Perpl margin.
- C5 **DONE** Envio HyperIndex (`indexer/`), `GET /indexed`, History.
- C6 Kimi Strategist seat — **BLOCKED** (`MOONSHOT_API_KEY`). The fixture is removed; without a key the seat does not sit and the Council says "not configured" (`e2e:flows` B7).
- C7 Chainlink CRE `cre/mon-price` — built, compiles — **BLOCKED** (`cre login`; simulate then).
- C8 MetaMask `mm-plugin-perpl` — read commands run in `mm` 7.0.0 — **BLOCKED** (`mm login` + funded agent wallet for trading commands).
- C9 Mera on the phone — built — **BLOCKED** (passkey domain files served; dev build with `EXPO_PUBLIC_MERA_RP_ID`).

### P-D — Zero-mock verification
- D1 **DONE** `docs/TEST-PLAN-ZERO-MOCK.md`: every screen, endpoint, contract interaction and flow, with "correct" defined and its status.
- D2 **DONE** Executed on the local stack, console and network checked, every FAIL fixed at the root and re-run (test plan §7). Browser: Playwright Chromium with a PRF virtual authenticator — Claude in Chrome had no connected browser, and only a virtual authenticator can hold a PRF passkey here.
- D3 **DONE** Production mocks removed (G1, `6d19112`); the grep audit in test plan §6.

### P-E — Quality gate
- E1 **DONE** typecheck (app, executor), lint 0 errors, unit suites, forge, CI green.
- E2 **DONE** slither over `contracts/src`; every finding triaged (`docs/evidence/quality-gate-2026-10-06.txt`).
- E3 **DONE** Secret scan over 2,588 tracked files: no `.env`, keys or vendor key formats tracked (same file).
- E4 **DONE** 375 px on every screen: the crawl at 375, 0 overflow.
- E5 **DONE** Route crawl (`npm run e2e:crawl`) — 116 screens, 0 errors; now also flags copy naming an older chain.
- E6 **DONE** Accessibility basics in the crawl: every reachable control named, images with alt, page language — 0 faults after the logo fix; the crawl now fails on any.

### P-F — Judge package
- F1 **DONE** README: one-command demo, new-in-window vs base, AI disclosure, why Monad, architecture diagram, sponsors (`051a345`).
- F2 **DONE** SUBMISSION.md: track and pitch, the portal's fields per bounty, testnet transactions, evidence, a 3-minute script with timestamps.
- F3 **DONE** `docs/DEPLOY-LATER.md`: ordered runbook, addresses and MON, keys and where set, deploy/verify/host commands, smoke test, video shot list, executor host options (Railway recommended).
- F4 **DONE** A demo video recorded from the local fork: `docs/demo/flows/00-full-tour.mp4` (1:50) and a video per flow beside it, 0 console errors, by `npm run demo:record` (every frame the real app; waits and blank page loads cut). The final testnet cut follows the go (DEPLOY-LATER §10).

### P-G — Go live (awaiting the owner's go)
- G-1 **BLOCKED** MON for the testnet keys; testnet runs of B4/B8/B9 and the CRE broadcast.
- G-2 **BLOCKED** Hosting (executor + web) per DEPLOY-LATER.md.
- G-3 **BLOCKED** Registration (Oct 6 23:59 UTC) and submission on hackathon.monad.xyz.

### P-H — Alive, every screen, on film (6–7 Oct; the owner: "the UI is stale … the best UI for all the screens, black theme only")
- H1 **DONE** The living redesign, at the system level so all 116 routes take it: one violet accent (never an outcome),
  light instead of grey (`Aurora`, lit cards, `tone="accent"`, `Glow`), black only (the ticket's white sheet and the
  lavender Messages room gone), motion that answers the thumb (`Press`, `Screen` arrival, `LiveDot`, `RoutingBars`), the
  primary action lit; Home's quick actions, the Run receipt's routing bars, the Council's bench, the desktop stage.
  `src/ui/README.md` "2026-10-06 — alive"; design-system tests restated for the new policy (53 pass).
- H2 **DONE** Every screen photographed on the fork with real data, 390 × 844 and 1440 × 900: 103 screens incl. empty,
  offline and stopped states (`docs/screens/<area>/`, `e2e/web/capture.mjs`); the 38 key screens also on the UI before
  the redesign (`docs/screens/before/`, `sheets/then-and-now.png`).
- H3 **DONE** `docs/screens/REVIEW.md`: every screen scored 1–5 against a written rubric; the 14 at 3 or less polished in
  code and re-captured (before/after in `docs/screens/polish/`, `sheets/polished.png`); average 3.91 → 4.09, none ≤ 3.
- H4 **DONE** Contact sheets per area (`docs/screens/sheets/`) and the gallery (`docs/screens/index.html`).
- H5 **DONE** A video per flow and the full tour, cut from one real run on the fork (`docs/demo/flows/`, `npm run demo:record`).
- Found and fixed on the way: the executor crashed when Postgres dropped a connection (now it reconnects); resizing a
  browser window across 402 px remounted the whole app (`PhoneFrame`); a passkey account was told its email was its way
  back; unlimited allowances printed as 78 digits; "Trade stocks" offered on Monad; venues unnamed; the browser's focus box.

### P-I — Development wave: what wins (7 Oct; `docs/ROADMAP-WIN.md` has the review and the full acceptance criteria)
- I1 **DONE** F1 Monad speed receipt — each fill's send-to-confirm ms, block, gas and its cost on Monad against the same
  gas on Ethereum; Monad mainnet's measured cadence (`/monad/pulse`, `/speed/:tx`); on the Run receipt and the council round.
  Live on 7 Oct: a block every 300 ms on mainnet; a $20 buy's gas $0.00085 on Monad at 102 gwei against $0.32 on Ethereum
  at 0.63 gwei (340×). `e2e:fork` checks the card; `docs/screens/wave/f1-*`.
- I2 **DONE** F2 First-run explainer — `/how`, three steps between "Get started" and sign-up: the council (five seats),
  the permission the chain enforces, and the stop with Monad mainnet's cadence read live. Skippable at every step, shown
  once per device (`howSeen`), and "How xorr works" in Settings opens it again and returns there. `e2e:explainer`;
  `docs/screens/wave/f2-*`.
- I3 **DONE** F3 Council replay — "Replay" on every round opens `/council/<id>`: the proposal, then each desk with what it
  read when the round convened (Chainlink and its age, the fill's quote, Kuru's book and the gap; the cap left; the trend;
  Perpl funding — from the round's stored inputs, never re-read) and its vote, then the verdict and the rule it followed,
  then the transaction with its vote-to-fill time and speed receipt. The bench lights each seat as it speaks; pause, show
  all, play again; under reduced motion it is shown whole. `e2e:replay`; `docs/screens/wave/f3-*`.
- I4 **DONE** F4 Built on Monad — `/monad`, from Home's live Monad line, Settings and Explore: the Monad-native items
  each with a reading made now and where it runs (commit states; the sync send; txpool status; a passkey checked by the
  P256 precompile on mainnet and the fork; staking at 0x1000; gas and the reserve; the canonical contracts and xorr's
  Sourcify-verified testnet contracts), then the sponsors' tech on Monad (Kuru, Uniswap and Chainlink pricing MON three
  ways, Perpl, AUSD's peg, Envio's index, Mera, Kimi, CRE, MetaMask). `e2e:monad`; `docs/screens/wave/f4-*`.
- I5 **DONE** F5 The strategy gauntlet — `/gauntlet`, from Home's Strategies tab and Explore: the funnel counted from the
  book's own failures (313 backtested → 16 profitable on unseen data with enough trades → 16 through the parameter sweep
  → 15 at double commission → 10 across assets, which is exactly the survivors), the book by family with each strategy's
  out-of-sample numbers, and for the cut the reason in words ("lost on BTC out of sample" beside a portfolio profit).
  `e2e:gauntlet`; `docs/screens/wave/f5-*`.
- Each: real fork data, unit + e2e tests, console and network clean, before/after at 1440 and 390 in `docs/screens/wave/`,
  one commit, pushed, CI green.

## 4. Gaps (audit from the code, 6 Oct)

`git grep -iE "mock|stub|fake|dummy|placeholder|TODO|FIXME|hardcod|fixture"` over `app/`, `src/`, `server/src` (tests,
proofs and dev screens excluded): 173 hits. All but the rows below are comments recording a mock that was already removed,
product configuration in files named `fixtures/` (the market catalog — no prices —, onboarding choices, sleeve weights), or
the inactive Solana path.

| # | Gap | Evidence | Impact | Sev | Fix | Blocks |
|---|---|---|---|---|---|---|
| G1 | Kimi seat has a fixture answer in the product path | `server/src/council/strategist.ts` `fixtureAnswer`, `kimiMode` | a fake model answer runs through the council | P1 | remove; no key → the seat does not sit and the council says "not configured" | C6, D3 |
| G2 | Agent autonomy not re-verified since 24 Sep | `docs/evidence/` has no 6 Oct agent fill | a core flow unproven on the current code | P1 | hire on the fork, wait for the sweep, read the run | B8 |
| G3 | Send/withdraw not re-verified | as above | flow unproven on current code | P2 | browser pass on the fork | B12 |
| G4 | No static analysis of the contracts | — | security claims unbacked | P2 | slither | E2 |
| G5 | Secret scan not re-run since 1 Oct | — | a key could have been committed since | P1 | gitleaks or git grep over tracked files | E3 |
| G6 | 375 px not checked | crawl ran at 390 | broken layouts on small phones | P2 | crawl at 375, fix | E4 |
| G7 | No DEPLOY-LATER runbook | — | "go" to live is improvised | P1 | write it | F3 |
| G8 | Demo video predates 6 Oct | `docs/demo/xorr-monad-demo.mp4` (24 Sep) | judges see an older product | P1 | record from the fork | F4 |
| G9 | Product config lives under `src/data/fixtures/` | file names | reads like mock data to an auditor | P3 | rename or note | — |
| G10 | `src/chain.test.ts` first test times out (5 s) under machine load | local runs, 6 Oct | flaky locally; CI green | P3 | longer timeout for the cold import | E1 |
| G11 | Inherited Solana/Base/Arbitrum code remains in the tree | `server/src/solana/`, `server/src/venues/gmx/` | size, not product path on Monad | P3 | leave; hidden on Monad | — |
| G12 | Accessibility basics unchecked; then 9 screens with logos lacking alt | `src/ui/AgentOrb.tsx` AssetMark, `src/design/CoinHero.tsx` | screen-reader users | P2 | the crawl checks every control's name, image alt and page language; `accessibilityLabel=""` on decorative images | E6 |

**Resolved in the pipeline (6 Oct):** G1 (`6d19112`), G2 and G3 (`e2e:flows` B8, B12), G4 and G5 (quality gate), G6
(crawl at 375), G7 (`docs/DEPLOY-LATER.md`), G8 (F4), G12 (E6). Open: G9–G11 (P3, left by choice). No P0 or P1 gap
that can be solved without the owner remains.

## 5. Completion checklist (46 items) and measurement

Features and flows on the fork: B1–B16 (16). Integrations: C1–C9 (9). Quality: typecheck, lint, app unit, executor unit,
forge, slither, secret scan, e2e journey, crawl, 375 px, zero-mock plan executed, CI (12). Deploy and submission: testnet
contracts, repo/licence/disclosure, README package, SUBMISSION package, DEPLOY-LATER, current demo video, live testnet
transactions, hosted build, registration and submission (9).

**Initial (6 Oct, start of the pipeline): 28 of 46 — 61%.** Done: 13 flows (B1–B5, B6 by `prove-monad.ts`, B7, B9, B10,
B11, B13, B14, B15 by its 24 Sep run), 5 integrations (C1–C5), 8 quality items (typecheck, lint, app unit, executor unit,
forge, e2e journey, crawl, CI), 2 deploy items (testnet contracts; repo, licence and disclosure).

**Final (6 Oct, end of the pipeline): 39 of 46 — 85%.** Done: all 16 flows (B1–B16), 5 integrations (C1–C5), all 12
quality items (typecheck, lint, app unit, executor unit, forge, slither, secret scan, e2e journey, crawl, 375 px, the
zero-mock plan executed, CI), 6 deploy and submission items (testnet contracts; repo, licence and disclosure; README;
SUBMISSION; DEPLOY-LATER; a current demo video). The other 7 each wait on the owner: C6 `MOONSHOT_API_KEY`, C7 `cre login`,
C8 `mm login` and a funded agent wallet, C9 the passkey domain and a development build, live testnet transactions (the go
and MON), the hosted build (the go), registration and submission. Evidence for each: `docs/TEST-PLAN-ZERO-MOCK.md`
(37 PASS · 0 FAIL · 6 UNTESTED).

## 6. Owner actions (USER_ACTION_REQUIRED)

- Register and create the team/project on hackathon.monad.xyz (Oct 6 23:59 UTC); submit before Oct 13 23:59 ET.
- Say go for testnet, and fund: faucet key `0x5C1948d90570BA8547956B2Be2d3179454D22938`, delegate `0xEe7d…c49f`, Perpl
  operator `0x0b21B4DdcC9753878F3d8A99A2f65b964fba453f`, ~0.12 MON for the CRE receiver (DEPLOY-LATER.md has the amounts).
- Keys and sign-ins: `MOONSHOT_API_KEY` (Kimi), `cre login`, `mm login`, an Envio API token.
- Passkey domain: Apple team id and Android signing fingerprint for `docs/passkey-domain/`, then serve the files.
- Hosting choice for the executor (DEPLOY-LATER.md recommends one).
