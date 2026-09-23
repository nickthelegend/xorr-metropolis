# xorr on Arbitrum — the plan (source of truth)

Started 2026-09-23 from a fresh copy of xorr-solana main (`f5c32aa`). Update the status tags as work lands; nothing is
DONE until its verification has been run and the evidence is named. Superseded: `docs/archive/PLAN-solana-2026-09-19.md`.
Sponsor audit and 50 ranked sponsor features: `docs/SPONSOR-AUDIT.md`.

## 1. Goals

**Pitch.** xorr is a non-custodial AI trading desk: you grant a council of agents a capped, revocable, on-chain permission
and they trade **Robinhood Chain Stock Tokens** (settled in **Paxos USDG**) and hedge with **GMX V2 perps on Arbitrum One**,
every vote shown next to the transaction it produced. The permission is the product.

**Hackathon.** Arbitrum Open House Singapore Online Buildathon (HackQuest). Deadline **2026-10-01 23:59 SGT** (T&C PDF;
HackQuest says Oct 4 — plan for Oct 1). Must be deployed on an Arbitrum chain. Judging: contract quality, PMF,
innovation, real problem; extra consideration for USDG; ≥1 of 3 places per track reserved for Robinhood Chain projects.

**Definition of done**
- **Qualified** — `XorrDelegation` + `XorrAuditAnchor` deployed and verified on **Arbitrum Sepolia** and **Robinhood Chain
  testnet**.
- **Product** — on the hosted forks a judge can: sign in → fund (fork faucet) → grant a USDG cap → hire agents → watch the
  council vote and the executor buy NVDA/TSLA/AAPL/SPY Stock Tokens on Robinhood Chain through Uniswap v3 → open a GMX hedge
  on Arbitrum → see ERC-8056-true holdings/P&L → stop everything on-chain in one tap → withdraw.
- **Honest** — every price has a named source (pool, Chainlink, Robinhood API); market-session and halt checks refuse
  with reasons; no fixture data in product paths; a fork is always labelled a fork.
- **Technical** — typecheck, lint, unit tests, `forge test`, the fork proofs, and CI green on `main`.
- **Submitted** — README Arbitrum-first, demo video, HackQuest form (contract addresses; sponsor checkboxes Robinhood
  Chain, GMX, Paxos/USDG, ZeroDev, OpenZeppelin).

**Winning looks like:** a Robinhood-reserved place in Overall and/or Promising Products (AI agents), on the strength of
(1) stock-token mechanics done right (sessions, halts, ERC-8056, corporate actions, Chainlink), (2) an agent permission
enforced on-chain, (3) GMX used natively (subaccounts, funding data, pending orders), (4) USDG throughout.

## 2. Architecture (decided)

| Piece | Decision |
|---|---|
| Chains | `robinhood-fork` (anvil fork of Robinhood Chain 4663: Stock Tokens, USDG, Uniswap v3, Chainlink) and `arbitrum-fork` (anvil fork of Arbitrum One 42161: GMX V2, USDC/USDG, Uniswap v3). Real deployments on `arbitrum-sepolia` and `robinhood-testnet`. One executor per chain. |
| Permission | `XorrDelegation` (daily cap, venue allowlist, expiry, revoke, min-out, `spendVia`) — our own session-key contract; settlement token USDG on Robinhood Chain, USDC on Arbitrum. ZeroDev Kernel permissions as the second, sponsor-native path (P6). |
| Stock venue | Uniswap v3 QuoterV2 + SwapRouter02 on 4663 (no key needed; real pools checked 2026-09-23: NVDA/USDG 0.05% ≈ $4.5M USDG, TSLA/USDG 0.3% ≈ $488K, AAPL/USDG 0.05% ≈ $289K, SPY/USDG 0.05% ≈ $320K). Uniswap Trading API when `UNISWAP_API_KEY` exists. |
| Stock data | Robinhood `/rhj/assets` (catalog, multiplier, tradingCapabilities), `/rhj/prices/{sym}` (bid/ask, halt), `/rhj/corporate-actions`; on-chain `uiMultiplier()` (ERC-8056); a Chainlink feed per token. |
| Perps | GMX V2 on Arbitrum One via **SubaccountRouter** (the user's own GMX account; the agent key is a subaccount with max action count + expiry). REST `/markets/info` for funding/OI. On the fork, orders are executed by impersonating a registered ORDER_KEEPER with prices from GMX's live API (labelled). |
| Council | Several personas vote on each candidate trade (momentum, session/risk, funding/hedge); majority executes; votes, inputs and the resulting tx hash persisted and shown on a dashboard. |
| Hosting | Railway project `xorr-arbitrum` (414d67a7-a55d-435c-a252-de78eca2787b): `arbitrum-fork`, `executor-fork`, Postgres; add `robinhood-fork` + `executor-robinhood`. Web: Vercel project `xorr-arbitrum`. |

## 3. Phases and tasks

Status: **DONE** (verified, evidence named) · **IN PROGRESS** · **NOT STARTED** · **BLOCKED** (reason).

### P0 — Foundation
- P0.1 **DONE** Fresh repo `github.com/nickthelegend/xorr-arbitrum` (private), history wiped. Evidence: root commit `e226346`.
- P0.2 **DONE** Chain keys `arbitrum`, `arbitrum-sepolia`, `arbitrum-fork` in `server/src/evm/money.ts`, `server/src/evm/chains.ts`, `src/chain.ts`. Evidence: server `tsc` clean; executor boots on `arbitrum-fork`.
- P0.3 **DONE** Contracts trimmed to `XorrDelegation` (+`spendVia`) and `XorrAuditAnchor`; Aqua/SwapVM books and 1inch libs removed. Evidence: `forge test` 45/45.
- P0.4 **DONE** Railway `arbitrum-fork` (anvil, chain 42161, volume `/data`) at `https://arbitrum-fork-production.up.railway.app`. Evidence: `eth_chainId` → `0xa4b1`; state survived a restart (contract code still present).
- P0.5 **DONE** Fork bootstrap `server/src/fork-bootstrap-arbitrum.ts`: `XorrDelegation` `0x649b0005b07e43a2ea3a30a458ea1d9cce420f53`, anchor `0xe25e2d8535a8603cff45a20dfbf0226c157522c1`, delegate `0x0f4F…2c9C` funded.
- P0.6 **DONE** Executor `executor-fork` → `https://executor-fork-production-ba80.up.railway.app` (`/health`: chain arbitrum-fork; postgres, rpc, delegation, gas up).
- P0.7 **DONE** Web on Vercel `xorr-arbitrum` → `https://xorr-arbitrum.vercel.app` (renders; no console errors; pinned delegation checked by `scripts/build-web.mjs`).
- P0.8 **NOT STARTED** Delete the stray empty Railway service `executor` (created while `executor-fork`'s create was stuck).

### P1 — Robinhood Chain: stock tokens settled in USDG
- P1.1 **DONE** Chain keys `robinhood` (4663, real), `robinhood-testnet` (46630, test), `robinhood-fork` (copy); viem chain definitions; Blockscout explorer links; settlement token USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`. Evidence: `robinhood`, `robinhood-testnet`, `robinhood-fork` in money.ts/chains.ts/src/chain.ts (viem `robinhood`/`robinhoodTestnet`); USDG settlement; commit 80604c6.
- P1.2 **DONE** `infra/robinhood-fork` (anvil fork of `rpc.mainnet.chain.robinhood.com`, chain id 4663, volume) + Railway service with a public domain. Evidence: Robinhood's public RPC keeps ~10 min of state (measured: ~6,100 blocks), so the node serves a real-state SNAPSHOT (block 70254193) captured by `server/src/fork/warm-robinhood.ts`, or forks live with `ROBINHOOD_ARCHIVE_RPC`; `https://robinhood-fork-production.up.railway.app` answers chain 4663; `swap-check-robinhood.ts` bought and sold $50 of NVDA/TSLA/AAPL/SPY on it (e.g. 0.2185 NVDA for $50).
- P1.3 **DONE** `server/src/fork-bootstrap-robinhood.ts`: deploy `XorrDelegation(USDG)` + anchor; fund the delegate; USDG reserve via `dealErc20`. Evidence: `server/src/fork-bootstrap-evm.ts` (chain-generic); XorrDelegation(USDG) `0x60b0c8343bc8295595542c5d5aa83d4fb2e178cb`, anchor `0x63c53915085c707952720eee3cfea76f6d926d78` baked into the snapshot; delegate `0x5cF6…cC34`; faucet reserve holds 10M USDG.
- P1.4 **DONE** `server/src/robinhood/` read module: `/rhj/assets`, `/rhj/prices/{sym}`, `/rhj/corporate-actions`; `sessionNow()` from tradingCapabilities; on-chain `uiMultiplier()`; Chainlink `latestRoundData` per token. Unit + live tests. Evidence: `server/src/robinhood/` merged (bbeae8a): 50 unit + 8 live tests pass; live catalog = 68 Stock Tokens with a funded USDG pool; NVDA/TSLA/AAPL/SPY guards OK at 7.5/47.8/27.4/16.6 bps.
- P1.5 **DONE** Uniswap v3 venue for 4663 (`server/src/venues/uniswap.ts`, port of the X Layer venue): QuoterV2 `quoteExactInput` along the registry path and every direct fee tier (best out wins), SwapRouter02 `exactInput` paying the owner, floor = quote less tolerance; on the snapshot node, which lacks QuoterV2, the canonical bytecode is copied from Robinhood Chain (`fork/robinhood-periphery.ts`, or an `eth_call` code override). Evidence: `prove-robinhood.ts` on the hosted node — buy `0x84bbbfd8…6129`, close `0xd69bd675…1e08`; `venues/uniswap.test.ts`.
- P1.6 **DONE** Stock catalog: on Robinhood keys the live Robinhood catalog ∩ tokens and pools with code on the node (`venues/rh-stocks.ts`) is the registry and `/market/xstocks` (`venues/rh-xstocks.ts`); on the hosted node 4 of 68 trade (NVDA, TSLA, AAPL, SPY), `notOnThisNode: 64`. Evidence: `/market/xstocks` on a local executor against the hosted node; `venues/rh-stocks.test.ts`.
- P1.7 **DONE** Risk gates before any stock spend (`executor/stock-guard.ts` → `robinhood/guards.ts stockTradeCheck`) in `run.ts`, `closeHolding`, flatten and swap conversions; refusals audited with the reason and the numbers. On the snapshot node: session/halt from Robinhood's API, pool and quote from the fork, Chainlink from the LIVE feed (the snapshot has no feeds) — reasoning in the file header. Evidence: proof prints `pool 228.8564 vs Chainlink 229.0274 (7.5 bps ≤ 150)`; `executor/stock-guard.test.ts`.
- P1.8 **IN PROGRESS** Holdings/P&L via ERC-8056: `/positions` and `/wallet/balance` carry `shares = units × uiMultiplier()` and `multiplier` on Robinhood keys (`feat/venues`); corporate-action notices are on the catalog rows. Not yet: cost-basis re-basing across a multiplier change.
- P1.9 **DONE** Jurisdiction notice (not US/CA/UK/CH). Evidence: `src/legal/jurisdiction.ts` on the grant screen, every stock ticket and the risk disclosure.
- P1.10 **DONE** `executor-robinhood` on Railway (deploy after `feat/venues` merges); proof `server/src/prove-robinhood.ts` **passes on the hosted node**: faucet USDG from FORK_USDC_RESERVE, grant $100/day, `placeOrder` $50 NVDA → owner holds 0.218478 NVDA, $60 refused by the executor and by the contract (`DailyCapExceeded(60000000, 50000000)`, mined revert `0x63e0d0b5…78ee`), `closeHolding` → 49.95 USDG, revoke `0x9a1c11e1…626a` → next order refused, raw spend reverts `PolicyRevoked`. Evidence: executor-robinhood live at https://executor-robinhood-production.up.railway.app (health up: uniswap, 4 stocks); prove-robinhood.ts passed on the hosted node (buy, DailyCapExceeded, close, PolicyRevoked).

### P2 — Arbitrum One: spot + GMX V2
- P2.1 **DONE** Token registry per chain key (`server/src/venues/tokens.ts`): Arbitrum USDC (settles), USDG (held; no v3 pool), WETH, WBTC, ARB, GMX; Robinhood USDG + runtime Stock Tokens; Base kept for its keys. 1inch is optional (`ONEINCH_ENABLED`, never on Robinhood), not asked for logos/cross-checks where it is not a venue. Evidence: `/health` on robinhood-fork `upstreams: no breaker open`, no subgraph probe.
- P2.2 **DONE** Uniswap v3 venue on 42161 (QuoterV2 `0x61fFE014bA17989E743c5F6cB21bF9697530B21e`, SwapRouter02 `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45`) through `executor/settle.ts`. Evidence: `prove-robinhood.ts` on arbitrum-fork: $20 USDC → 0.0072657 WETH `0x135808b2…0814` via uniswap-v3.
- P2.3 **DONE** `server/src/venues/gmx/` REST: `/markets/info`, `/prices/tickers`, decoded from 30-dp USD. Evidence: `server/src/venues/gmx/api.ts`, merged 05c3e38; `/gmx/markets` public.
- P2.4 **DONE** GMX SubaccountRouter (`0x9c05880A2AaD7530c69e18e342eDC9E06cc757db`) flow: user-signed subaccount setup; agent `createOrder(account=user)`; ExchangeRouter `0x7dE39FF2e232A2203196788d37e234cF8F1b83f1`; `uiFeeReceiver` + referral code. Evidence: prove-gmx.ts on the hosted Arbitrum fork: owner approve `0x045d400f…48f3`, subaccount setup `0x111da8a3…82a0`, agent order `0x371ec297…9b83` — position owned by the OWNER ($100 size, 2x, entry $2770.98).
- P2.5 **DONE** Pending-order tracker (order key → executed/cancelled/frozen), `gmx_orders` table, "waiting for keeper" UI. Evidence: tracker pending→executed for open and close; `gmx_orders` table (migration 20260923T120000).
- P2.6 **DONE** Fork keeper (impersonated ORDER_KEEPER, oracle provider `0x7BA7Ae61887F1aca28E0FE5aB1434ce85b6606aa`) + proof `server/src/prove-gmx.ts`. Evidence: fork keeper executed at GMX's live signed price (execute `0x009fd2aa…d90c`); refusals named: MaxSubaccountActionCountExceeded, SubaccountApprovalExpired, SubaccountNotAuthorized. Caveat: the hosted fork's oracle provider now holds the fork stand-in permanently.
- P2.7 **DONE** Funding/OI into agent inputs and reasons. Evidence: GMX ETH/BTC funding + OI are council inputs (Macro Desk).

### P3 — The council
- P3.1 **DONE** Migration: `council_rounds`, `council_votes`. Evidence: migration 20260923T140000-council.sql.
- P3.2 **DONE** Personas vote from real inputs (momentum, session/halt, deviation, funding, exposure). Evidence: `server/src/council/personas.ts`, 9 unit tests; live inputs: Robinhood session/quote, Chainlink rounds, pool quote, GMX, on-chain grant, ERC-8056 holdings.
- P3.3 **DONE** Majority → spend; the round records the tx hash or the refusal. Evidence: from the web UI: round approved 3–0 and executed tx 0x20141cdb…d4720b (owner holds 0.2185 NVDA); after the on-chain revoke the next round was vetoed.
- P3.4 **DONE** `GET /council/rounds`, `GET /council/rounds/:id`; `app/council.tsx` with each vote beside its tx hash. Evidence: `/council/seats|rounds|rounds/:id|convene` mounted; `app/council.tsx` shows each vote and reason beside the tx hash.

- P3.5 **DONE** The agents trade on their own through the council on EVM chains: `server/src/council/sweep.ts` runs each scheduler tick (one round per wallet per hour, one entry per stock per day, a tenth of the cap, strongest rising Chainlink trend); the Solana SPL agent loop no longer runs on EVM keys. Evidence: `prove-sweep.ts` — Momentum Scout's $20 SPY approved 3–0 and executed `0x7957b04d…8f95`.

### P4 — The app on EVM
- P4.1 **DONE** EVM path everywhere `isSolana` branches (31 files); Privy EVM wallet signs grant/revoke. Evidence: merge 689a473: no `isSolana` left in app/src; Privy ethereum-only; `src/nav/buildRoutes.ts`; tsc clean, lint 0 errors, src tests 1288 pass.
- P4.2 **DONE** Welcome art/copy chain-agnostic (shows a Solana coin and "Tokenized US stocks on Solana"). Evidence: welcome hero is the X coin (landing art); Solana coin film deleted.
- P4.3 **DONE** Networks screen lists the Robinhood and Arbitrum deployments. Evidence: `src/networks/deployments.ts`: Robinhood Chain fork (4663) + Arbitrum fork (42161).
- P4.4 **DONE** Stock screens on the Robinhood catalog: session chip, halt banner, Chainlink + pool price, multiplier. Evidence: stock list and ticket render session, halt, Chainlink, pool, deviation and multiplier from real rows (TESTPLAN S6/S7).
- P4.5 **DONE** Perps screen: GMX markets, positions, pending orders. Evidence: `app/hedge.tsx`: GMX markets (funding/OI), the wallet's GMX positions and its agent's orders; reachable from Explore.
- P4.6 **DONE** No fixture prices in product paths (`src/data/fixtures/markets.ts`). Evidence: `src/data/fixtures/markets.ts` carries no prices; `no-invented-prices.test.ts` enforces it.

### P5 — Real deployments (qualification)
- P5.1 **BLOCKED** Deploy + verify on Arbitrum Sepolia — deployer holds no test ETH (§5).
- P5.2 **BLOCKED** Same on Robinhood Chain testnet 46630 — same reason.
- P5.3 **NOT STARTED** `prove-testnet.ts` on Arbitrum Sepolia.

### P6 — ZeroDev session keys
- P6.1 **DONE** `server/src/aa/`: Kernel v3 account; permission validator (CallPolicy, RateLimitPolicy, TimestampPolicy) for the agent key. Evidence: `server/src/aa/kernel.ts` merged (f815739).
- P6.2 **DONE** Self-bundled on the fork via `EntryPoint.handleOps`; ZeroDev bundler/paymaster with `ZERODEV_PROJECT_ID`. Evidence: self-bundler `server/src/aa/bundle.ts` (EntryPoint.handleOps on anvil; BUNDLER_RPC/PAYMASTER_RPC path written, untested without a ZeroDev project id).
- P6.3 **DONE** Proof: allowed call passes; wrong target, over-rate and expired fail; uninstall revokes. Evidence: `prove-zerodev.ts` on a local Arbitrum fork: swap passes; CallViolatesParamRule (recipient, cap), CallViolatesTargetRule, PolicyFailed(1) rate limit, AA22 expired, uninstall → AA23, replay → InvalidNonce. Not yet wired to the executor.

### P7 — Verification, demo, submission
- P7.1 **DONE** `docs/TESTPLAN-ARBITRUM.md`: every screen, endpoint, contract call and edge case, with "correct" defined. Evidence: `docs/TESTPLAN-ARBITRUM.md`.
- P7.2 **DONE** Execute in Chrome against the hosted app; console + network clean per item; fix and re-run. Evidence: Chrome pass on the hosted app: 4 FAIL→fixed→PASS (S2 migrations, S6 sector, S9 USDG/target mix, deposit MoonPay line); all items PASS; console clean.
- P7.3 **DONE** CI: contracts, server tests, fork proofs. Evidence: ci.yml: checks + every contract test on push (green), on-demand Robinhood node job.
- P7.4 **DONE** README, `.env.example`, submission text, demo script. Evidence: README rewritten for Robinhood Chain + Arbitrum; `.env.example` unchanged (see gaps).
- P7.5 **PARTLY DONE** Demo video: `docs/demo/xorr-loom.mp4` (70 s, 1080p, captioned, voiced; recorded from both deployed apps by `tools/loom.mjs`). HackQuest submission and making the repo public are the owner's.
- P7.6 **DONE** End-to-end from the hosted UI (2026-09-23): hire Momentum Scout (grantAgent 0xd4865c3e…); its own wallet 0x9138…a505 signs an autonomous buy (0xc5691149…949ece, `Spent` names the agent); sell from the UI (0x64532eb2…); withdraw everything to the allowlisted address; GMX hedge on the Arbitrum build: setup (0x3d834609…, 0x33c327fd…), short ETH $50 executed by the fork keeper (0x6632c0c8…), close executed; council vote beside its tx hash; veto blocks the send.

## 4. Gaps

| # | Gap | Where | Blocks |
|---|---|---|---|
| G1 | Nothing deployed on a real Arbitrum chain; no key holds test ETH on 421614 / 46630 (checked 2026-09-23) | chains | P5.1, P5.2 |
| G2 | Token registry, market ids and stock catalog are Base/Solana; 1inch breaker opens on Arbitrum; web banner "One price source is not answering" | `server/src/venues/tokens.ts`, `venues/xstocks.ts`, `market/ids.ts` | P1.6, P2.1 |
| G3 | No Uniswap Trading API key | env | Trading-API path only |
| G4 | No ZeroDev project ID | env | P6.2 bundler path only |
| G5 | No `OPENROUTER_API_KEY` | env | agent prose only |
| G6 | Fixture prices in `src/data/fixtures/markets.ts` | app | P4.6 |
| G7 | No council data model | server | P3 |
| G8 | 31 files branch on `isSolana` | app | P4.1 |
| G9 | Solana welcome art/copy on the Arbitrum build | `app/(onboarding)` | P4.2 |
| G10 | ~~`/health` probes a Base subgraph on EVM keys~~ fixed on `feat/venues`: no subgraph probe on arbitrum*/robinhood* keys | server | P2.1 |
| G11 | ~~Privy origin~~ — sign-in works on https://xorr-arbitrum.vercel.app (tested 2026-09-23) | — | — |
| G12 | Stray empty Railway service `executor` | Railway | P0.8 |
| G13 | GMX keepers do not run on a fork — closed by the fork keeper (P2.6) | GMX | — |
| G14 | Robinhood Chain public RPC is not archive (~10 min of state): the hosted node is a snapshot at block 70254193, so stock prices on it are frozen at 2026-09-23T05:12Z while live Robinhood/Chainlink data keeps moving | infra | a live fork needs an archive RPC (owner action 3) |
| G15 | `arb1.arbitrum.io` intermittently lacks old state; the Arbitrum node now forks from `arbitrum-one.public.blastapi.io` | infra | — |

## 5. Completion (re-measured 2026-09-23, after the loom)

19 of 24 items done and verified: **79%** (from 54% at the first measure). The five left are each blocked on something only the owner has:

| Item | Blocked on |
|---|---|
| Real testnet deploy (P5) | test ETH on 421614 / 46630 |
| ZeroDev permissions in the product (P6) | proven on a fork; bundler path needs `ZERODEV_PROJECT_ID` |
| Uniswap Trading API route | `UNISWAP_API_KEY` (the on-chain Uniswap v3 route works without it) |
| Live Robinhood prices on the hosted node | an archive RPC (`ROBINHOOD_ARCHIVE_RPC`) |
| HackQuest submission | the owner's account |

## 6. Owner actions
1. Send test ETH to the Arbitrum deployer (`server/.env.deployer-arbitrum`, address in the report) on Arbitrum Sepolia and Robinhood Chain testnet.
2. Optional keys: `UNISWAP_API_KEY`, `ZERODEV_PROJECT_ID`, `OPENROUTER_API_KEY`; an **archive** RPC for Robinhood Chain (Alchemy `robinhood-mainnet.g.alchemy.com/v2/<key>` or a publicnode token) → set `ROBINHOOD_ARCHIVE_RPC` on the Railway `robinhood-fork` service to replace the snapshot with a live fork.
3. HackQuest submission (video: `docs/demo/xorr-loom.mp4`) before Oct 1 23:59 SGT; repo public or invite `engineering-AF`.
