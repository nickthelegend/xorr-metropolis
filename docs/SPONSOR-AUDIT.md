# Sponsor audit — is the tech we aimed for actually used? (Monad Metropolis)

Audited 2026-09-24 against commit `9b00b8b`, on the real running stack: an anvil fork of Monad mainnet
(`infra/monad-fork`, chain 143, block ~107.41M), the executor on it (`/health` all up), and the Expo web app, signed in
through Privy's real email-code flow as `test-8958@privy.io` (wallet `0x95A0…e615`). UI flows were driven in Claude in
Chrome with its network and console logs read on every screen; the code was traced by hand, not by package name.

Sponsors audited: the ones `docs/METROPOLIS.md` targets — **Agora (AUSD), Perpl, Kuru, Mera, Chainlink (feeds + CRE),
Envio, Nansen, MetaMask Agent Wallet** — plus Monad itself and Privy (a sponsor we chose not to target, but the one
actually running).

Legend: **USED** = a real call in a real flow a judge can trigger and see · **UNWIRED** = a real call that works, but no
product flow or screen reaches it · **IMPORTED-UNUSED** · **FAKED** · **MISSING**.

## 1. The honest status, first

**Of the eight sponsors we aimed for, not one is used in a flow a judge can see.** Three are called for real from the
executor (Kuru, Perpl, Chainlink on Monad) behind two endpoints no screen requests. AUSD is read into a total and never
named. Five (Mera, Envio, Chainlink CRE, Nansen, MetaMask Agent Wallet) have zero lines of code. Nothing is faked — no
mocked Kuru or Perpl response exists anywhere — but the Monad build still shows another chain's data where a Monad judge
will look first, which reads worse than fake.

| Sponsor | Status | Depth | Exactly where |
|---|---|---|---|
| **Monad** (the chain) | **USED** | Core | Contracts deployed on the fork; `prove-monad.ts` fills, cap refusal mined, revoke (`docs/evidence/prove-monad-fork-2026-09-24.txt`); app's Network screen reads chain 143 live (block 107,412,912, gas 9.9994 MON). **Not yet on Monad testnet** (deployer unfunded). |
| **Kuru** | **UNWIRED** | 1 view call | `server/src/monad/kuru.ts:78` `bestBidAsk()` via `GET /monad/crosscheck` — live: MON/USDC bid 0.024024 / ask 0.024033. **0 callers** outside `server/src/monad/`; **0 app requests** (Chrome network log, Home/Markets/Council/Network/Portfolio). No order, no swap, no KuruFlow, no depth, no vault. And it reads resting orders only: MON/AUSD's CLOB is empty on-chain while Kuru's API quotes it two-sided at $0.0206 (vault liquidity) — `kuru.ts` cannot see that. |
| **Perpl** | **UNWIRED** | 1 public GET | `server/src/monad/perpl.ts:92` `GET app.perpl.xyz/api/v1/pub/context` via `GET /monad/perpl` — live: 9 markets, BTC $84,316, MON $0.024064. 0 callers, 0 app requests. No API key, no order, no position, no websocket. `fundingRateRaw` is passed through unconverted although Perpl documents the unit (micros per interval: `-40` = −0.004%) — the "unknown unit" comment is now wrong. |
| **Agora AUSD** | **READ, NOT DISPLAYED** | Balance read | Registry `server/src/venues/tokens.ts:97`; price id `server/src/market/ids.ts:42`. Test: 25 real AUSD moved on the fork from Perpl's Exchange (tx `0x16814cb7…79af4`) → Home and Portfolio total **$25.00**, but Positions "0 open", Cash **$0.00**, and the word AUSD appears nowhere. No faucet, no Perpl margin, no permit. The fork faucet cannot give AUSD (its balance slot is not found by `dealErc20`; 41 slots probed). |
| **Chainlink — Data Feeds on Monad** | **UNWIRED** | View calls | `server/src/monad/chainlink.ts` (MON, ETH, USDC, AUSD) via `/monad/crosscheck` — live MON $0.024027, 22 s old. 0 callers. |
| **Chainlink — as the app uses it** | **USED, WRONG CHAIN** | Core to the council | The Monad build's Council (`/council`, `server/src/council/inputs.ts:20,85`) reads **Robinhood Chain** Chainlink feeds and **GMX on Arbitrum**. Live round on this build: "Chainlink $225.55 (133 min old), pool $225.72" for **NVDA** — a real number from another chain. The Sources screen (`app/sources.tsx:58`) describes Robinhood Chain feeds and "the v3 pool against USDG". A technical judge would catch this in under a minute. |
| **Chainlink CRE** | **MISSING** | — | 0 references. |
| **Chainlink wrapped-xStock feeds on Monad** | **MISSING** (and a correction) | — | Live on 143: wNVDAx $225.84, wTSLAx $380.16, wSPYx $771.78, wQQQx $743.37 (Chainlink directory, "Calculated"). `docs/METROPOLIS.md` said Monad has no tokenized stocks; that holds for Monad's official token list, but Chainlink prices wrapped xStocks on Monad, so the tokens likely exist there. Their contracts were not located (not in the 114-token list; rate limits blocked CoinGecko and GitHub search). |
| **Mera** | **MISSING** | — | 0 references. Sign-in is Privy. |
| **Envio** | **MISSING** | — | 0 references. `subgraph/` and `subgraph-aqua/` are The Graph for Base — dead weight here. |
| **Nansen** | **MISSING** | — | 0 references. |
| **MetaMask Agent Wallet** | **MISSING** | — | "metamask" appears only as a login-wallet option inside Privy's modal (`src/auth/PrivyProvider.web.tsx:47`) — unrelated to the Agent Wallet or its plugins. |
| **Privy** (not targeted) | **USED** | Core | Real email-code sign-in (verified live), embedded wallet. We decided to replace it with Mera (D1). |

**Faked:** nothing sponsor-related. But three product surfaces on the Monad build contradict the chain and would read as
fake to a judge: the welcome line ("Tokenized US stocks, traded by agents", `src/design/brand.ts:24`), the Council's
NVDA/TSLA/AAPL/SPY pills voting on Robinhood Chain and GMX data, and Markets listing BTC/ETH/AAVE/LINK from CoinGecko
with **MON absent** — the one asset with the deep pool and three live on-chain prices.

## 2. What each sponsor actually offers (researched, not guessed) — and our use of each capability

Sources are the sponsors' docs, SDK source read from npm/GitHub, and live calls on 2026-09-24.

### Perpl — fully on-chain perps CLOB on Monad, AUSD margin, isolated only
| Capability | Ours |
|---|---|
| Public REST `/v1/pub/context`, candles, announcements | `/pub/context` **UNWIRED** |
| **API keys**: Ed25519, enrolled with an EIP-712 wallet signature; `scope_mask` 1 read / 2 trade; **can never withdraw or transfer out**; `expires_at`; up to 4 IP CIDRs; revoke in Perpl's UI | MISSING |
| Authenticated REST: account-history, fills, order-history, position-history | MISSING |
| WebSocket market data (market-state, funding, order-book, trades, candles) and trading (`mt:29` sign-in, orders `mt:22`, positions/orders/wallet streams) | MISSING |
| Orders: Open/Close Long/Short, GTC/PostOnly/FOK/IOC; TP/SL triggers; reduce-only via Close | MISSING |
| On-chain Exchange: `createAccount` (min $10), `depositCollateral`, `withdrawCollateral`, `execOrders` | MISSING |
| Funding every 8,571 blocks, `rate` in micros/interval; liquidation at 5% maintenance for MON | Funding read raw, unit mislabelled |

Gate: programmatic key enrolment needs an Origin **whitelisted by Perpl**; Perpl geo-blocks US and GB.
Meaningful use (bounties): "a production-ready trading bot or automation system on Perpl"; the risk tool is judged on
real-time data, a protocol view and a wallet view, signal over clutter.

### Kuru — on-chain CLOB (v1 on mainnet) with AMM vaults
| Capability | Ours |
|---|---|
| OrderBook reads: `bestBidAsk`, `getL2Book`, `getMarketParams` | `bestBidAsk` **UNWIRED**; the rest MISSING |
| Limit orders `addBuyOrder/addSellOrder(price, size, postOnly)`, `batchUpdate`, cancels, flip orders | MISSING |
| Market orders `placeAndExecuteMarketBuy/Sell(size, minOut, isMargin, isFillOrKill)` | MISSING |
| Router `anyToAnySwap` (multi-hop) | MISSING |
| MarginAccount (maker proceeds credited, deposit/withdraw) | MISSING |
| KuruAMMVault per market (deposit/withdraw along an x·y=k curve, 10–500 bps spread) | MISSING — and invisible to our book read |
| KuruFlow aggregator `POST /api/quote` (JWT from `/api/generate-token`) → ready calldata | MISSING |
| Market-data REST/WS (`exchange.kuru.io`: depth, trades, 24h ticker, klines; `wss://…/ws` depth/trade streams) | MISSING |
| Market creation (`Router.deployProxy`) | Not possible for us: **permissioned** (`Unauthorized()` from any other address) |

Meaningful use: "a focused spot trading product routing trades through Kuru's on-chain order book" with target users,
evidence of demand, acquisition/retention and a continuation plan.

### Agora — AUSD
| Capability | Ours |
|---|---|
| AUSD balance (6 dp) | Read into the total; **never displayed** |
| ERC-2612 `permit`, EIP-3009 `transferWithAuthorization` | MISSING |
| Chainlink AUSD/USD on Monad | In `chainlink.ts`, UNWIRED |
| Supply metrics API `api.agora.finance/v0/metrics` (Monad total 155.4M) | MISSING |
| Testnet faucet `requestFunds(address)` at `0xd236…e6C` (live on 10143) | MISSING |
| Mint/redeem | Not possible for us: org-gated with compliance |
| Liquidity: Perpl sole collateral (~$3.9M), Kuru MON/AUSD, AUSD/USDC, WBTC/AUSD, Curve | Unused |

Bounty (Best Mobile Trading App): a **mobile app** that **authenticates via Mera**, **holds and displays an AUSD balance**
and **executes trades through Perpl** — we meet none of the three yet.

### Mera — passkey accounts (`@category-labs/mera` 0.2.0, preview)
| Capability | Ours |
|---|---|
| `createPasskeyWithPrfOutput` / `getPasskeyPrfOutput` (32-byte PRF, salts as namespaces) | MISSING |
| App-side derivation: PRF → BIP-39 → `m/44'/60'/0'/0/i` (MetaMask-importable) | MISSING |
| `createSecp256k1SigningSession` → `toViemAccount` (prompt-free signing incl. EIP-7702 `signAuthorization`); `end()` zeroes the key; **no built-in expiry or scope** | MISSING |
| Secret vaults (AES-256-GCM, HKDF) storable in untrusted storage | MISSING |
| React Native (`react-native-passkey`, iOS 18+/Android 9+, AASA + assetlinks, dev build) | MISSING |

Bounties: *Mera-Powered UX* — one passkey prompt, prompt-free signing in a clearly scoped session, identity rebuilt after
clearing storage or on a fresh device. *One Passkey, Many Keys* — at least one PRF namespace doing non-wallet work; their
own ideas include separate identities per agent and encrypted AI-agent memory.

### Chainlink on Monad
| Capability | Ours |
|---|---|
| Data Feeds: MON, ETH, BTC, SOL, LINK, USDC, USDT, AUSD, WBTC, XAU, EUR, LSTs, **wNVDAx/wTSLAx/wSPYx/wQQQx** | 4 in `chainlink.ts`, UNWIRED |
| **CRE** (TS SDK 1.18+ on `monad-mainnet`): cron / HTTP / EVM-log triggers, HTTP fetch with consensus, EVM read, `writeReport` → KeystoneForwarder (`0x76c9…5E62` prod, `0x9eF6…784d` simulation) → a `ReceiverTemplate` consumer; `cre workflow simulate --broadcast` gives a real tx | MISSING |
| CCIP on Monad (router `0x3356…CaDB`) | MISSING |
| Data Streams (VerifierProxy on Monad; access gated by Chainlink) | Not available to us without access |
| VRF, Automation | Not on Monad |

### Envio
| Capability | Ours |
|---|---|
| HyperIndex (`config.yaml` + `schema.graphql` + handlers, effects, factories, multichain, reorg-safe, GraphQL), Envio Cloud | MISSING |
| HyperSync `monad.hypersync.xyz` (token needed), HyperRPC | MISSING |

Judged on depth (multichain, aggregated entities), a live working product, originality, craft; deliverables are the
three files in a public repo, something consuming the data, and a demo.

### Nansen
Monad (`chain: "monad"`) is covered for Smart Money netflow/holdings/DEX trades, Token God Mode flows/holders/PnL and
Profiler. REST with an API key (free tier: 100 trial credits then 10/day), MCP (24 tools), CLI — and **x402
pay-per-call with USDC on Monad itself** ($0.05 for smart-money netflow; the 402 response lists `eip155:143` USDC).
Ours: MISSING. Bounty: "a product experience powered by Nansen data that goes beyond exposing raw data".

### MetaMask Agent Wallet
The `mm` CLI (`@metamask/agent-wallet` 7.0.0) with server wallets (TEE) and Guard-Mode policies; Monad 143 and 10143
preconfigured; plugins are npm oclif packages with a manifest declaring `wallet-read` / `wallet-submit` and
`targetChains`, executing through `walletExecutor` so Blockaid scanning and policy still apply; beta, behind
`experimentalPlugins`. Smart Accounts Kit (ERC-7710 delegations) supports Monad. Ours: MISSING.

## 3. Where deeper integration genuinely fits — and where it would be forced

Walked in the app, surface by surface:

- **Sign-in (`/wallet`)** — Mera belongs here outright; the Agora bounty requires it. Organic.
- **Home balance card** — AUSD belongs here as a named line, with its peg (Chainlink AUSD/USD). Organic: it is money the
  user already holds.
- **Permission / grant screen** — the Perpl trade-only API key is the perps half of "a permission you can revoke"; an AUSD
  margin cap sits beside the USDC daily cap. Organic — this is the product's own thesis applied to a sponsor that was
  built for it (keys that cannot withdraw).
- **Council** — seats must read Monad: Kuru's book, Chainlink MON/USD, Perpl funding and OI. Organic; right now it reads
  Robinhood Chain and GMX.
- **Order ticket / Markets** — Kuru is the venue for MON; its live depth stream is the most "Monad-fast" thing we could put
  on screen. Organic.
- **Hedge** (hidden on Monad) — becomes Perpl. Organic.
- **History, Verify, Leaderboard** — fed by an Envio index of our own contract's events. Organic (they need an index today
  and read the executor's database).
- **Audit anchor** — a CRE workflow attesting each council round on Monad. Organic for the "every vote next to its
  transaction" pitch.
- **Agents** — Mera PRF identities per agent and encrypted memory. Organic: agents already have their own derived keys.

Forced — say no, or keep it off the demo path:
- **Kuru "New Assets and Markets"** — market creation is permissioned; we cannot deploy a market without Kuru.
- **AUSD mint/redeem** — org-gated with compliance review; a trading app cannot call it.
- **MetaMask Agent Wallet plugin** — a separate CLI artifact, off to the side of a mobile app; worth it only as
  "xorr's permission for any agent", built last.
- **Nansen** — coverage of Monad smart money is real but thin data is likely; a seat that votes on noise would weaken the
  council. Use it where it changes a decision, or not at all.
- **Chainlink VRF / Automation** — not on Monad. **Data Streams** — gated.
- **Privy together with Mera** — both define the account layer; keeping Privy undercuts the Mera and Agora bounties.

## 4. Fifty features that use the sponsors for real — ranked by how load-bearing the sponsor tech is

Top = impossible without that sponsor's specific capability. Bottom = the sponsor is swappable. Depth: **Core** (the
feature is the integration) · **Deep** (a central part) · **Surface** (a call or display).

| # | Feature | Sponsor capability used | Depth | Why a judge on that track notices |
|---|---|---|---|---|
| 1 | **Trade-only Perpl key as the agents' perps permission** — the user signs Perpl's EIP-712 enrolment for an Ed25519 key with `scope_mask=2` and `expires_at` = the grant's end; revoke in xorr revokes it | Perpl API-key model (scope, expiry, withdrawals impossible) | Core | Uses the one Perpl property that makes a bot safe to hand money to; nobody else will turn it into a user-facing permission |
| 2 | **Council-voted Perpl orders** — every approved round sends an order on `/ws/v1/trading` (`mt:22`, IOC or PostOnly) and stores the order id and the forwarding tx beside the votes | Perpl trading WebSocket, order flags, on-chain forwarding | Core | "A production-ready trading bot on Perpl", with an audit trail per order |
| 3 | **AUSD margin moved on-chain inside the cap** — `XorrDelegation.spendVia` → Perpl `createAccount` / `depositCollateral` from the owner's AUSD, capped per day; agents can move margin in, never out | Perpl Exchange contract + AUSD | Core | Agora + Perpl together, with the limit enforced by a contract |
| 4 | **Mera passkey sign-in replacing Privy** — `createPasskeyWithPrfOutput` → BIP-39 → `m/44'/60'/0'/0/0` → `toViemAccount`; one prompt, web and Expo | Mera PRF + viem adapter + RN client | Core | The Agora bounty's first requirement and Mera UX's first deliverable |
| 5 | **Per-agent identities from PRF namespaces** — each hired agent's key derived with salt `xorr.agent.<id>`; never stored, identical on any device | Mera salts-as-namespaces | Core | The Many Keys bounty's own listed idea, done on a product that already has agents |
| 6 | **Encrypted agent memory** — each agent's notes and state sealed with `createSecretVaultWithExistingPasskey`, ciphertext in Postgres, decrypted only on the device | Mera secret vaults | Core | Non-wallet use of the key material, "nothing sensitive persisted" |
| 7 | **Stateless recovery on stage** — "Forget this device" → one passkey prompt → wallet, agents, grants and memory come back from the chain plus the vault | Mera stateless accounts | Core | The Mera UX judges run this test themselves |
| 8 | **Scoped Mera session = the on-chain grant** — a session key signs prompt-free only inside XorrDelegation's scope; an idle timer calls `end()`; anything outside re-prompts | Mera signing sessions (no built-in scope) + our contract | Core | Solves Mera's missing scope with an on-chain one — exactly the "session design" criterion |
| 9 | **Kuru maker agent** — posts post-only `addBuyOrder/addSellOrder` on MON/USDC through `spendVia`, re-quotes with `batchUpdate`, tracks fills from `Trade` events | Kuru OrderBook limit orders | Core | Uses the CLOB as a CLOB, not as a swap endpoint |
| 10 | **Kuru market orders as the default MON route** — `placeAndExecuteMarketBuy` with `minOut` from the live book, tx hash in the council round | Kuru market orders | Core | "Routing trades through Kuru's on-chain order book", literally |
| 11 | **Live Kuru depth in the order ticket** — the MON book streamed from `wss://exchange.kuru.io/ws` and redrawn per block | Kuru market-data WebSocket | Core | The most visible proof of Monad's speed on screen |
| 12 | **Depth-aware risk gate** — `getL2Book` before any spend; refuse an order larger than N% of depth within X bps, and say so | Kuru `getL2Book` | Deep | Risk made from order-book reality, not a price |
| 13 | **KuruFlow best execution** — `/api/quote` vs Uniswap QuoterV2 vs the direct book; execute the best; show the saving | KuruFlow API | Deep | Kuru's own router in the path, measured |
| 14 | **Delta-neutral carry agent** — MON spot on Kuru + MON short on Perpl when funding pays shorts; funding in micros converted right | Kuru + Perpl funding | Core | Two Monad-native venues combined into a strategy neither offers alone |
| 15 | **CRE-attested council rounds** — a workflow (cron or EVM-log trigger) fetches Kuru and Perpl with consensus, reads Chainlink MON/USD, and `writeReport`s the round's hash to a `ReceiverTemplate` anchor on Monad | CRE triggers, HTTP consensus, EVM read/write | Core | "An orchestration layer", with a real tx from `simulate --broadcast` |
| 16 | **CRE circuit breaker** — the workflow watches Chainlink vs Kuru mid; past a threshold it writes a pause the delegation contract checks, so every spend reverts | CRE + Data Feeds + our contract | Core | A DON that can stop a bot on-chain |
| 17 | **Oracle-bounded fills in the contract** — `XorrDelegation` reads Chainlink MON/USD inside `spend()` and rejects a `minOut` below oracle × (1 − tolerance) | Chainlink Data Feeds on Monad | Core | The contract refuses a bad fill even from a compromised executor |
| 18 | **Envio index of the permission** — HyperIndex over `Granted`, `Spent`, `Revoked` (+ Kuru `Trade`, Perpl events) feeding History, Verify and the leaderboard via GraphQL | Envio HyperIndex | Core | Replaces the executor's DB for public screens; the three files in the repo |
| 19 | **Aggregated entities** — per-agent PnL, daily cap use, council approval rate, venue share, computed in handlers | HyperIndex derived entities | Core | The "depth" criterion by name |
| 20 | **Multichain permission index** — the same schema over Monad testnet and mainnet (and the Arbitrum deployment) | HyperIndex multichain | Deep | Multichain is explicitly scored |
| 21 | **Perpl risk dashboard, wallet view** — positions, liquidation price vs 5% maintenance, margin ratio, funding paid, fills | Perpl authenticated REST + positions stream | Core | The risk-tool bounty's wallet view |
| 22 | **Perpl protocol view** — OI, long/short skew, funding and candles per market, one tap from the wallet view | Perpl market-data WS + candles | Core | The risk-tool bounty's protocol view and "seamless switch" |
| 23 | **TP/SL on every agent perp** — the council sets trigger orders when it opens a position | Perpl trigger orders | Deep | Production-grade automation, not one-shot orders |
| 24 | **Perpl funding and OI as a council seat** (replacing GMX's Macro Desk) | Perpl public data | Deep | The council finally reads Monad |
| 25 | **Nansen smart-money seat paid by the agent in Monad USDC** — each netflow read on `chain: "monad"` is an x402 payment of $0.05 USDC on 143 from the agent's own key | Nansen API + x402 on Monad | Core | Agents paying for their own intelligence on Monad; Nansen's CEO judges |
| 26 | **Follow a smart wallet** — Profiler PnL summary picks Monad wallets worth copying; an agent mirrors them inside the cap | Nansen Profiler | Deep | Beyond raw data: a signal that becomes a capped action |
| 27 | **AUSD one-signature grant** — `permit` (ERC-2612) instead of an approve transaction, so the grant is one signature | AUSD permit | Deep | Uses a token feature most apps ignore |
| 28 | **AUSD shown and checked** — a named AUSD line on Home with its Chainlink AUSD/USD peg; a depeg past 50 bps pauses AUSD margin adds | AUSD + Chainlink AUSD/USD | Deep | "Holds and displays an AUSD balance", done properly |
| 29 | **AUSD testnet faucet button** — `requestFunds(address)` on Monad testnet, a real tx | Agora faucet | Surface | Judges can fund themselves on testnet |
| 30 | **MetaMask Agent Wallet plugin `mm xorr`** — `grant`, `council`, `stop` commands, `targetChains:[143]`, trades via `walletExecutor` so Blockaid and Guard Mode still apply | Agent Wallet plugin architecture | Core | The bounty is the plugin |
| 31 | **ERC-7710 delegation as a second permission** — Smart Accounts Kit caveats (allowed targets Kuru/Perpl, period transfer limit) on Monad mainnet | MetaMask Smart Accounts Kit | Deep | A standard permission beside our own contract |
| 32 | **Mera EIP-7702 one-transaction setup** — the Mera EOA signs an authorization so approve + grant + first Perpl deposit batch into one tx (10-MON reserve respected) | Mera `signAuthorization` + Monad 7702 | Deep | Time-to-first-transaction, a Mera UX criterion |
| 33 | **Per-conversation E2E keys for agent chat** — messages to each agent encrypted with a PRF-derived key | Mera PRF namespaces | Deep | Another non-wallet namespace |
| 34 | **Chainlink-priced tokenized stocks on Monad** — wNVDAx/wTSLAx/wSPYx/wQQQx priced and guarded by their Monad feeds, if their tokens trade on Monad | Chainlink "Calculated" feeds | Deep | Restores the stocks pitch on Monad — only if the tokens are real there |
| 35 | **Idle cash to a Kuru AMM vault** — uninvested USDC earns in the MON/USDC vault, withdrawn before a trade | KuruAMMVault | Deep | Uses Kuru's liquidity layer, not just its book |
| 36 | **Range agent on Kuru flip orders** — buy-low/sell-high pairs that flip on fill | Kuru flip orders | Deep | A Kuru-only primitive |
| 37 | **Maker proceeds via MarginAccount** — fills credited to the margin account, swept to the owner | Kuru MarginAccount | Deep | Handles Kuru's real settlement model |
| 38 | **CRE "ask the council" over HTTP** — an HTTP trigger (Telegram, a webhook) convenes a round and writes its result on Monad | CRE HTTP trigger + write | Deep | External system → chain, the bounty's shape |
| 39 | **Fund from any chain via CCIP** — USDC from Base or Arbitrum lands on Monad through CCIP | Chainlink CCIP on Monad | Deep | A real cross-chain deposit path |
| 40 | **HyperSync catch-up** — "Since you looked" backfills fills and council rounds from HyperSync in one query | Envio HyperSync | Deep | Speed you can feel on reopen |
| 41 | **Kuru candles for MON charts** — `/klines` instead of CoinGecko | Kuru market-data REST | Surface | Charts from the venue that fills |
| 42 | **Perpl candles on the hedge screen** | Perpl candles | Surface | Consistent data for the perp leg |
| 43 | **Agora supply on the AUSD screen** — total and circulating on Monad from `api.agora.finance/v0/metrics` | Agora metrics API | Surface | Transparency next to the balance |
| 44 | **AUSD peg alert** — a notification when Chainlink AUSD/USD moves past a threshold | Chainlink AUSD/USD | Surface | Useful, but any feed would do |
| 45 | **Portfolio valued by Chainlink on Monad** instead of CoinGecko (ETH, BTC, MON) | Chainlink Data Feeds | Surface | Swappable with any oracle |
| 46 | **Public agent leaderboard** from the Envio index | HyperIndex GraphQL | Surface | Any indexer could serve it |
| 47 | **Perpl builder fee on agent orders** — needs a builder code from Perpl | Perpl builder codes | Surface | Monetisation, not product |
| 48 | **Kuru referrer fee on KuruFlow quotes** (`referrerAddress`) | KuruFlow referrer | Surface | Swappable monetisation |
| 49 | **Nansen token screener suggestions** — "what to hire an agent on" | Nansen screener | Surface | Discovery any data vendor could provide |
| 50 | **Nansen smart-alerts to Telegram** for held tokens | Nansen Smart Alerts | Surface | Notification plumbing, swappable |

**What to build first, for the bounties that pay most:** 4 → 5/6/7/8 (Mera: Agora + both Mera bounties), 1/2/3 (Perpl:
Agora + Perpl API), 10/11/12 (Kuru), 24 and 28 (make the council and the balance read Monad), then 18/19 (Envio) and 15
(CRE). Before any of it: remove the three contradictions a judge will see first — the stock welcome line, the Council's
NVDA pills on Robinhood Chain data, and a Markets list without MON.

## Corrections this audit makes to earlier docs
- "Monad has no tokenized stocks" (`docs/METROPOLIS.md`, `PLAN.md` D3): true of Monad's official token list, not of
  Chainlink's Monad feeds, which price wrapped xStocks live. Unverified whether the tokens trade on Monad.
- "Kuru's MON/AUSD book was empty": its **resting orders** were (on-chain `bestBidAsk` and `getL2Book`); Kuru's API quotes
  the market two-sided at ~$0.0206 from vault liquidity, 14% below MON/USDC.
- Perpl `rate` is documented: micros per funding interval (−40 = −0.004%).
- Uniswap v3's published Monad **testnet** addresses have no code on 10143; Kuru's testnet router and MON/USDC book,
  Perpl's testnet Exchange, AUSD and AUSD's faucet do.
