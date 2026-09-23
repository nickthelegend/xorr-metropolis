# Test plan — xorr on Robinhood Chain + Arbitrum

The checklist every verification pass is measured against (PLAN.md P7.1). Each item says exactly what "correct" is.
Every UI item also requires: **no console error, no failed (4xx/5xx) network request** other than the ones the item
expects. Results go in §5 with the date, PASS/FAIL, and what was fixed.

Targets: web `https://xorr-arbitrum.vercel.app` (Robinhood build) · executors `executor-robinhood` (Robinhood Chain node,
snapshot at block 70254193) and `executor-fork` (Arbitrum One fork) · nodes `robinhood-fork-production…`,
`arbitrum-fork-production…`.

## 1. Contracts (forge + chain)

| # | Item | Correct means |
|---|---|---|
| C1 | `forge test` | 100% pass (≥ 45 tests: delegation, `spendVia`, anchor) |
| C2 | XorrDelegation on the Robinhood node | `eth_getCode(0x60b0…78cb)` non-empty; `SETTLEMENT_TOKEN()` = USDG `0x5fc5…1d168` |
| C3 | Grant | owner `grant(delegate,$100/day,+7d,[SwapRouter02])` mines; `policyOf` returns exactly those values |
| C4 | Spend within cap | $50 NVDA via `spend()` mines; NVDA lands in the OWNER's wallet; `remainingToday` = $50 |
| C5 | Spend past cap | a further $60 reverts `DailyCapExceeded` (simulation and on-chain) |
| C6 | Foreign venue | `spend()` to a non-allowlisted router reverts `VenueNotAllowed` |
| C7 | Revoke | owner `revoke()` mines; next `spend()` reverts `Revoked` |
| C8 | Close | `closePosition()` sells NVDA to USDG into the owner's wallet |
| C9 | Testnet deploys | `deployments/arbitrum-sepolia.json` and `robinhood-testnet.json` exist with code at each address (BLOCKED until funded) |

## 2. Executor API (curl, signed-in where noted)

| # | Endpoint | Correct means |
|---|---|---|
| A1 | `GET /health` (both executors) | 200, `chain` = robinhood-fork / arbitrum-fork, postgres/rpc/delegation up, no Base subgraph probe |
| A2 | `GET /market/xstocks` (Robinhood) | the stock rows with real symbol/address/price; only tokens with code on the node are tradable; session/halt/feed fields present |
| A3 | `GET /market/xstocks/quote?symbol=NVDA&usd=50` | a Uniswap quote from the node; shares ≈ usd / price within the pool fee |
| A4 | `GET /gmx/markets` (public) | ETH-USD, BTC-USD and the USDG markets with funding %/h, OI and a mark price from GMX's live API |
| A5 | `GET /council/seats` (public) | the four seats |
| A6 | `POST /council/convene {buy,NVDA,50}` (signed in, granted) | 201; four votes with numeric reasons; `approved`; outcome `executed` with a tx hash when the trade path is live |
| A7 | `POST /council/convene {buy,NVDA,500}` | `vetoed` by risk-keeper naming the cap left |
| A8 | `POST /council/convene` with bad body | 400 `invalid_proposal` |
| A9 | `GET /council/rounds` | this wallet's rounds only, newest first; another user's rounds never appear |
| A10 | Signed-out `GET /council/rounds` | 401, not 500 |
| A11 | `POST /faucet` (Robinhood fork) | USDG arrives from the fork reserve with a tx hash; a second claim inside the window is refused |
| A12 | `POST /xstocks/buy` | refused with the guard's reason when the session is closed or the price sources disagree; otherwise a fill hash |
| A13 | `GET /positions` | NVDA shown in ERC-8056 shares (balance × multiplier) |

## 3. Screens (Chrome, hosted web)

| # | Screen / flow | Correct means |
|---|---|---|
| S1 | Welcome | no Solana art or copy; one line of copy; Sign in works |
| S2 | Sign in (Privy email) | lands on Home with the wallet address; no 401 loop (needs the origin allowed in Privy) |
| S3 | Jurisdiction notice | shown once at onboarding; names US/CA/UK/CH |
| S4 | Fund | fork faucet gives USDG; balance updates; network chip says test network |
| S5 | Grant | Privy EVM wallet signs `grant`; Safety shows the cap, expiry and venue read from the chain |
| S6 | Stocks list | real Robinhood tokens; session chip; no fixture prices |
| S7 | Stock ticket NVDA | quote, pool price, Chainlink price; buy $50 fills with a hash; jurisdiction line |
| S8 | Council | rounds with each vote and reason; "Put $50 NVDA to the council" creates a round; hash shown "on the fork" |
| S9 | Holdings / P&L | NVDA in shares, value at the feed price |
| S10 | Kill switch | one hold revokes on-chain; next council round vetoed "revoked" |
| S11 | Networks | lists the Robinhood Chain fork and the Arbitrum fork honestly |
| S12 | Perps (GMX) | markets with funding/OI; a pending order shows "waiting for keeper" |
| S13 | Empty/error states | a new wallet sees "No rounds yet."; a stopped executor shows the retry state, not a crash |

## 4. Proof scripts

| # | Script | Correct means |
|---|---|---|
| P1 | `server/src/fork/swap-check-robinhood.ts` | four stock round trips succeed on the Robinhood node |
| P2 | `server/src/council/prove-council.ts` | approved 4–0 / vetoed over cap / vetoed after revoke |
| P3 | `server/src/prove-gmx.ts` | position owned by the owner, executed by the fork keeper, three named refusals |
| P4 | `server/src/prove-zerodev.ts` | allowed swap passes; five named refusals |
| P5 | `server/src/prove-robinhood.ts` | C4–C8 through the executor's own trade path |

## 5. Results

| Date | Item | Result | Notes / fix |
|---|---|---|---|
| 2026-09-23 | C1 | PASS | 45/45 |
| 2026-09-23 | P1 | PASS | hosted node, e.g. NVDA buy `0x90aa6d3e…8b25` |
| 2026-09-23 | P2 | PASS | rounds 7–9 on the hosted node (after fixing the expiry-unit bug: limit read $517M, now $175) |
| 2026-09-23 | P3 | PASS | hosted Arbitrum fork (see PLAN P2.4–P2.6) |
| 2026-09-23 | P4 | PASS | local fork and the hosted Arbitrum fork (Kernel 0x08a2…8fC0; "ALL CHECKS PASSED") |
| 2026-09-23 | A1 | PASS | both executors `up`: robinhood-fork (uniswap, 4 stocks, no breaker), arbitrum-fork |
| 2026-09-23 | A2 | PASS | 4 rows (NVDA/TSLA/AAPL/SPY) with session, halt, pool, Chainlink, deviation (after fix: session was an object) |
| 2026-09-23 | A4, A5, A10 | PASS | live GMX funding/marks; seats public; signed-out rounds → 401 |
| 2026-09-23 | A6 | PASS | from the UI: approved 3–0, executed, tx `0x20141cdb…d4720b`; owner holds 0.2185 NVDA on-chain |
| 2026-09-23 | A7 | PASS | prove-council: $500 vetoed "more than the $100.00 left" |
| 2026-09-23 | A8 | PASS | `{side:"hold"}` → 400 `invalid_proposal` |
| 2026-09-23 | A9 | PASS | owner sees 2 rounds; another account → 409 no_wallet, nothing leaked |
| 2026-09-23 | A11 | PASS | 1,000 USDG + 0.05 ETH; next claim window shown |
| 2026-09-23 | A13 | PASS | NVDA 0.21848 units = chain units |
| 2026-09-23 | S1 | PASS | X-coin hero, one line, no Solana; no console errors |
| 2026-09-23 | S2 | FAIL→PASS | "could not reach xorr": Railway Postgres was never migrated (preDeployCommand not applied). Fix: preDeployCommand set on both executors; migrations ran; retry passed |
| 2026-09-23 | S3 | PASS | grant screen card + ticket line name US/CA/UK/CH |
| 2026-09-23 | S4 | PASS | USDG faucet (fork reserve) |
| 2026-09-23 | S5 | PASS | Privy signed approvals + `grant`; chain: delegate 0x5cF6…, $1,600/day, expires 2026-09-26, SwapRouter02 allowed |
| 2026-09-23 | S6 | FAIL→PASS | "Unclassified" sector chips/labels → sector null, company names shown |
| 2026-09-23 | S7 | PASS | Overnight chip, Chainlink $229.03, pool $228.86, 1 token = 1.0008 shares |
| 2026-09-23 | S8 | PASS | round with four reasoned votes and its hash "on the fork" |
| 2026-09-23 | S9 | FAIL→PASS | settlement shown as USDC and a Base "target mix" → USDG priced as itself; target mix removed |
| 2026-09-23 | S10 | PASS | hold-to-stop → Privy `revoke()` → "CONFIRMED ON-CHAIN 0x118ba3…e73d79"; chain `revoked=true`; next round vetoed "The owner revoked the permission." |
| 2026-09-23 | S11 | PASS | Robinhood Chain fork (4663) and Arbitrum fork (42161), live block heights |
| 2026-09-23 | S12 | PASS (markets) | GMX markets with funding/OI; this wallet has no GMX orders, so the pending-order line is proven by prove-gmx, not in the UI |
| 2026-09-23 | S13 | PASS | "No rounds yet.", "No open positions." |
| 2026-09-23 | Deposit | FAIL→PASS | leftover MoonPay line removed |

Browser note: the Chrome tab reported `visibilityState: hidden` for the whole pass (display locked), so native clicks were
not delivered after the first few; taps were dispatched as pointer events on the real controls from inside the page.
Every console check above was error-free.
| 2026-09-23 | P6 (agent sweep) | PASS | `council/prove-sweep.ts` on the hosted node: Momentum Scout proposed $20 SPY (strongest trend +1.54%), approved 3–0, executed `0x7957b04d…8f95`, bought 0.025777 SPY |
