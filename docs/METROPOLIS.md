# Monad Metropolis: the hackathon, and what xorr should aim for

Researched 2026-09-24. Every fact has its source at the end of its section. Where a bounty's full text could not be read
(the platform shows bounty pages only to registered participants), that is said rather than guessed.

## The hackathon

| | |
|---|---|
| Name | **Metropolis**, Monad's six-week global online hackathon, with one-day "Metropolis Lounge" meetups in seven cities |
| Build window | Sep 1 – **Oct 13, 2026** (submission deadline **11:59 PM ET Oct 13** = 03:59 UTC Oct 14) |
| Judging / winners | Oct 14–27 / Nov 3 |
| Tracks | 4 × $30,000, each split across 3 teams: **Onchain Finance & Trading** · Consumer Products & Payments · Social, Attention & Culture · Trust, Identity & AI Infrastructure |
| Grand Champion | $25,000, across all tracks |
| Sponsor bounties | Stack on top of a track prize. "Pick one track, then claim as many bounties as your project earns." One main-track prize per project. |
| Platform | https://hackathon.monad.xyz (register there; bounty pages need registration) |

**Rules that bind us** (official rules v3, 2026-09-03):

- **Deployed on Monad mainnet or testnet**, with contract addresses or transaction hashes, and a demonstration of why
  Monad's capabilities are used.
- **Open source is mandatory**: an OSI licence, a public GitHub repository, a README with setup steps. (The marketing page
  says "encouraged"; the rules override it.)
- **Existing code** may be the foundation only if the README says so and substantial new functionality is added in the
  window; the commit history must cover the window. xorr's foundation is the earlier xorr builds (Base, Solana, X Layer,
  Arbitrum, all built in September 2026); the README names it.
- **AI coding tools are allowed and must be disclosed in the README.**
- **Demo video ≤ 3 minutes**, public, showing real Monad interactions.
- Teams of 1–5; one project per participant; **one track per project**.
- Main-track judging: product quality, technical excellence, Monad integration, track fit, innovation (20% each).
  Bounty judging: meets the bounty's requirements 40%, technical implementation 30%, Monad integration 20%, innovation 10%.
- Prizes paid in USDC; KYC may be required.

Sources: https://monad.xyz/developers/hackathons/metropolis · rules https://hackathon.monad.xyz/api/v1/policies/current ·
prizes https://hackathon.monad.xyz/prizes

## The track: Onchain Finance & Trading

xorr is a trading product: agents trade for you inside an on-chain permission. The finance track is where it is judged on
what it is, and the bounties that fit xorr best (Agora's mobile trading app, both Kuru bounties, Perpl's risk tool,
MetaMask's agent wallet plugin) are tagged to this track. The platform says bounties "marked All tracks pair with any",
which reads as: a track-tagged bounty pairs only with its track. Entering Trust, Identity & AI Infrastructure instead
(the permission is agent infrastructure) would give up those tagged bounties.

## The bounties, ranked for xorr

Value × fit × what it costs to build on what already exists here.

### Build for these

| # | Bounty | Prize | Track | What it asks | Why xorr fits, and what it costs |
|---|---|---|---|---|---|
| 1 | **Agora — Best Mobile Trading App** | $10,000 | Finance & Trading | A mobile app that **authenticates via Mera** (Monad's passkey library), **holds and displays an AUSD balance**, and **executes trades through Perpl**. Judged on implementation, UX, and creative use of the three together. Demo: passkey login → AUSD balance → at least one Perpl trade. | xorr is already an Expo mobile app whose agents trade for you. Needs: Mera login, AUSD shown and used as Perpl margin, a Perpl order from an agent. The largest prize and the tightest fit. |
| 2 | **Perpl — Best use of Perpl's API** | $5,000 | All tracks | "A production-ready trading bot or automation system on Perpl." | The council of agents *is* a trading bot with a permission, a cap, a kill switch and an audit trail. Same Perpl integration as #1. |
| 3 | **Kuru — Next Consumer Trading App** | $5,000 | Finance & Trading | A focused spot trading product routing trades through Kuru's on-chain order book, with target users, evidence of demand, and an acquisition/retention and continuation plan. | Route spot fills through Kuru's MON/USDC book (read live already: 4–7 bps wide). Needs the fill path through Kuru's router and a short go-to-market section. |
| 4 | **Mera — One Passkey, Many Keys** | $2,500 | All tracks | The most creative *non-wallet* use of Mera's PRF-derived key material; at least one derived key must do non-wallet work; a live cross-device test. Its own list of ideas includes separate identities per agent and encrypted AI-agent memory. | Each xorr agent already signs with its own derived key. Derive each agent's identity key and an encryption key for its memory from the user's one passkey. |
| 5 | **Mera — Best Mera-Powered UX** | $2,500 | All tracks | Mera as the entire account layer: one passkey prompt, no email/OTP, prompt-free signing through a clearly scoped session, identity rebuilt on a fresh device. Deployed on Monad with real transactions. | Comes with #1 and #4: passkey onboarding, and the agents' scoped session is the XorrDelegation grant. |

### Cheap to add on the same code

| # | Bounty | Prize | Track | What it asks | Plan |
|---|---|---|---|---|---|
| 6 | Perpl — Best Analytics / Risk Tool | $3,000 | Finance & Trading | A real-time analytics, risk-monitoring or portfolio dashboard focused on Perpl. | The council dashboard plus Perpl positions, funding and open interest (`/monad/perpl` already reads them). |
| 7 | Chainlink — Best workflow with CRE | $3,000 | All tracks | A CRE workflow used as an orchestration layer, connecting a chain with an external API or agent; a CLI simulation is accepted. | A workflow that reads MON/USD, Kuru and Perpl, runs the council's price gate, and writes the round's hash to `XorrAuditAnchor`. |
| 8 | Envio — Best Use of Envio | $1,000 (+ $5,000 Envio hosting for winning teams) | All tracks | HyperIndex, HyperSync or HyperRPC powering a core feature; public config.yaml, schema.graphql and handlers. | Index `XorrDelegation` grants, spends and revokes (it had The Graph subgraphs on Base) and drive History and Verify from it. |
| 9 | Nansen | $5,000 pool | All tracks | A product experience powered by Nansen data/API/MCP beyond raw data. Full text not read. | A council seat that reads smart-money flows on Monad. Needs a Nansen API key. |
| 10 | MetaMask — Best Agent Wallet Plugin | $2,500 | Finance & Trading | A plugin that gives the MetaMask Agent Wallet a new trading superpower. Full text not read. | Package "grant a capped, revocable permission, let the council trade" as a plugin. A separate artifact; do it last. |

### Leave

- **Privy** ($5,000): must be used beyond login. Agora (#1) requires Mera for authentication, and Mera's UX bounty wants Mera
  as the entire account layer, so keeping Privy as the wallet trades $15,000 for $5,000. **Decision: Mera replaces Privy
  on this build.**
- **Dynamic** ($5,000): the same conflict.
- **Aurora Intents** ($5,000): any-chain deposits into Monad. A reasonable later add (deposit from any chain), not core.
- Agora cross-border payments, Cleanverse, Hunyuan, Kimi and Qwen credits, the community prize: not this product.

**If the first five land:** $25,000 in bounties, plus a track place ($30,000 split three ways) and a shot at the $25,000
Grand Champion. Winning teams also receive partner credits (ack3 security scan, Chainstack, Crouton RPC, Mercuryo, Zerion,
Envio, Spectrum Nodes).

Sources: https://hackathon.monad.xyz/prizes · participant copies of the logged-in bounty pages:
https://github.com/HackerFetch/Baret-Metropolis/blob/main/Bounties.txt,
https://github.com/vaibhav0xq/turnstile/tree/main/research/sources,
https://github.com/YieldShield/yieldshield-monad/blob/main/docs/SPONSOR_STRATEGY.md,
https://github.com/frankolien/desk/blob/main/docs/00-prd.md

## Monad facts this build relies on (each checked on chain 2026-09-24)

| | Mainnet | Testnet |
|---|---|---|
| Chain id | 143 | 10143 (reset 2025-12-16) |
| RPC | rpc.monad.xyz (+ rpc1/2/3; rpc2 and rpc-mainnet.monadinfra.com serve historical state) | testnet-rpc.monad.xyz |
| Explorer | monadscan.com, monadvision.com | testnet.monadvision.com |
| Verification | Sourcify at sourcify-api-monad.blockvision.org (lists 143 and 10143) | same |
| Gas | MON; **charged on the gas limit, not gas used**; 128 KB contract limit | |
| Reserve balance | a transaction reverts if MON sent out leaves the account below 10 MON (with exceptions) | |

| Asset / venue | Address (143) | Read |
|---|---|---|
| USDC (Circle) | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | 6 dp, $212.8M supply |
| AUSD (Agora) | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` | 6 dp; testnet `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` |
| WMON / WETH / WBTC / USDT0 | `0x3bd3…433A` / `0xEE8c…1242` / `0x0555…2B9c` / `0xe7cd…C82D` | symbols and decimals answered |
| Uniswap v3 | factory `0x204f…0498`, QuoterV2 `0x661e…f08d`, SwapRouter02 `0xfe31…b900` | $10,000 USDC → 412,238 WMON on the 0.3% pool |
| Kuru | MON/USDC book `0x065C…C394`, MON/AUSD `0x131a…0da9`, router `0xd651…95CC` | MON/USDC 4–7 bps wide; MON/AUSD has no resting orders on-chain (Kuru's API quotes it from vault liquidity, ~14% below MON/USDC) |
| Chainlink | MON/USD `0xBcD7…22fb`, ETH/USD `0x1B14…0A04`, AUSD/USD `0xE207…9e13` | MON $0.0241, seconds old |
| Perpl | Exchange `0x34B6…2a6F`, API app.perpl.xyz/api | BTC, MON, ETH, SOL, HYPE, ZEC, LIT, VVV, PUMP; **no stock perps**; geo-blocks US, GB and others |

**Tokenized stocks on Monad: unresolved.** The official 114-token mainnet list has none (no xStocks, Ondo, Backed,
Dinari), but Chainlink runs live "Calculated" feeds for wrapped xStocks on Monad (wNVDAx, wTSLAx, wSPYx, wQQQx — read
on chain 143 on 2026-09-24), so the tokens likely exist there; their contracts were not located. Until they are, this
build trades MON and the majors spot, and perps on Perpl; the Stock Token screens of the Arbitrum build are hidden.
See `docs/SPONSOR-AUDIT.md`.

Sources: https://docs.monad.xyz/developer-essentials/network-information ·
https://docs.monad.xyz/developer-essentials/differences ·
https://developers.uniswap.org/docs/protocols/v3/deployments/v3-monad-deployments ·
https://docs.kuru.io/contracts/Contract-addresses · https://docs.perpl.xyz ·
https://github.com/monad-crypto/protocols · https://docs.agora.finance/developer/contract-deployments ·
https://docs.monad.xyz/guides/mera · https://github.com/monad-crypto/token-list
