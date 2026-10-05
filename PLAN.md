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
Monad's 400 ms blocks are why a council can deliberate and still fill at the price it voted on.

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
- B1 Passkey account (Mera) — account from PRF, nothing that signs stored — `npm run e2e:fork` step 1 — **DONE**
- B2 Stateless sign-in — storage cleared → same account — e2e step 4 — **DONE**
- B3 Fund on the fork — USDC arrives, said on screen — e2e step 2 — **DONE**
- B4 Grant the permission — Mera-signed, confirmed on chain, ≤ 5 s from landing — e2e step 3 (3.1 s) — **DONE**
- B5 Manual buy — fills on the better venue; the run shows the other venue's number — e2e step 5 — **DONE**
- B6 Close / sell a holding — USDC back in the owner's wallet, `Closed` event — `prove-monad.ts` step 5; browser: TP-F10 — **IN PROGRESS** (browser pass pending)
- B7 Council round — live readings, vote, executed fill — council probe; TP-F07 — **DONE**
- B8 Hire an agent; it trades on its own on the fork — a filled run by the agent's own key inside its cap — TP-F08 — **NOT STARTED** (last verified 24 Sep)
- B9 Perpl desk lifecycle — create, fund, allow, long, close — e2e steps 7–8 — **DONE**
- B10 Perpl exit guard — closes a live position by rule — `prove-perpl-desk.ts` step 6b — **DONE**
- B11 Hold to stop — permission revoked and desk operator removed, read back — e2e step 9 — **DONE**
- B12 Send / withdraw to an allowlisted address — both balances move on chain — TP-F12 — **NOT STARTED** (last verified 24 Sep)
- B13 History with the Envio record — e2e step 6 — **DONE**
- B14 Perpl risk screen — live data, alerts — TP-F14 — **DONE**
- B15 Private notes (second PRF key) — sealed, server stores ciphertext, reopens — TP-F15 — **IN PROGRESS** (re-verify)
- B16 Signing window: lock and unlock in Settings — TP-F16 — **IN PROGRESS** (re-verify)

### P-C — Sponsor integrations
- C1 **DONE** Chainlink feeds gate every buy (council and manual).
- C2 **DONE** Kuru routing with per-fill comparison; `docs/KURU.md`.
- C3 **DONE** Perpl via DelegatedAccount, caps, exits, risk tool.
- C4 **DONE** AUSD balance and Perpl margin.
- C5 **DONE** Envio HyperIndex (`indexer/`), `GET /indexed`, History.
- C6 Kimi Strategist seat — **IN PROGRESS → BLOCKED** after G1: the fixture is removed; live needs `MOONSHOT_API_KEY`.
- C7 Chainlink CRE `cre/mon-price` — built, compiles — **BLOCKED** (`cre login`; simulate then).
- C8 MetaMask `mm-plugin-perpl` — read commands run in `mm` 7.0.0 — **BLOCKED** (`mm login` + funded agent wallet for trading commands).
- C9 Mera on the phone — built — **BLOCKED** (passkey domain files served; dev build with `EXPO_PUBLIC_MERA_RP_ID`).

### P-D — Zero-mock verification
- D1 **IN PROGRESS** `docs/TEST-PLAN-ZERO-MOCK.md`: every screen, endpoint, contract interaction and flow, with "correct" defined.
- D2 **NOT STARTED** Execute it in Claude in Chrome on the local stack, console and network checked; fix every FAIL at the root; re-run.
- D3 **IN PROGRESS** Remove production mocks (G1).

### P-E — Quality gate
- E1 **DONE** typecheck (app, executor), lint 0 errors, unit suites, forge, CI green.
- E2 **NOT STARTED** slither over `contracts/src`.
- E3 **NOT STARTED** Secret scan over every tracked file; no `.env`, keys or `*.key` tracked.
- E4 **NOT STARTED** 375 px widths on every screen (crawl at 375).
- E5 **DONE** Route crawl (`npm run e2e:crawl`) — 116 screens, 0 errors; now also flags copy naming an older chain.

### P-F — Judge package
- F1 **IN PROGRESS** README: one-command demo, new-in-window vs base, AI disclosure, why Monad, architecture diagram, sponsors.
- F2 **IN PROGRESS** SUBMISSION.md: track and pitch, the portal's fields per bounty, evidence, a 3-minute script with timestamps.
- F3 **NOT STARTED** `docs/DEPLOY-LATER.md`: ordered runbook, addresses and MON, keys and where set, deploy/verify/host commands, smoke test, video shot list, executor host options with a recommendation.
- F4 **NOT STARTED** A demo video recorded from the local fork (≤ 3 min), replacing the 24 Sep one.

### P-G — Go live (awaiting the owner's go)
- G-1 **BLOCKED** MON for the testnet keys; testnet runs of B4/B8/B9 and the CRE broadcast.
- G-2 **BLOCKED** Hosting (executor + web) per DEPLOY-LATER.md.
- G-3 **BLOCKED** Registration (Oct 6 23:59 UTC) and submission on hackathon.monad.xyz.

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

## 5. Completion checklist (46 items) and measurement

Features and flows on the fork: B1–B16 (16). Integrations: C1–C9 (9). Quality: typecheck, lint, app unit, executor unit,
forge, slither, secret scan, e2e journey, crawl, 375 px, zero-mock plan executed, CI (12). Deploy and submission: testnet
contracts, repo/licence/disclosure, README package, SUBMISSION package, DEPLOY-LATER, current demo video, live testnet
transactions, hosted build, registration and submission (9).

**Initial (6 Oct, start of the pipeline): 28 of 46 — 61%.** Done: 13 flows (B1–B5, B6 by `prove-monad.ts`, B7, B9, B10,
B11, B13, B14, B15 by its 24 Sep run), 5 integrations (C1–C5), 8 quality items (typecheck, lint, app unit, executor unit,
forge, e2e journey, crawl, CI), 2 deploy items (testnet contracts; repo, licence and disclosure).

**Final:** measured at the end of the pipeline, same checklist — see §6.

## 6. Owner actions (USER_ACTION_REQUIRED)

- Register and create the team/project on hackathon.monad.xyz (Oct 6 23:59 UTC); submit before Oct 13 23:59 ET.
- Say go for testnet, and fund: faucet key `0x5C1948d90570BA8547956B2Be2d3179454D22938`, delegate `0xEe7d…c49f`, Perpl
  operator `0x0b21B4DdcC9753878F3d8A99A2f65b964fba453f`, ~0.12 MON for the CRE receiver (DEPLOY-LATER.md has the amounts).
- Keys and sign-ins: `MOONSHOT_API_KEY` (Kimi), `cre login`, `mm login`, an Envio API token.
- Passkey domain: Apple team id and Android signing fingerprint for `docs/passkey-domain/`, then serve the files.
- Hosting choice for the executor (DEPLOY-LATER.md recommends one).
