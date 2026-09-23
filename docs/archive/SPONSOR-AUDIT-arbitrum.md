# Sponsor tech audit and 50 load-bearing features: xorr on Arbitrum

Written 2026-09-23 against commit `9ff293f`+ of `xorr-arbitrum` (a fresh copy of xorr-solana main `f5c32aa`), for the
**Arbitrum Open House Singapore Online Buildathon** (HackQuest; deadline Oct 1 23:59 SGT per the T&C PDF, Oct 4 per
HackQuest; must be deployed on an Arbitrum chain; extra consideration for Paxos USDG; ≥1 of 3 places per track reserved
for a Robinhood Chain project).

## 1. What each sponsor's tech actually offers (researched, with the parts that matter to judging)

| Sponsor tech | What it exposes (verified 2026-09-23) | What "meaningful use" means for this event |
|---|---|---|
| **Arbitrum One / Sepolia** | EVM L2, chain 42161 / 421614; Stylus (Rust/C/C++ contracts); ArbOS precompiles; public RPCs `arb1.arbitrum.io/rpc`, `sepolia-rollup.arbitrum.io/rpc` | Hard requirement: "must be deployed on an Arbitrum chain". Judged on smart-contract quality. Founder House blog gives a bonus to Rust/C/C++ (Stylus) apps. |
| **Robinhood Chain** | Arbitrum Nitro L2, mainnet **4663** (live since 2026-07-01), testnet 46630; ~195 **Stock Tokens** (ERC-20, 18 dp, **ERC-8056 `uiMultiplier()`**); a Chainlink feed per token (8 dp, 24h heartbeat); read-only REST APIs `api.robinhood.com/rhj/assets` (tradingCapabilities per session: market/extended/overnight), `/rhj/prices/{sym}` (bid/ask, `isTradingHalt`), `/rhj/corporate-actions` (splits, dividends); Uniswap v3 + UR 2.1.2 deployed; not for US/CA/UK/CH persons | ≥1 of 3 prizes in every track goes to a Robinhood Chain project; Founder House has a $60K Founder-in-Residence and a $30K Innovation Award. Past Robinhood winners made stock tokens *productive* (Tilt, EqualFi, Agama, Saffron). |
| **Uniswap Trading API** | `trade-api.gateway.uniswap.org/v1` with `x-api-key`: `/quote` (CLASSIC / UniswapX DUTCH_V2/V3 / PRIORITY / WRAP / BRIDGE routing), `/swap` (Universal Router 2.1.2 calldata), `/order` (gasless UniswapX), `/check_approval` (Permit2); `x-permit2-disabled`, `generatePermitAsTransaction` for smart accounts; supports **42161 and 4663**, **not 421614** | Not a listed sponsor on the form, but the owner's spec names it; the only single integration covering both Arbitrum One and Robinhood Chain. |
| **GMX V2** | ExchangeRouter `0x7dE39FF2…` (live, not the repo's `0x1C3fa…`), Router, OrderVault, DataStore, Reader; `createOrder` via multicall (sendWnt + sendTokens + createOrder); two-step keeper execution; REST `arbitrum-api.gmxinfra.io` (`/markets/info` funding/borrow/OI/liquidity, `/prices/tickers`, `/signed_prices/latest`); `@gmx-io/sdk` 2.1.1; SubaccountRouter (native delegated trading keys); **USDG-backed ETH/BTC markets listed 2026-09-16**; UI-fee receiver and referral codes for on-chain attribution; Arbitrum Sepolia deployment exists | Listed sponsor. Judges will look for real positions, pending-order tracking (keepers), and on-chain volume attribution. |
| **ZeroDev** | Kernel v3 smart accounts; `@zerodev/permissions`: CallPolicy (target + selector + arg conditions), RateLimit, Timestamp, Gas, Signature-caller policies; ECDSA signer; serialize/deserialize a permission account so a backend holds a session key; bundler + paymaster at the project RPC; policy contracts verified on both 42161 and 421614 | Listed sponsor (Growth Plan code ARBZERODEV). Meaningful = the agent's authority *is* a ZeroDev permission, not a side feature. |
| **Chainlink** | AggregatorV3 feeds on Arbitrum One (NVDA/USD, TSLA/USD …, equities valid only in market hours) and on Robinhood Chain (one per Stock Token, multiplier-inclusive); Data Streams (GMX's oracle) | Launch partner of Robinhood Chain; the honest price source for stock tokens. |
| **Paxos USDG** | Arbitrum One `0x004B5068…9bbC` (6 dp); Robinhood Chain `0x5fc5360D…1d168`; GMX USDG markets; USDG/USD Chainlink feed on 4663; Robinhood Earn ~7% | **Explicit "extra consideration" in the judging text.** |
| **OpenZeppelin** | Solidity + Rust-for-Stylus contract libraries | Contract-quality signal. |
| **Dune** | SQL analytics over Arbitrum / Robinhood Chain; Sim API | Public, verifiable dashboards of on-chain activity. |
| **Fhenix** | FHE coprocessor (CoFHE) on Arbitrum | Private agent orders/limits — twice a past agentic winner theme. |
| **Alchemy** | RPC for Arbitrum and Robinhood Chain; Account Kit; webhooks | Reliable RPC (Robinhood's public RPC is rate-limited). |
| **Pendle** | PT/YT markets on Arbitrum | Fixed yield on idle cash. |

## 2. Honest status — audited, not grepped

Method: `grep` over `src app server tools contracts scripts landing` (tests read separately), then the **running
product** in Chrome (the hosted Solana build this repo was copied from, `xorr-solana.vercel.app`, backed by
`executor-production-a672…` reporting `chain: solana-fork`): 8 screens visited (home, markets, xstocks, the NVDAx
ticket, safety, bot, deposit, networks, /crosschain), every resource request recorded. Then the new Arbitrum
executor's `/health`.

**Before this session: zero sponsor tech was used.** The request log from the live app touched exactly three hosts:
`auth.privy.io`, the Railway executor, and `solana-fork-production.up.railway.app`. No request went to any Arbitrum,
Uniswap, GMX, Robinhood, ZeroDev, Chainlink, Paxos, Dune or Alchemy endpoint. `/crosschain` (the only screen whose
code names Arbitrum) redirects to "Not on Solana".

**Now (after the chain port in this session):**

| Tech | Class | Evidence |
|---|---|---|
| Arbitrum One (fork) | **GENUINELY USED** (fork only) | `server/src/evm/chains.ts` keys `arbitrum`, `arbitrum-fork`, `arbitrum-sepolia`; Railway `executor-fork-production-ba80…/health` → `chain: arbitrum-fork`, rpc at block 507,947,xxx, `XorrDelegation` 0x649b0005…0f53 has code (5596 bytes). A fork is not "deployed on an Arbitrum chain" for judging. |
| Arbitrum Sepolia / One (real deployment) | **MISSING** | No contract deployed on 421614 or 42161. Blocks qualification. |
| 1inch on Arbitrum | **IMPORTED, BROKEN** | `ONEINCH_CHAIN_ID` is 42161 on Arbitrum keys and a direct quote returns 200, but the token registry (`server/src/venues/tokens.ts`, stock catalog) still names Base addresses, so the executor's warm-up trips its breaker (`upstreams: open api.1inch.dev`). |
| Arbitrum in 1inch Fusion+ | **IMPORTED BUT UNREACHABLE** | `server/src/venues/fusion-plus.ts:44` lists 42161 as a Base→Arbitrum destination; the screen is hidden (`src/nav/solanaRoutes.ts:28`) and the source chain is Base. |
| Uniswap Trading API | **MISSING** | No endpoint, no key (`UNISWAP_API_KEY` exists nowhere). "uniswap" appears only as a 1inch route label (`server/src/venues/oneinch.ts:231`) and a revert-string comment. |
| Uniswap v3 contracts | **MISSING** here | The X Layer port has a working QuoterV2/SwapRouter02 venue (`xorr-xlayer/server/src/venues/uniswap.ts`) that needs no key. |
| GMX V2 | **MISSING** | The only grep hit was a base64 integrity string in `server/package-lock.json`. The app's perps screens read Base-era futures data, hidden on the Solana build. |
| Robinhood Chain / Stock Tokens | **MISSING** | 0 references. The stock product is Backed xStocks on Solana (`server/src/venues/xstocks.ts`) — the closest analogue (Scaled-UI multiplier ≈ ERC-8056, corporate-action notices, market-hours logic) exists and can be re-pointed. |
| ZeroDev / session keys | **MISSING** | 0 references. The permission model is the custom `XorrDelegation` contract (daily cap, venue allowlist, expiry, revoke, min-out) — a session-key design, but not ZeroDev. |
| Chainlink | **MISSING** | Hits are the LINK ticker (`server/src/market/ids.ts:15`, `server/src/news/feed.ts:84`), a comment in `backing-detail.ts:39`, and a hard-coded fixture row `src/data/fixtures/markets.ts:133` (`"px": "$18.44"` — FAKED demo data, see gaps). |
| Paxos USDG | **MISSING** | 0 references in this repo (the X Layer port used USDG as a routing hop). |
| OpenZeppelin | **IMPORTED BUT UNUSED** | `contracts/lib/openzeppelin-contracts` is vendored and remapped; no `.sol` in `contracts/src` imports it. |
| Dune, Fhenix, Alchemy, Pendle, AWS | **MISSING** | 0 references. |
| Privy (not a sponsor here) | GENUINELY USED | Every signed-in request; the EVM embedded wallet signs grants/revokes. |

**Where deeper integration fits organically** (walked from the app's own surfaces):
- *Agent permission* (`app/(onboarding)/delegate.tsx`, `app/safety.tsx`, `XorrDelegation`) → ZeroDev CallPolicy/RateLimit/Timestamp is a natural second enforcement layer, or the whole grant.
- *Buy/sell ticket* (`app/xstock/[symbol].tsx`, `executor/place.ts guardAndSpend`) → Uniswap Trading API on 42161/4663; Robinhood Stock Tokens replace xStocks one-for-one (same product, native chain).
- *Stock detail: backing, corporate actions, eligibility* (`src/ui/BackingDrawer.tsx`, `venues/corporate-actions.ts`, `EligibilityNotice.tsx`) → Robinhood `/rhj/assets` multiplier + tradingCapabilities, `/rhj/corporate-actions`, ERC-8056 `uiMultiplier()` on-chain, Chainlink feed.
- *Futures/perp screens* (`app/futures.tsx`, `app/perp/*`, `app/funding.tsx`, hidden today) → GMX `/markets/info` funding/OI + real orders.
- *Idle cash / yield* (`app/yield.tsx`, Aave) → USDG as the settlement asset; Pendle PT as fixed yield.
- *Audit trail / verify* (`app/verify.tsx`, `audit_log`, `XorrAuditAnchor`) → Dune dashboard over the anchor and delegation events.
- **Forced, and not recommended:** AWS (no product surface), Fhenix for the whole order flow (would dominate the build; a single private-limit feature is the honest scope).

## 3. The ranked 50 (most load-bearing sponsor tech first)

Depth: **Core** = the feature is the sponsor capability; **Deep** = several capabilities composed; **Surface** = one call.

| # | Feature | Sponsor capability used | Depth | Why a track judge notices |
|---|---|---|---|---|
| 1 | **Market-hours-aware stock agent on Robinhood Chain**: the risk engine reads `/rhj/assets` `tradingCapabilities` (market/extended/overnight × whole/fractional) and `isTradingHalt` before every agent order, and refuses with the exact reason | Robinhood assets + prices APIs | Core | Robinhood's own docs tell integrators to do exactly this; nobody else will. |
| 2 | **Corporate-action autopilot**: `/rhj/corporate-actions` + `pendingMultiplier`/`pendingMultiplierEffectiveTime` → holdings, P&L, cost basis and the agent's position caps re-based on the effective time; the user gets a notice before a split lands | Robinhood corporate-actions API + ERC-8056 | Core | Past Robinhood award (Agama) was about stock-token mechanics; this shows mastery of them. |
| 3 | **ERC-8056-true holdings**: balances shown as `balanceOf × uiMultiplier() / 1e18`, read on-chain, never from a cached multiplier | ERC-8056 on Stock Tokens | Core | Most integrations will show raw balances and be wrong after the first dividend. |
| 4 | **Chainlink-guarded stock fills on 4663**: before a Uniswap fill, compare the pool quote to the token's Chainlink feed (multiplier-inclusive) and refuse beyond N bps or when `updatedAt` is stale | Chainlink per-token feeds on Robinhood Chain | Core | Uses the launch-partner oracle the way it is meant to be used. |
| 5 | **Agent session key as a ZeroDev permission**: Kernel v3 account per user; the agent key holds a CallPolicy limited to UR/GMX selectors + token allowlist + `LESS_THAN_OR_EQUAL` amount, a RateLimit (N trades/day) and a Timestamp (expiry) | ZeroDev permissions (3 policies) | Core | Exactly the pattern ZeroDev markets; judges can read the policy on-chain. |
| 6 | **One-tap revoke = uninstall the permission validator** (user-signed), proven by an agent UserOp that then fails validation | ZeroDev permission uninstall | Core | A kill switch that is on-chain and verifiable. |
| 7 | **GMX funding/OI feed into agent decisions**: `/markets/info` funding, borrow, OI skew and available liquidity become inputs to the agent's stated reason ("longs pay 0.012%/h") | GMX REST | Core | GMX data driving decisions, shown in the vote/reason text. |
| 8 | **GMX V2 long/short through the delegation**: multicall `sendWnt + sendTokens + createOrder` from the user's account, `acceptablePrice` from mark ± slippage | GMX ExchangeRouter | Core | Real positions, not a quote screen. |
| 9 | **Pending-order tracker**: order key from the multicall result / OrderCreated event, polled in DataStore until executed/cancelled/frozen; UI shows "waiting for keeper" with elapsed seconds | GMX two-step execution, EventEmitter | Core | The research note says bots that assume instant fills are wrong; this proves understanding. |
| 10 | **GMX SubaccountRouter as the agent's perp authority**: max action count + expiry set on-chain for the agent key | GMX Subaccounts | Core | GMX's own native delegation primitive — the most GMX-native agent design possible. |
| 11 | **On-chain volume attribution**: `uiFeeReceiver` + referral code on every GMX order; a "volume we routed" panel read from GMX events | GMX UI fees / referrals | Deep | Judges asked for attributable on-chain volume. |
| 12 | **USDG as the settlement currency**: grants, caps and P&L in USDG on Arbitrum and Robinhood Chain; USDC↔USDG conversion at deposit | Paxos USDG | Core | Explicit judging bonus. |
| 13 | **USDG-collateral GMX positions** on the ETH/BTC [USDG-USDG] markets listed 2026-09-16 | GMX × USDG | Core | Two sponsors composed; brand-new markets. |
| 14 | **Uniswap Trading API buy/sell on 4663** (Stock Tokens) and 42161 (crypto) with `protocols:[V2,V3,V4]` and `x-permit2-disabled` for the contract swapper | Uniswap Trading API | Core | One integration, two Arbitrum chains. |
| 15 | **UniswapX gasless orders for the agent** (`/order`, DUTCH_V3 on 42161/4663) where the route is better than CLASSIC | Uniswap Trading API `/order` | Deep | Uses the API's distinctive capability, not just a router call. |
| 16 | **Weekend/overnight stock pricing honesty**: when `tradingCapabilities.overnight` is closed, the ticket shows the last Chainlink print + age and disables the buy | Robinhood API + Chainlink | Deep | Stock tokens trade 24/7 on-chain but the underlying does not. |
| 17 | **Jurisdiction gate**: one-time Stock Token eligibility notice (not US/CA/UK/CH), recorded per wallet | Robinhood eligibility terms | Surface | Required for real users; judges from Robinhood will check. |
| 18 | **Dividend tracker**: cash-dividend corporate actions → a "dividends received" line per holding, reconciled against the multiplier change | Robinhood corp-actions + ERC-8056 | Deep | Makes stock tokens feel like stocks. |
| 19 | **Council vote → tx dashboard**: each agent's vote, reason and inputs (Robinhood session, GMX funding, Chainlink price) next to the tx hash it produced, linked to Arbiscan/Blockscout | All venues + explorers | Deep | The owner's spec; makes every trade auditable. |
| 20 | **Stylus risk kernel**: position-size / exposure checks compiled from Rust, called by `XorrDelegation` before a spend | Arbitrum Stylus | Core | Bonus for Rust/C/C++; genuine gas savings for math-heavy checks. |
| 21 | **Deploy the delegation + anchor on Arbitrum Sepolia and Robinhood Chain testnet, verified** | Arbitrum chains | Core | The qualification requirement. |
| 22 | **Audit anchor on Arbitrum**: the hash-chained audit log's head anchored to `XorrAuditAnchor` every N entries | Arbitrum L2 | Deep | Tamper-evident agent history on-chain. |
| 23 | **Dune dashboard of agent activity**: spends, refusals (`DailyCapExceeded`), revokes and GMX orders decoded from the contracts' events | Dune | Deep | Public proof the product is used. |
| 24 | **Gas sponsorship for the user's grant** via ZeroDev paymaster (user signs, pays nothing) | ZeroDev paymaster | Deep | Removes the "need ETH first" onboarding wall. |
| 25 | **Batched onboarding UserOp**: approve + grant + first DCA in one user signature | ZeroDev batching | Deep | Fewer taps in the demo. |
| 26 | **Index basket of Stock Tokens** (e.g. equal-weight Mag7) bought by the agent and rebalanced when a corporate action changes weights | Robinhood Stock Tokens + Uniswap | Deep | EqualFi won with index tokens; this makes it agent-run. |
| 27 | **Stop-loss/take-profit on stock tokens using Chainlink** as the trigger price (not the pool) | Chainlink | Deep | Resistant to thin-pool manipulation. |
| 28 | **GMX hedge for a stock basket**: short ETH/BTC on GMX sized to the basket's beta during overnight hours | GMX + Robinhood | Deep | Cross-venue risk management. |
| 29 | **Funding-rate carry agent**: when GMX funding is extreme, take the paid side with a small cap | GMX REST + orders | Deep | A strategy only GMX data enables. |
| 30 | **Liquidation-distance alert**: position health from GMX Reader, pushed before it gets close | GMX Reader | Deep | Real risk UX. |
| 31 | **Robinhood price cross-check**: `/rhj/prices` bid/ask vs pool vs Chainlink, three-way, shown on the ticket | Robinhood prices + Chainlink + Uniswap | Deep | Transparency judges can see. |
| 32 | **Trading-halt kill**: `isTradingHalt` true → the agent cancels queued stock orders and says why | Robinhood prices API | Deep | Safety tied to the real market. |
| 33 | **Pendle PT for idle USDC**: fixed yield on uninvested cash, redeemed before a buy | Pendle | Deep | Sponsor-listed; fixed yield won a Robinhood award (Saffron). |
| 34 | **Alchemy RPC with fallback** for 4663 (public RPC is rate-limited) and webhooks for fills | Alchemy | Surface | Reliability; would be swappable with any RPC. |
| 35 | **Fhenix-encrypted limit price** for the agent's resting orders | Fhenix CoFHE | Deep | Privacy-agent theme won twice; heavy lift. |
| 36 | **Rate-limited agent (ZeroDev RateLimitPolicy)** mirrored in the UI: "3 of 5 trades used today" read from chain | ZeroDev | Deep | Readable enforcement. |
| 37 | **Permission diff screen**: shows the exact on-chain policy (targets, selectors, caps, expiry) decoded from the Kernel account | ZeroDev | Deep | Trust UI. |
| 38 | **Robinhood Chain explorer deep links** on every stock fill (Blockscout) | Robinhood Chain | Surface | Small but concrete. |
| 39 | **Cross-chain view**: one portfolio across Arbitrum One (crypto, GMX) and Robinhood Chain (stocks) | both chains | Deep | Shows why two Arbitrum chains matter. |
| 40 | **Bridge USDG Arbitrum→Robinhood Chain** from the deposit screen | Arbitrum/Robinhood bridging | Deep | Moves money where stocks live. |
| 41 | **Leaderboard of agents by realised P&L** with every number linked to tx hashes | Arbitrum events | Surface | Social proof. |
| 42 | **Earnings-calendar agent** that stays flat on stock tokens through earnings | Robinhood assets + external calendar | Surface | Nice, but calendar data is not sponsor tech. |
| 43 | **Mobile push on GMX order execution** (keeper filled) | GMX events | Surface | Delight. |
| 44 | **OpenZeppelin `SafeERC20`/`ReentrancyGuard` in XorrDelegation** (replace hand-rolled transfer checks) | OpenZeppelin | Surface | Contract-quality points; swappable. |
| 45 | **OpenZeppelin Stylus contracts** for the Stylus kernel's access control | OpenZeppelin rust-contracts-stylus | Surface | Pairs with #20. |
| 46 | **Gasless first deposit** via ZeroDev paymaster for USDG transfer in | ZeroDev | Surface | Duplicates #24's mechanism. |
| 47 | **Dune-powered "market mood"** widget (Stock Token volumes on 4663) | Dune | Surface | Decorative unless it feeds decisions. |
| 48 | **Arbiscan verification badges** on the Safety screen | Arbitrum explorer | Surface | Trust signal. |
| 49 | **AWS KMS for the delegate key** | AWS | Surface | Real security gain, but invisible in a demo and swappable. |
| 50 | **Referral links for users** built on GMX referral codes | GMX referrals | Surface | Growth, not product. |

## 4. Gaps this audit found that block the sponsor story (feed PLAN.md)

1. Nothing deployed on a real Arbitrum chain (Sepolia/One/Robinhood testnet) — qualification blocker.
2. Token registry and stock catalog are Base/Solana; 1inch breaker trips on Arbitrum.
3. No Uniswap Trading API key anywhere in the repo or env (owner must create one at developers.uniswap.org).
4. No ZeroDev project ID (needed for its bundler/paymaster; self-bundling via `EntryPoint.handleOps` is possible on a fork).
5. No council: the spec's "council vote next to tx hash" has no data model — agents act alone (`proposals`, `agent_looks`).
6. `src/data/fixtures/markets.ts` ships hard-coded prices (e.g. LINK `$18.44`) — fixture data in a product path.
7. App still Solana-branded and Solana-signing (`isSolana` in 31 files); the web build must run on the EVM path.
