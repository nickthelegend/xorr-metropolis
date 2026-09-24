# Sponsor audit — is the tech we aimed for actually used? (Monad Metropolis)

**Re-audited 2026-09-24, evening**, at commit `47b3389`, replacing the morning's audit (`47edeea`, against `9b00b8b`) —
a day's work sits between them. Measured on the running stacks, not by reading code:

- **Fork** — anvil fork of Monad mainnet (chain 143, block ~107.48M, taken again after a restart), XorrDelegation
  `0xaaa0…196e`, the executor on :8787, the web build on :8082, signed in through Privy's real email-code form as
  `test-0356@privy.io` (wallet `0xB85A…0E897`).
- **Monad testnet** (10143) — XorrDelegation `0x5995…0bd4b` (Sourcify-verified), the executor on :8788, the web build on
  :8081, signed in as `test-4668@privy.io` (wallet `0x0EAc…3c16`, Perpl desk `0x3323…11b8`).
- Every UI claim below was checked in a real Chromium (Playwright, headless) with every executor request, its status
  and its answer logged per screen, and zero console errors unless stated. Every on-chain claim was checked by reading
  the receipt. Capability research was re-checked against the sponsors' docs, npm, GitHub and live endpoints the same
  day; sources are linked in §2.

Sponsors: the ones `docs/METROPOLIS.md` targets — **Agora (AUSD), Perpl, Kuru, Mera, Chainlink (feeds + CRE), Envio,
Nansen, MetaMask Agent Wallet** — plus Monad itself and Privy (not targeted, but the account layer that is running).

Legend: **USED** = a real call in a real flow a judge can trigger and see work · **UNWIRED** = real code, but no flow has
ever run it · **IMPORTED-UNUSED** · **FAKED** · **MISSING**.

## 1. The honest status, first

> **Update, later the same evening (after the build, at `d5239c1`):** Kuru now **fills** (the `KuruVenue` adapter; a sale
> and a buy filled on Kuru's book on the fork, chosen over Uniswap by measured delivery). Mera is now **USED** (web):
> passkey accounts derived from PRF, a bounded signing session, a second PRF-derived key encrypting private notes, and
> recovery with storage cleared — verified in Chromium with a virtual PRF authenticator. Chainlink now also gates a buy
> placed by hand. AUSD is named on Home and Deposit. Still absent: CRE, Envio, Nansen, MetaMask. Still blocked tonight:
> Perpl orders on testnet (gas). The table below is the measurement before those changes.

**Four sponsors are genuinely used in flows a judge can trigger: Perpl, Agora AUSD, Chainlink Data Feeds and Kuru.** Two
of those are deep: Perpl (real orders on testnet through Perpl's own delegated account) and Chainlink (a price gate that
vetoes council trades). Kuru is read-only: it prices, it never fills. **Five are absent: Mera, Chainlink CRE, Envio,
Nansen, MetaMask Agent Wallet** — zero lines of code, and no credentials for any of them in the repo or env. **Nothing
is faked**: no mocked sponsor response exists anywhere, and the morning's wrong-chain contradictions (Robinhood Chain
feeds in the council, a stock-token pitch) are gone — the full crawl of 91 routes finds none.

| Sponsor | Status | Depth | Where, and the proof |
|---|---|---|---|
| **Monad** (the chain) | **USED** | Core | Testnet: XorrDelegation `0x5995…0bd4b` + anchor, Sourcify-verified (`contracts/deployments/monad-testnet.json`). Fork of mainnet: grant, fills, `DailyCapExceeded`, revoke (`docs/evidence/prove-monad-fork-2026-09-24.txt`); today, on the re-taken fork, a Privy-signed grant (nonce 1→6), a $5 USDC send (25,000 → 24,995, on chain) and an agent's own-wallet buy (`0x63eeb9e3…`, status 1). Spot fills exist **only on the fork**: Monad testnet has no spot venue we settle through. |
| **Perpl** | **USED** | Core (testnet) | `server/src/monad/perpl-desk.ts`, `perpl-chain.ts`, `perpl-routes.ts` (`/perps/desk`, `/markets`, `/orders`, `/order`, `/caps`, `/desk/create`, `/desk/consent`, `/fund-test`). The owner's desk is Perpl's own **DelegatedAccount** (factory `createWithSignature`; xorr's operator key trades, never withdraws). On chain: 6 filled MON orders — 2 by the owner (`0x78052dff…`, `0x7ee2180b…`, status 1, from operator `0x0b21…453f` to desk `0x3323…11b8`) and **4 by an agent**, Momentum Scout (status 1, operator `0xb388…` → desk `0xa21f…`), plus 1 refused by its caps. The Perps screen (testnet) live: "Agent can trade · can't withdraw", "Wallet: 499.80 AUSD", desk, limits; requests `/perps/desk|markets|orders`, all 200. Public `/v1/pub/context` feeds the **council's macro seat** (live round tonight: "MON longs pay 0.0056%/h") and the fork's `/perpl` screen ($1.85M OI, 9 markets, updated 1 s ago). |
| ↳ Perpl — **live blocker** | **BROKEN RIGHT NOW** | — | The next order would fail for gas. One order ≈ 426k gas × 1.1 × 102 gwei = **0.048 MON**; the operator key holds **0.021 MON**, and the delegate key that tops operators up (`0xEe7d…c49f`) holds **0.0006 MON**. The faucet key (`0x5C19…2D938`) holds 0.0074 MON, so "Get test funds" cannot send gas either. A judge pressing Long tonight gets a refusal, not a trade. Owner action: fund those keys from faucet.monad.xyz. |
| ↳ Perpl — never run | **UNWIRED** | — | Council-voted Perpl orders: `server/src/executor/council-executor.ts:86` routes an approved round to Perpl on testnet, but **no council round has ever been convened on testnet** (0 rows). Perpl's authenticated API, WebSocket, TP/SL triggers and builder codes: **MISSING**. |
| **Agora AUSD** | **USED** | Deep (testnet) | Perpl margin: the desk is funded and withdrawn in AUSD (earlier today: withdrew 149.80 AUSD). Portfolio (testnet) live: "CASH · AUSD $499.80 · 1 AUSD = $0.9998 · Chainlink" — the chain holds 499.800293 AUSD; requests `/wallet/balance` and `/monad/feed/AUSD`, both 200. `/perps/fund-test` asks **Agora's faucet** `requestFunds` — which is **empty tonight** (`InsufficientFunds()`), so it falls back to the deployment's own reserve (8,850 AUSD, real transfers). **Not named on Home or Deposit**; permit / EIP-3009 unused. |
| **Chainlink — Data Feeds on Monad** | **USED** | Core | `server/src/monad/chainlink.ts` → the council's price desk vetoes a round whose fill is > 150 bps from Chainlink or whose round is stale (`server/src/council/monad-inputs.ts`). Live round tonight: "Chainlink $0.02396 (1 min old), fill $0.02372 on Uniswap v3 …, Kuru mid $0.02396, 98.2 bps apart (limit 150)". Also the trend seat (Chainlink over 8 rounds), the asset screen's three-way MON price, and the AUSD peg on Portfolio (`GET /monad/feed/:symbol`, public). **Not in the contract** — a manual order is not price-gated (PLAN P2.2 in progress). |
| **Kuru** | **USED (reads only)** | Surface–Deep | `server/src/monad/kuru.ts` `bestBidAsk` on MON/USDC → the council's price desk (above) and the asset screen ("Uniswap $0.02399 · Kuru $0.02396 · Chainlink $0.02395 · 15.7 bps apart", `GET /monad/crosscheck` 200). **No order has ever gone through Kuru**: no market order, limit order, KuruFlow, depth, vault or stream. The Kuru bounty asks for trades *routed through Kuru's book* — **not met**. Kuru's testnet V2 router exists and is unused (`app/(tabs)/index.tsx:615` says so). |
| **Mera** | **MISSING** | — | 0 references (the only "passkey" is a comment in `src/auth/PrivyProvider.native.tsx:4`). Sign-in is Privy. This leaves **the Agora $10K bounty's first requirement unmet**, and both Mera bounties. |
| **Chainlink CRE** | **MISSING** | — | 0 references. |
| **Envio** | **MISSING** | — | 0 references. History reads our contract's logs straight from the RPC (`server/src/routes/history.ts`, 1.7 s after today's fix). |
| **Nansen** | **MISSING** | — | 0 references; no key. |
| **MetaMask Agent Wallet** | **MISSING** | — | 0 references. |
| **Privy** (not targeted) | **USED** | Core | Real email-code sign-in and the embedded wallet that signs every grant, desk and send — verified today in F1, F3, F14, F17, F19 (`docs/TESTPLAN-MONAD.md`). We decided to replace it with Mera (D1); not done. |

**Against the bounties, today:**

| Bounty | Status |
|---|---|
| Agora — Best Mobile Trading App ($10K): Mera auth + AUSD held and shown + a Perpl trade | 2 of 3 at measurement; **3 of 3 on web after the build** (Mera passkey sign-in `7b64c9e`). Perpl gas-blocked on testnet tonight. Mobile: Mera on Expo not built (passkey domain + dev build); the Perps signer exists natively, not run on a device. |
| Perpl — Best use of the API ($5K): a production-ready bot on Perpl | Real agent orders inside caps, on Perpl's own delegated account. Missing: the council path run, TP/SL, WebSocket, a live gas budget. |
| Kuru — Consumer Trading App ($5K): trades routed through Kuru's book | Not met at measurement; **met after the build** (`e504cd2`: fills through `KuruVenue`, best of Kuru/Uniswap). The go-to-market write-up is not done. |
| Mera ×2 ($2.5K each) | Not met at measurement; **after the build**: UX — passkey account, bounded signing session with a countdown, recovery with storage cleared (`7b64c9e`); Many Keys — a notes key under its own PRF salt (`d5239c1`). Cross-device on real hardware not tested (the virtual authenticator cannot carry PRF between browsers). |
| Perpl — Risk tool ($3K) | Partly: positions with entry, mark, PnL, liquidation price (testnet); protocol-wide OI and funding (`/perpl`). No funding history, skew, alerts. |
| Chainlink CRE ($3K) | **Not met.** (Feeds are used; the bounty is for CRE.) |
| Envio ($1K) · Nansen ($5K pool) · MetaMask plugin ($2.5K) | **Not met.** |

**Polish a judge would notice (not sponsor-specific):** the WMON asset screen says a fill "would happen nearer $0.02",
rounding a sub-cent price; the market catalog lives in a folder named `src/data/fixtures/` though it holds no prices — a
grep for "fixtures" invites the wrong question.

## 2. What each sponsor actually offers — and our use of each capability

Re-checked 2026-09-24 against live docs, npm, GitHub and on-chain reads; corrections to the morning's research are
marked ✱.

### Perpl — on-chain perps CLOB on Monad, AUSD margin, isolated only
| Capability | Ours |
|---|---|
| **DelegatedAccount** (github.com/PerplFoundation/delegated-account): owner owns; operators may `execOrder(s)`, `increasePositionCollateral`, `requestDecreasePositionCollateral`, `depositCollateral`, `allowOrderForwarding`; may **not** withdraw, create accounts, rescue tokens or manage operators; operator added by EIP-712 consent; no expiry or size cap (caps must be ours); Perpl's beacon can upgrade all accounts. Factory mainnet `0xc535…907a`, testnet `0xf425…7209` | **USED** — `createWithSignature`, `execOrder`, `getPosition`, operator consent/resume; our caps (per order, per day, leverage) enforced before every order |
| Public REST `/v1/pub/context` (mark, book top, OI, funding, leverage), candles, announcements; ✱ funding history `GET /api/v1/market-data/:id/funding/:from-:to` | `/pub/context` **USED** (council seat, `/perpl`, Perps); candles, announcements, funding history MISSING |
| API keys: Ed25519, EIP-712 enrolment, `scope_mask` 1 read / 2 trade, `expires_at`, ≤ 4 IP CIDRs, ✱ ≤ 16 active per profile, a revoked key can never return; delegated accounts via `target_profile`; enrolment needs a Perpl-whitelisted Origin | MISSING |
| WebSocket market data and trading; ✱ API/WS orders fail with reason 34 `OrderForwardingNotAllowed` until the account calls `allowOrderForwarding(true)` | MISSING |
| Orders: Open/Close Long/Short, GTC/PostOnly/FOK/IOC, TP/SL triggers | Open/Close **USED**; TP/SL MISSING |
| Funding: rate in micros (10⁻⁶) per interval; ✱ interval **2,580 s (~43 min)** live, not 8 h / hourly | **USED correctly** (40 → 0.0056%/h) |
| ✱ Builder codes: id 1–255 by contacting Perpl, bound to a key at enrolment, ≤ 0.1% per order | MISSING |

✱ Geo-block: BY, CU, GB, IR, KP, RU, SY, UA, US (our notice named BY, CU, IR, KP, RU, SY, UA besides US/GB — correct).
Sources: docs.perpl.xyz (authentication, recipes, builder-codes) · github.com/PerplFoundation/api-docs (types, websocket).

### Kuru — on-chain CLOB (v1 on mainnet) with AMM vaults
| Capability | Ours |
|---|---|
| OrderBook reads `bestBidAsk`, `getL2Book`, `getMarketParams` | `bestBidAsk` **USED**; the rest MISSING |
| Limit orders, flip orders, cancels; ✱ `batchUpdate` (live in bytecode and `@kuru-labs/kuru-sdk` 0.0.95, ethers v5; absent from the docs) | MISSING |
| Market orders `placeAndExecuteMarketBuy/Sell` — ✱ **`uint256 _minOut`** (the docs' `uint96` gives a selector the live MON/USDC implementation lacks; use the SDK ABI) | MISSING |
| Router `anyToAnySwap`; MarginAccount; AMM vaults | MISSING |
| ✱ KuruFlow quote API at `https://ws.kuru.io` — JWT per user address (1 req/s) or `X-API-Key`; `referrerAddress` / `referrerFeeBps` | MISSING |
| ✱ Market data: Binance-style REST `exchange.kuru.io/api/v3` + `wss://exchange.kuru.io/ws`, 12 symbols (`MON_USDC` …) incl. Uniswap pools | MISSING |
| Testnet V2 router and MON/USDC book (code on 10143) | MISSING |
| Market creation `Router.deployProxy` — permissioned; ✱ MonadDeployer unverified | Not available to us |

Bounty (confirmed from a participant's copy): a focused spot product routing through Kuru's book, with target users,
demand evidence, acquisition/retention and a continuation plan. Sources: docs.kuru.io/contracts/Contract-addresses ·
docs.kuru.io/kuru-flow/openapi.json · github.com/EndPx/kairos/blob/main/docs/HACKATHON_REQUIREMENTS.md.

### Agora — AUSD
| Capability | Ours |
|---|---|
| AUSD balance (6 dp) | **USED** (testnet Portfolio; Perpl margin) |
| ERC-2612 `permit` (both variants), EIP-3009 `transfer/receiveWithAuthorization` (incl. bytes-signature variants for smart wallets); domain "Agora Dollar" v1 | MISSING |
| Chainlink AUSD/USD on Monad (8 dp; ✱ an 18-dp "shared-svr" duplicate exists — don't mix) | **USED** (peg line) |
| Metrics API `api.agora.finance/v0/metrics`, no key (✱ Monad: 154.08M total, 142.2M circulating) | MISSING |
| Testnet faucet `requestFunds(address)` — ✱ **empty now** (`InsufficientFunds()`; one 10,000 drip, 60 s cooldown, 100,000 per address) | **USED**, falls back to our reserve |
| Mint/redeem | Org-gated with compliance; not available |

Bounty: "creative use of the three integrations together" (Mera + AUSD + Perpl). Sources:
docs.agora.finance/developer/contract-deployments · docs.agora.finance/openapi.json ·
github.com/frankolien/desk/blob/main/docs/00-prd.md.

### Mera — passkey accounts (`@category-labs/mera` 0.2.0, preview)
| Capability | Ours |
|---|---|
| `createPasskeyWithPrfOutput` / `getPasskeyPrfOutput` (32-byte PRF; salts as namespaces) | MISSING |
| PRF → BIP-39 → `m/44'/60'/0'/0/i`; ✱ Ed25519 sessions and Solana addresses too | MISSING |
| `createSecp256k1SigningSession` → `toViemAccount` (incl. EIP-7702 `signAuthorization`); `end()` zeroes the key; **no expiry, no scope** | MISSING |
| Secret vaults (AES-256-GCM, HKDF) | MISSING |
| React Native (iOS 18+, Android 9+; AASA + assetlinks; one passkey domain; on desktop Chrome, saved to Google Password Manager); ✱ an **Expo 57 mobile demo** in Mera's repo (`demos/mobile`) | MISSING |

Bounties: UX — ✱ judged on **time to first transaction** and **"clean session-expiry UX"** (which Mera does not provide,
so it has to be built); Many Keys — a PRF namespace doing non-wallet work, live cross-device. Sources:
docs.monad.xyz/guides/mera · npm · github.com/category-labs/mera · github.com/vaibhav0xq/turnstile (research/sources).

### Chainlink on Monad
| Capability | Ours |
|---|---|
| Data Feeds: MON, ETH, BTC, SOL, LINK, USDC, USDT, AUSD, WBTC, XAU, EUR, LSTs, ✱ six wrapped xStocks (wNVDAx, wTSLAx, wSPYx, wQQQx, wEWYx, wSPCXx — "24-5", likely market-hours only) | MON, ETH, BTC, USDC, AUSD **USED** |
| **CRE** on `monad-mainnet` (✱ CLI ≥ 1.29) and ✱ **`monad-testnet`** (CLI ≥ 1.30; forwarders `0xB9F7…d192` simulation, `0xF834…4482` production): cron / HTTP / EVM-log triggers, HTTP with consensus, EVM read, `writeReport` → forwarder → `ReceiverTemplate`; `cre workflow simulate --broadcast` gives a real tx; ✱ deployment needs `cre account access` approval | MISSING |
| CCIP (router `0x3356…CaDB`) | MISSING |
| Data Streams (✱ verifier `0xEd81…48c8`, testnet `0x7279…Db64`; access gated) | Not available without access |
| VRF, Automation | Not on Monad |

Bounty (participant paraphrase): "an ordinary script labelled CRE is not sufficient"; the receiver must be implemented
correctly. Sources: docs.chain.link/cre/supported-networks-ts · docs.chain.link/cre/reference/cli/workflow ·
reference-data-directory.vercel.app/feeds-monad-mainnet.json.

### Envio
| Capability | Ours |
|---|---|
| HyperIndex (`config.yaml` + `schema.graphql` + handlers; effects, multichain, reorg-safe, GraphQL) | MISSING |
| HyperSync / HyperRPC on 143 and 10143 (token required) | MISSING |
| ✱ Envio Cloud free plan deletes a deployment after **30 days** — deploy after ~Sep 28 or self-host, or it is gone before judging ends (Oct 27); hosted indexers need no HyperSync token | — |

Sources: docs.envio.dev (hypersync-supported-networks, hosted-service-billing).

### Nansen
Monad (`chain: "monad"`) covered for all smart-money data incl. history. Free tier 100 trial credits then 10/day
(smart-money calls cost 5 → about two a day); MCP with 24 tools; x402 pay-per-call with USDC on 143, ✱ settled through
Molandak, basic calls $0.01, smart-money netflow $0.05, first 100 calls half price with `X-Payer-Address`. ✱ Licence:
redistributing smart-money netflows needs Nansen's approval and significant modification; redistributing holdings is
prohibited — **show a signal we derive, never raw numbers**. Ours: MISSING. Source: docs.nansen.ai (incl.
mcp/redistribution-guidelines).

### MetaMask Agent Wallet
`@metamask/agent-wallet` 7.0.0; server wallets in a TEE, Blockaid scanning, Guard-Mode policies; Monad 143 and 10143
preconfigured; plugins (beta, `experimentalPlugins`) are npm oclif packages executing through `walletExecutor` (policy
still applies). ✱ Capabilities are `wallet-read`, `wallet-submit`, `network-manage` (`mnemonic-read`/`config-write` are
rejected); `targetChains` is per command; the manifest needs `schemaVersion: 1`, `minCliVersion: ^6.2.0` and
`dataAccess` per command; plugins run in-process, unsandboxed; local/git installs refused by default. ✱ ERC-7715 Advanced
Permissions on Monad mainnet only. Ours: MISSING. Sources: docs.metamask.io/agent-wallet (plugins, architecture,
supported-chains) · docs.metamask.io/smart-accounts-kit (supported-networks).

## 3. Where deeper integration genuinely fits — and where it would be forced

Walked surface by surface in the running app:

- **Sign-in (`/wallet`)** — Mera, outright; Agora requires it. The one missing piece of the $10K bounty. Organic.
- **Perps desk** — already Perpl's own delegated account. What is organic next: TP/SL on every agent position, funding
  history on the position, the council path actually run, a live gas budget the screen can see. Organic.
- **Order ticket / Markets (MON)** — Kuru is the venue whose book we already read; routing the fill through it (market
  order with `minOut` from the book) turns a price source into the venue. Organic — and on testnet, Kuru's V2 router is
  the only spot venue there is.
- **Council** — seats already read Chainlink, Kuru and Perpl. Organic next: book depth as a seat, CRE attesting the round.
- **Portfolio / Home** — AUSD is shown on Portfolio with its Chainlink peg; Home and Deposit do not name it. Organic.
- **History / Verify** — an Envio index of our own contract's events. Organic; today it reads the RPC.
- **Agents** — Mera PRF identities and encrypted memory: agents already have their own keys. Organic.

Forced — keep off the demo path, or say no:
- **Kuru market creation** — permissioned. **AUSD mint/redeem** — compliance-gated.
- **Nansen** — thin Monad smart-money data and a licence that forbids showing the raw numbers; only where a derived
  signal changes a vote, else not at all.
- **MetaMask Agent Wallet plugin** — a CLI artifact beside a mobile app; worth it only as "xorr's permission for any
  agent", last.
- **Chainlink VRF/Automation** (not on Monad), **Data Streams** (gated).
- **Privy beside Mera** — two account layers; keeping Privy undercuts Agora and both Mera bounties.

## 4. Close these first — they exist, but a judge cannot see them work tonight

1. **Gas on testnet** (owner action): the Perpl operator and delegate keys and the faucet key are below one order's gas.
   Until they are funded, the only Perpl flow a judge can try refuses.
2. **Run the council → Perpl path once** on testnet (code present, never run) and show the round next to its order.
3. **Name AUSD on Home and Deposit** (balance and peg), not only Portfolio.
4. **Price-gate the manual order** with the same Chainlink check the council uses (PLAN P2.2).
5. **Run Perps on a device** (Expo) — the Agora bounty is for a mobile app.

## 5. Fifty features that use the sponsors for real — ranked by how load-bearing the sponsor tech is

Nothing here exists yet. Top = impossible without that sponsor's specific capability; bottom = the sponsor is swappable.
Depth: **Core** (the feature is the integration) · **Deep** (a central part) · **Surface** (a call or a display).

| # | Feature | Sponsor capability | Depth | Why a judge on that track notices |
|---|---|---|---|---|
| 1 | **Mera passkey sign-in, Privy removed** — `createPasskeyWithPrfOutput` → BIP-39 → `m/44'/60'/0'/0/0` → `toViemAccount`, on web and Expo (Mera's Expo 57 demo as the reference) | Mera PRF, viem adapter, RN client | Core | Agora's first requirement; Mera UX's first deliverable |
| 2 | **Passkey-owned Perpl desk** — the Mera account signs the DelegatedAccount's `createWithSignature` and the AUSD deposit: sign-in to a desk only the passkey can withdraw from, in one flow | Mera signing + Perpl DelegatedAccount + AUSD | Core | Agora's "creative use of the three together", in one demo path |
| 3 | **Session-expiry UX built on the on-chain limits** — a Mera signing session signs prompt-free only inside the grant and desk caps, shows its remaining time, `end()`s on idle and re-prompts outside | Mera sessions (no expiry or scope of their own) + our contract | Core | Mera's judges score "clean session-expiry UX"; Mera leaves it to the app |
| 4 | **Stateless recovery on stage** — clear storage or a fresh device → one passkey prompt → the same wallet, desk, agents and grants from the chain | Mera deterministic derivation | Core | The Mera UX judges' own test |
| 5 | **Per-agent identity keys from PRF namespaces** (`xorr.agent.<id>`) — each agent's fingerprint and public key, identical on any device, never stored | Mera salts as namespaces | Core | Many Keys' own listed idea, on a product that already has agents |
| 6 | **Encrypted agent memory** — each agent's notes and settings in a Mera secret vault; ciphertext in Postgres; the executor never reads plaintext | Mera secret vaults | Core | Non-wallet use of the key material |
| 7 | **End-to-end encrypted agent chat** — Messages to an agent sealed with a per-conversation PRF key | Mera PRF namespaces | Deep | A second non-wallet namespace, visible in the product |
| 8 | **EIP-7702 one-transaction setup** — the Mera EOA's `signAuthorization` batches AUSD approve + desk deposit + grant (10-MON reserve respected) | Mera `signAuthorization` on Monad | Deep | Time to first transaction |
| 9 | **TP/SL on every agent position** — an open places Perpl trigger orders from the council's stop and target | Perpl trigger orders | Core | "Production-ready bot" means exits, not only entries |
| 10 | **Liquidation guard** — when liquidation distance falls below a threshold, the agent reduces (Close, reduce-only) inside its caps, logged with the tx | Perpl positions + orders via the operator | Core | Automation a judge can watch protect money |
| 11 | **Live Perps from Perpl's WebSocket** — book, trades, funding ticks and the desk's positions streamed, redrawn per block | Perpl market-data WS | Core | Real time on Monad, visibly |
| 12 | **Risk view, wallet side** — funding paid or received per position (funding-history endpoint), margin ratio against maintenance, liquidation distance, alerts | Perpl funding history + positions | Core | The risk-tool bounty's wallet view |
| 13 | **Risk view, protocol side** — long/short skew, OI change and funding history per market, one tap from the wallet view | Perpl context + candles + funding history | Core | The risk-tool bounty's protocol view |
| 14 | **Kuru market orders as the MON route** — `placeAndExecuteMarketBuy/Sell` (SDK ABI, `uint256 minOut` from the live book) through `XorrDelegation.spendVia` | Kuru OrderBook market orders | Core | "Routing trades through Kuru's order book", literally |
| 15 | **Kuru on testnet as the testnet spot venue** — the V2 router makes Monad testnet a complete demo: spot on Kuru, perps on Perpl, both real | Kuru testnet V2 router | Core | Removes "spot only on a fork"; every tx on Monad's public testnet |
| 16 | **Kuru maker agent** — post-only limit orders on MON/USDC re-quoted with `batchUpdate`; fills read from `Trade` events | Kuru limit orders + `batchUpdate` | Core | Uses the CLOB as a CLOB |
| 17 | **Delta-neutral carry agent** — MON long on Kuru, MON short on Perpl while Perpl funding pays shorts; closes when it flips | Kuru + Perpl funding | Core | Two Monad-native venues in one strategy neither offers alone |
| 18 | **Live Kuru depth in the order ticket** — `wss://exchange.kuru.io/ws` ladder beside the Buy button | Kuru market-data WS | Core | The most visible "Monad is fast" moment |
| 19 | **CRE-attested council rounds** — an EVM-log trigger on each round re-reads Chainlink, Kuru and Perpl with DON consensus and `writeReport`s the round's hash to a `ReceiverTemplate` anchor (testnet supported) | CRE triggers, HTTP consensus, EVM read/write | Core | "An orchestration layer", with a real tx from `simulate --broadcast` |
| 20 | **CRE circuit breaker** — the DON watches Chainlink against Kuru's mid; past a threshold it writes a pause that `XorrDelegation` checks, so every spend reverts | CRE + Data Feeds + our contract | Core | A DON that can stop a bot on chain |
| 21 | **Oracle-bounded fills in the contract** — `spend()` reads Chainlink MON/USD and rejects a `minOut` below oracle × (1 − tolerance) | Chainlink Data Feeds on Monad | Core | Even a compromised executor cannot take a bad fill |
| 22 | **Envio index of the permission and the desk** — HyperIndex over `Granted/Spent/Closed/Revoked` and Perpl DelegatedAccount events, GraphQL behind History and Verify (self-hosted or deployed after Sep 28) | Envio HyperIndex | Core | The three files public, a live product consuming them |
| 23 | **Aggregated entities** — per-agent PnL, cap usage, council approval rate, venue share, computed in handlers | HyperIndex derived entities | Core | The "depth" criterion by name |
| 24 | **MetaMask plugin `mm xorr`** — `grant`, `council`, `stop` per-command on `targetChains:[143]`, trades via `walletExecutor` so Blockaid and Guard Mode still apply | Agent Wallet plugins | Core | The bounty is the plugin |
| 25 | **Nansen smart-money seat paid per call** — an x402 payment in USDC on Monad per netflow read, from the agent's own key; the seat votes on a derived signal (never the raw numbers the licence forbids) | Nansen API + x402 on 143 | Core | Agents paying for their own intelligence, on Monad — **real money on mainnet: needs your approval** |
| 26 | **Depth seat on the council** — `getL2Book` refuses an order larger than N% of depth within X bps and says so | Kuru `getL2Book` | Deep | Risk made from the book, not a price |
| 27 | **KuruFlow best execution** — Kuru's aggregator quote against Uniswap's QuoterV2 and the direct book; execute the best, show the saving | KuruFlow quote API | Deep | Kuru's own router in the path, measured |
| 28 | **AUSD one-signature desk funding** — `permit` or `receiveWithAuthorization` instead of approve + deposit | AUSD ERC-2612 / EIP-3009 | Deep | A token feature most apps ignore, making a step disappear |
| 29 | **AUSD depeg guard** — Chainlink AUSD/USD past 50 bps pauses margin adds and agent orders on Perpl, and says why | AUSD + Chainlink AUSD/USD | Deep | Agora's dollar treated as a risk, not assumed |
| 30 | **Oracle-vs-exchange mark check** — each Perpl position's mark against Chainlink; a gap past a threshold flags the position | Chainlink feeds + Perpl mark | Deep | Two sponsors checking each other |
| 31 | **Council over Telegram through CRE** — an HTTP trigger convenes a round and writes its result on Monad | CRE HTTP trigger + write | Deep | External system → chain, the bounty's shape |
| 32 | **Multichain index** — the same schema over Monad testnet and the mainnet deployment | HyperIndex multichain | Deep | Multichain is scored |
| 33 | **HyperSync catch-up** — "since you looked" backfills fills, rounds and orders in one query on reopen | Envio HyperSync | Deep | Speed you feel on return |
| 34 | **Follow a Monad wallet** — Nansen Profiler PnL picks wallets worth mirroring; an agent follows inside its caps | Nansen Profiler | Deep | Beyond raw data: a signal that becomes a capped action |
| 35 | **ERC-7715 permission as an alternative grant** on Monad mainnet, for MetaMask users | Smart Accounts Kit | Deep | A standard permission next to our own |
| 36 | **Idle USDC in a Kuru AMM vault** — earns between trades, withdrawn before a spend | KuruAMMVault | Deep | Kuru's liquidity layer, not only its book |
| 37 | **Range agent on Kuru flip orders** — buy-low/sell-high pairs that flip on fill | Kuru flip orders | Deep | A Kuru-only primitive |
| 38 | **Fund from Base or Arbitrum via CCIP** — USDC lands on Monad | Chainlink CCIP on Monad | Deep | A real cross-chain deposit |
| 39 | **Perpl API key for reads** — a read-scope key (`scope_mask` 1) on the desk's profile reconciles our order log against Perpl's own fills and history (needs a Perpl-whitelisted origin) | Perpl API keys + account history | Deep | Our books checked against the exchange's |
| 40 | **Perpl announcements in the Inbox** — listings, halts and parameter changes from Perpl's public feed | Perpl announcements | Surface | Useful; any venue feed would do |
| 41 | **Kuru candles for MON charts** instead of CoinGecko | Kuru market-data REST | Surface | Charts from the venue that fills |
| 42 | **Perpl candles on each Perps market** | Perpl candles | Surface | Consistent data for the perp leg |
| 43 | **AUSD supply beside the balance** — Monad total and circulating from Agora's metrics API | Agora metrics API | Surface | Transparency, swappable |
| 44 | **Portfolio valued by Chainlink on Monad** (ETH, BTC, MON) instead of CoinGecko | Chainlink Data Feeds | Surface | Swappable with any oracle |
| 45 | **Feed health on Sources** — each Chainlink feed's age against its heartbeat and deviation threshold, live | Chainlink feed metadata | Surface | Honest, but display only |
| 46 | **Public agent leaderboard** from the Envio index | HyperIndex GraphQL | Surface | Any indexer could serve it |
| 47 | **Perpl builder fee on agent orders** (id from Perpl, ≤ 0.1%) | Perpl builder codes | Surface | Monetisation, not product |
| 48 | **Kuru referrer fee on KuruFlow quotes** | KuruFlow `referrerFeeBps` | Surface | Swappable monetisation |
| 49 | **Nansen screener → "hire an agent on this"** — a derived shortlist of Monad tokens | Nansen screener | Surface | Discovery any data vendor could offer |
| 50 | **Nansen smart alerts as notifications** for held tokens | Nansen alerts | Surface | Notification plumbing, swappable |

**Build order for the money:** close §4 first (gas, the council → Perpl run, AUSD on Home). Then 1–4 (Mera: it unlocks
Agora's $10K and both Mera bounties), 9–13 (Perpl bot and risk tool), 14–15 (Kuru's bounty needs a fill through its
book), 19 (CRE), 22–23 (Envio). Blocked on things we do not have: 25 (real USDC on mainnet — your call), 39 (a
Perpl-whitelisted origin), and CRE deployment beyond simulation (`cre account access` approval). 24 needs nothing
external, but it is a separate CLI artifact, so it goes last.

## Corrections to earlier docs
- Perpl funding is paid about every 43 minutes (2,580 s), not hourly or every 8 hours; the code converts with the live
  interval.
- Agora's testnet AUSD faucet is empty (`InsufficientFunds()`); `/perps/fund-test` works from our reserve instead.
- Kuru's market orders take `uint256 _minOut`; the documented `uint96` signature would fail against the live book.
- Chainlink prices six wrapped xStocks on Monad, not four; the tokens' contracts on Monad are still not located.
- Envio Cloud's free plan keeps a deployment 30 days at most.
- Nansen's licence forbids showing smart-money holdings and restricts netflows: derive, never republish.
- The morning's "Monad build shows another chain's data" findings are fixed (council on Monad feeds, pitch, Markets) —
  the 91-route crawl (`docs/TESTPLAN-MONAD.md`, run 6) finds no wrong-chain text.
