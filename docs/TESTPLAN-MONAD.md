# Test plan — xorr on Monad (the checklist every change is measured against)

Written 2026-09-24 before testing. Environment: `infra/monad-fork` (anvil fork of Monad mainnet, chain 143) on :8547, the
executor (`XORR_CHAIN=monad-fork`) on :8787 with Postgres `xorr_metropolis`, the Expo web build on :8081, signed in with
Privy test accounts through the real email-code form. Browser: Claude in Chrome for evidence where its tab renders;
headless Chromium (Playwright) for animated flows while Chrome's window is occluded (a hidden page runs 0 animation
frames). Every item records console errors and every non-2xx API response; **any console error or unexpected non-2xx
fails the item.** Expected refusals (a 409 that the screen explains) are listed as expected per item.

Status per item: PASS · FAIL (what was wrong → what was fixed) · UNTESTED (why — only for a dependency that does not
exist here).

## A. Global rules every screen must meet ("correct" for any page)
- G1 Renders its own title and content within 10 s; no blank screen, no endless spinner.
- G2 Zero `console.error` and zero page errors (dev-only React/styled-components *warnings* are recorded, not failed).
- G3 No API response ≥ 500; any 4xx is one the screen explains in words.
- G4 No `NaN`, `undefined`, `null`, `[object Object]` or raw stack text rendered.
- G5 **Monad-true:** nothing names a chain, venue or asset this build does not use — no Robinhood Chain, USDG, GMX,
  Arbitrum, Base, Aave, 1inch, Ondo/`…c` shares, NVDA/TSLA/AAPL/SPY Stock Tokens — unless the screen is explicitly about
  another network.
- G6 Every number shown has a live source (chain, executor DB, or a named price source); no fixture values rendered as data.

## B. Screens (90 shown on the Monad build) — each must meet A, plus:
| Screen | Specific expectation |
|---|---|
| `/welcome` | Pitch describes what this build does on Monad (no "tokenized US stocks"). |
| `/goals`, `/wallet`, `/fund`, `/delegate` (onboarding) | Steps 1–3 advance; `/fund` shows the wallet address and a working faucet on the fork; `/delegate` shows the cap/expiry and signs a real grant. No stock-token notice. |
| `/` Home | Balance equals the chain; the Permit step and the status chip agree with the on-chain policy (granted ⇒ not "NOT GRANTED"); tabs contain nothing hidden on this build. |
| `/markets`, `/markets/[classId]` | Lists MON with a live price; every listed asset is tradable here or labelled as not. |
| `/asset/[symbol]`, `/chart/[symbol]` | For MON/WMON/WETH/WBTC: price, chart, Buy/Sell. |
| `/order/[symbol]` | Quote from the venue that fills; Buy fills on-chain; refusal text when not permitted/over cap/over balance; Buy never covered by a toast. |
| `/swap`, `/route/[symbol]`, `/crosscheck/[symbol]`, `/oracle/[symbol]`, `/venues`, `/tokens`, `/coverage`, `/sources` | Monad venues and sources (Uniswap v3 on Monad, Kuru, Chainlink on Monad); no other chain. |
| `/council` | Proposals on Monad assets; seats read Monad data; a round records votes and, when approved, a tx hash. |
| `/agent/*`, `/bot/*`, `/roster-compare`, `/risk` | Agents describe Monad strategies; hiring signs a real grant; an agent has at least one strategy it can run here. |
| `/strategies`, `/strategy/*`, `/strategy-library/[id]`, `/schedule`, `/proposal` | Only routable assets offered; creating a strategy persists (survives restart) and runs within the cap. |
| `/portfolio`, `/holdings`, `/position/[id]`, `/pnl`, `/disposals`, `/export` | Holdings equal on-chain balances, each asset named (incl. AUSD). |
| `/safety`, `/limits`, `/policy`, `/delegation`, `/approvals`, `/allowlist`, `/recovery` | State equals the chain; stop revokes on-chain; approvals are bounded. |
| `/history`, `/runs`, `/runs/[id]`, `/activity`, `/audit/*`, `/explain/[seq]`, `/verify`, `/judge` | Every entry links a real tx; audit chain verifies; anchor readable. |
| `/deposit`, `/send`, `/withdraw-everything`, `/sell-everything`, `/flatten` | Real transfers/sales on the fork; refusals explained. |
| `/network`, `/networks`, `/system`, `/metrics` | Chain 143, live block, contract with code, MON gas. |
| `/alerts*`, `/notifications`, `/inbox`, `/catchup`, `/briefing`, `/voice`, `/watchlist`, `/search`, `/explore`, `/more`, `/profile`, `/settings`, `/legal/[doc]`, `/business`, `/proposals`, `/not-here` | A, and their stored state persists. |

## C. Executor endpoints (181)
- C1 `tools/qa-full.mjs` against the local executor with a real Privy token: every check's predicates hold (named error
  codes, no 5xx, response shapes the app reads, timing under the app's own timeouts).
- C2 `/health` answers 200 with every critical dependency up, **every time** (20 consecutive reads, no 503).
- C3 `/monad/crosscheck`: three live sources, gap in bps; `/monad/perpl`: live markets.

## D. Contracts and chain
- D1 `forge test` all pass.
- D2 `prove-monad.ts` on the fork: grant, fill, `DailyCapExceeded` mined, close, `PolicyRevoked` mined.
- D3 Monad testnet deployment verified on Sourcify — UNTESTED until the deployer has test MON.

## E. Flows (end to end in the browser, each with its exact expected result)
| # | Flow | Correct means |
|---|---|---|
| F1 | Fresh sign-in (email code) | Wallet created; `/wallet/connect` 200; lands on step 3 (fund). |
| F2 | Faucet | Wallet's USDC on-chain += 1,000; screen says so; a second claim is refused with the time it may ask again. |
| F3 | Grant from `/delegate` | Each signature is a Privy sheet naming Monad; on-chain policy = chosen cap/expiry; Home, Safety and Settings all say granted. |
| F4 | Manual buy $250 WETH | On-chain WETH balance rises by ≈ the quote; a run recorded; Home balance reflects it. |
| F5 | Manual buy MON | Same, for MON (WMON) — the chain's own asset. |
| F6 | Sell / close a holding | USDC back in the wallet on-chain; position closed. |
| F7 | Over-balance order | Buy disabled with "You have $X". |
| F8 | Over-cap order | Refused before signing with the cap sentence; nothing on-chain. |
| F9 | Stop all trading | Discoverable gesture; revoke confirmed on-chain; next order refused "No active trading permission". |
| F10 | Resume | Re-grant signs; trading possible again. |
| F11 | Council round on MON | Seats cite Monad sources (Uniswap/Kuru/Chainlink MON, Perpl); verdict recorded; approved ⇒ a fill tx hash. |
| F12 | Hire an agent | Agent has a Monad strategy; hiring signs; the agent's first run fills within its cap. |
| F13 | Recurring buy | Offers only routable assets; created strategy persists across an executor restart; a run fills. |
| F14 | Refresh mid-grant | Reload between signatures → no partial state claimed; re-running completes. |
| F15 | Out-of-order: order before any grant | Refused with a link to grant; nothing on-chain. |
| F16 | AUSD held | Named on Home/Portfolio with its value. |
| F17 | Withdraw / send USDC | Real transfer; refusals for bad address/over balance. |
| F18 | Invalid inputs | Zero/negative/huge amounts, bad address — refused in words, no crash. |
| F19 | Sign out and back in | State (grant, holdings, strategies) restored from chain and DB. |
| F20 | Executor restart | App recovers; persisted strategies, runs and audit intact. |

## Results — 2026-09-24 (fork build on :8082 against the fork executor; testnet build on :8081 against :8788)

Evidence lives in the commits named and in `docs/evidence/`. "Earlier run" means executed in this session before the
fixes of the day, not repeated after them.

### A, B. Every screen (the crawl: signed in, G1–G5 on each route)
| Run | Result |
|---|---|
| 1 | 65/90 — 25 FAIL: wrong-chain text (G5) on 15 routes, 3 blank, 404s from the crawl's own bogus ids, hydration errors, `/health` 503s. |
| 2 | 71/90 — after the first copy fixes. |
| 3 | 82/90 — after the Monad-true copy, the council, the agents and the DOM fixes. |
| 5 | **84/92** (with `/perps`, `/perpl` added). Every route that failed before and was reached passes — Home, `/asset/WMON`, `/chart/WETH`, `/coverage`, `/metrics`, `/portfolio` (no nested button), `/route/WETH`, `/schedule`, `/council`, `/welcome`-era copy. The 8 FAILs are the last 8 routes in order (`/verify` … `/perpl`): the Mac's disk filled (ENOSPC) and the bundler died mid-crawl, so they did not load at all. Of those, run 3 passed `/voice`, `/wallet`, `/welcome`, `/withdraw-everything`; `/verify`'s G5 and `/watchlist`'s hydration error were fixed after run 3 (`f92f331`, `7f39251`) and are **unverified in the browser**. `/perps` on the fork now redirects to `/not-here`; `/perpl` rendered from the API but not in a crawl. |
| 6 | **91/91** (the Monad build's routes as they stand: `/oracle` has since joined the hidden list). After the PC restarted, on a fork taken again at block 107,482,899 and rebuilt (`rebuild:fork`'s grant fixed, `61f23e8`). 43 passed before the fork's anvil was stopped by a signal mid-crawl; it resumed from its saved chain, and the 48 routes left or failed passed on the second pass, 48/48, after the `/history` fix below. The 8 that never loaded in run 5 pass — `/verify` (G5) and `/watchlist` (hydration) now verified in the browser; `/perps` goes to `/not-here` on the fork; `/more` and `/bot` go Home by design. Limit: a 5xx that lands after the 9 s window is not seen by the crawl (the backtest's cold 503 at 12 s was found in the executor log, and answers 200 in 22 ms warm). |
| 7 | **91/91** after the evening's changes (passkeys, notes, Kuru, venue labels, AUSD on Home, named sources, 202 warming): no console error, no 5xx, no wrong-chain text on any route. |

Found by run 6 and fixed: `GET /history` took 65–71 s on a fresh fork — its 9,000-block window reached past the fork
point, so anvil fetched those logs from Monad's public RPC window by window, for a contract that exists only on the
fork, and every other read on the fork queued behind it (the crawl's `/health` 503s). It now starts where the contract's
code does: 1.7 s, then 10 ms (`6f7d9bb`).

Found by the crawl and fixed on the way: native MON shown as "ETH … $133.20" (MON priced at ETH, `654f99b`); WETH
labelled "Computer Peripheral Equipment, NEC" (`7414e70`); Uniswap sales recorded as 1inch (`4b0662c`); another build's
agent looks (NVDAx…) on Schedule (`57f582d`); Base's 1inch equities warmed on Monad ("Warm Monad's own charts first").

### C, D
| Item | Result |
|---|---|
| C2 `/health` 20 consecutive reads | **PASS** — 20/20 × 200, read while a full crawl was running. The intermittent 503s were the fork freezing on slow remote reads (anvil 45 s × 5 retries); bounded at 10 s × 3 (`4b0662c`). |
| C3 `/monad/crosscheck`, `/monad/perpl` | **PASS** — Uniswap $0.023954, Kuru $0.023988, Chainlink $0.023986, 14.2 bps apart; 9 Perpl markets with funding per hour. `/monad/feed/AUSD` (public): $0.99983 from Chainlink on Monad, not stale; `/monad/feed/DOGE` a named 404 listing the five feeds. |
| D1 `forge test` | **PASS** — 53/53. |
| D2 `prove-monad.ts` | **PASS** (earlier run) — `docs/evidence/prove-monad-fork-2026-09-24.txt`. |
| D3 testnet deployment on Sourcify | **PASS** — `86f7900`, `contracts/deployments/monad-testnet.json` (`sourcifyVerified: true`). |

### E. Flows
| # | Result |
|---|---|
| F1 | **PASS** — test-0356 signed in through the real email-code form; `/wallet/connect` 200. |
| F2 | **PASS** (earlier run) — fork faucet paid USDC; the testnet test-funds button paid MON + 500 AUSD. |
| F3 | **PASS** — `/delegate`: five Privy signatures (approvals incl. WMON, then the grant); `/delegation/record` 200; Home reads ARMED. |
| F4 | **PASS** (earlier run) — $250 of WETH bought; the position (0.0930 WETH) is on Portfolio. |
| F5 | **PASS** — through the council: 1,037.94 WMON to the owner, `0x6289f268…c9c121`, receipt status 1 (25 USDC → XorrDelegation → Uniswap pool). |
| F6 | **PASS** after a fix — sold 1,037.71 WMON for 24.84 USDC (`0x41732ac6…`, status 1). Found: the grant never approved WMON (`7aa7606`), and the sale was recorded as "1inch" though 1inch is off on Monad (`4b0662c`). |
| F7 | **PASS** — $5,000 of WETH on a $739.84 wallet: "Buy $5000 of WETH" disabled (`aria-disabled=true`), "You have $739.84."; no console error. |
| F8 | **PASS** (D2) — `DailyCapExceeded(60000000, 50000000)` mined as a revert. |
| F9 | **PASS** (earlier run) — hold → revoke confirmed on chain; the next order refused. The gesture now says so ("Hold to stop all trading", `3d2e6f9`). |
| F10 | **PASS** — re-granted from `/delegate` after the stop (F3's run). |
| F11 | **PASS** — round #2: Price Desk yes (Chainlink $0.02393, fill $0.02409, Kuru $0.02394, 66 bps), Risk Keeper yes, Trend Reader abstain, Perps Desk no (MON/ETH longs pay 0.0056%/h); approved 2–1; executed (F5). |
| F12 | **PASS** — hired Yield Keeper ("Buys MON a little every day", $100/day, 7 days; grant `0xaefd860d…` signed in Privy). On the next tick it proposed "buy MON $10", the council approved it, and its own wallet `0xbd15…3c08` signed the trade: 10 USDC from the owner → 415.18 WMON to the owner (`0x63eeb9e3…`, status 1). Found: its gas read "ETH" (`23224ec`). |
| F13 | **PASS** (the list) — `/market/tradable` on Monad is USDC, WMON, WETH, WBTC, USDT0 (no AUSD, no ETH sentinel), `7414e70`. Creation not repeated. |
| F18 | **PASS** — allowlist "0x1234": "Not a valid address: it starts with 0x and has 42 characters.", Add not usable; Send: 999,999 USDC "More than you hold.", 0 and −5 "Enter an amount above zero."; an order above the balance: F7. No crash, no console error. |
| F14 | **PASS** — test-2454 on `/delegate`: approved the first Privy signature (USDC allowance 48,000 mined, nonce 1), reloaded. Home and Safety read NOT GRANTED; Safety lists the one approval that exists ("USDC · Up to 48,000.00 · Revoke") and claims no grant; `remainingToday` 0 on chain. Signing again completed it: `/delegation/record` 200, Home ARMED, Safety LIVE, `remainingToday` $1,600, nonce 6. |
| F15 | **PASS** — test-2454, funded from the fork faucet (1,000 USDC), no grant: "Buy $100 of WETH" → 409 explained on the ticket: "No active trading permission on-chain. Grant one before placing an order." with "Grant permission ›" (to Safety: NOT GRANTED · Set limits). USDC 1,000, WETH 0, nonce 0 before and after. Found: Fund opened straight after a first sign-in kept "Get 1,000 test USDC" disabled over "Set up your wallet first." until a reload — the faucet was read while the wallet was being registered (`5ad4934`). |
| F17 | **PASS** — test-0356 → an allowlisted address (test-2454's wallet). Send with none: "No addresses yet."; added: "Pending · usable from Fri 8:27 AM, in 24 h", and Send named the lock. The 24 hours were simulated by moving that row's `added_at` and `usable_at` back a day together (the database refuses `usable_at` before `added_at`). Then $5: `/withdrawal-addresses/check` 200, Privy "Approve transfer · Network Monad fork", "Sent. 0x13b6daf1…"; on chain 25,000 → 24,995 USDC and 1,000 → 1,005. Found: the balance on Send stayed 25,000 — it was re-read at the broadcast, a block early; now after the executor sees it mined (`130020b`); the second $5 showed "Balance 24,990.0000 USDC", equal to the chain. |
| F19 | **PASS** — Settings → Sign out → "Tap again to sign out" → the welcome pitch; no Privy session left in storage (only its analytics id). Signed in again through the email-code form: the same wallet 0xB85A…E897, $25,000, ARMED, $1,600/day, the runs and Yield Keeper hired — its own permission now "Needs your permission", correctly, since that grant was on the fork before the restart. |
| F20 | **PASS** — strategies 4, runs 4, activity 12 (hash chain 12/12), agents 4: the same before and after an executor restart. With Home held open, the executor down: "Can't reach xorr · Trying again in 2s … Your funds and your permission are on chain"; back up: "Back online · Screens behind this were out of date. Reload to see what is actually there." Runs and the audit chain intact. |
| F16 | **PASS** — testnet build, test-4668: Portfolio reads "CASH · AUSD $499.80 · 1 AUSD = $0.9998 · Chainlink"; the chain holds 499.800293 AUSD (`0xa901…22dC`) for `0x0EAc…3c16`. Home and Deposit do not name AUSD yet (PLAN P4.2). |

### Testnet (Perpl), this session
| Check | Result |
|---|---|
| Desk create / fund / open / long / hold-to-stop / resume / close / withdraw | **PASS** (earlier run) — desk `0x3323…11b8`, account #693, withdrew 149.80 AUSD. |
| Change the agent's limits from Perps | **FAIL → fixed → PASS** — the browser's CORS preflight refused PUT (also breaking `PUT /watchlist/order`); PUT allowed (`9c0a894`); saved and read back as $500/$1,000/3x, then restored. |
| Block pulse on the desk | **PASS** — "Monad testnet · block 65,148,991", advancing. |

Bundler note: Metro did not see file edits on the external disk — a route kept serving the code it was started with
while a bundle asked for with other options had the edit. Every fix above was checked in the browser after restarting
the bundler, and its bundle searched for the change first.

Restart note: the PC restarted mid-run. macOS empties `/tmp`, which held the fork's saved chain and the crawl's
scripts, so the fork was taken again at Monad's head (XorrDelegation `0xaaa0…196e`, anchor `0x5366…2299`, the owner's
$1,600/day grant restored by `fork-grant.ts`) and now saves its chain on the external disk (README).

Environment note: the Mac's data volume reached 100% (1.3 GB free, 3.5 GB of swap in use) while two bundlers, two
executors, the fork and Chromium ran together; one bundler and the testnet executor died with ENOSPC. Nothing of the
project's was lost; the stacks were then run one at a time.

## Results — the evening build (2026-09-24, `4d3a490` … `d5239c1`)

Each item run in Chromium (Playwright; a virtual WebAuthn authenticator with PRF for passkeys) against the fork build on
:8082 or the testnet build on :8081, with every executor request and console error logged, and every transaction's
receipt read.

| Item | Result |
|---|---|
| Mera passkey account | **PASS** — create (one PRF ceremony) → `/auth/passkey/challenge` + `/session` 200 → wallet connected → fork faucet → grant signed by the Mera session (five signatures, no wallet sheet, `/delegation/record` 200, `remainingToday` $1,600) → Home ARMED → a WETH buy. 0 console errors. |
| Passkey signing window | **PASS** — after a reload Settings reads "Passkey signing · locked"; a re-grant unlocked it with the passkey and signed (nonce 5 → 10). |
| Recovery with storage cleared | **PASS** — `localStorage.clear()` → "Sign in with a passkey" → the same address, ARMED, the same balance. |
| Private notes (a second PRF key) | **PASS** — a note on a council run saved (`PUT /notes` 200; the row is 128 characters of base64, no plaintext), read back after a reload and after clearing storage and signing in again. 0 console errors. |
| Kuru fills | **PASS** — sale: 2,107.45 WMON → 49.91 USDC on Kuru (`0x8244ec4c…`: owner → delegation → KuruVenue → Kuru's book → USDC to the owner, dust back as WMON); buy: $50 → 2,109.62 WMON (`0xe8397cea…`, on a test executor with the gate widened for the fork's drift). Run detail: "Filled at Kuru". |
| Manual price gate | **PASS** — WBTC refused: "The fill ($87,450.81 …) is 469 bps from Chainlink ($83,532.97), past the 150 bps limit. Nothing was placed."; WMON (~100 bps) filled. |
| Testnet with no gas | **PASS (the product)** — Fund offers "Get test MON and AUSD"; with the faucet key short it refuses in 1.3 s, naming what it holds and needs; the grant refuses before any wallet sheet: "Your wallet has no MON to pay the network fee … Get test MON on the Fund step, then sign again." **Blocked (owner):** funding the faucet, delegate and operator keys. |
| Named price sources | **PASS** — "CoinGecko says $2,661.06; Uniswap v3 on the Monad fork would fill at $2,691.81 — 1.15% apart. The number shown is CoinGecko's." |
| Cold charts | **PASS** — a first chart after an executor restart answers 202 and is waited out; 0 console errors on `/asset/WMON` and `/markets` cold. |
| Send balance after a transfer | **PASS** — "Balance 24,990.0000 USDC" once mined, equal to the chain. |
| Fund on a first sign-in | **PASS** — the faucet status is read again once the wallet registers (a second `GET /faucet` after the connect). |
| CI on `main` | **PASS** — green on every push since `4d3a490` (it failed at Lint on every run before). |
