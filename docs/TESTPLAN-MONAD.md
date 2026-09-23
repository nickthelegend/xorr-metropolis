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
