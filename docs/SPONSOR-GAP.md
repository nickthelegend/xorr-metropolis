# Sponsor gap check — xorr on Monad (2026-10-05)

Inputs: `Projects/METROPOLIS-SPONSORS.md` (fresh research, 5 Oct, requirement text per bounty, live testnet addresses),
`docs/SPONSOR-AUDIT.md` (24 Sep, measured on the running stacks) and `docs/METROPOLIS.md` (rules, ranking). Status is what
the code and the chain show at `5afd6a9`, not what the docs claim.

**Track: 01 Onchain Finance & Trading.** It locks five bounties to us (Agora Mobile, Kuru ×2, Perpl Risk, MetaMask
plugin) and every "All tracks" bounty stacks. Bounty scoring: **meets the stated requirements 40%**, technical 30%,
Monad integration 20%, innovation 10% — so a requirement left unmet costs more than any polish can win back.

**Two facts that override everything below:**
1. **Registration and team formation close Oct 6, 23:59 UTC** (a participant's capture of the portal timeline). The
   owner must register and create the team/project on hackathon.monad.xyz before then. Nothing here can do it.
2. **Every spot fill so far happened on a fork of Monad mainnet**, which is neither Monad mainnet nor testnet. It proves
   the code; it does not satisfy a bounty that asks for fills "on Monad". Real fills need Kuru v2 test tokens (from Kuru)
   or small real funds on mainnet — both the owner's.

## The table

Value = prize × how likely this build meets the stated requirements once the gap is closed. Effort: S (hours), M (a day),
L (days). ✓ met · ◐ partly · ✗ not met.

| Bounty | Track lock | Prize | Status today | Gap | Effort | Value |
|---|---|---|---|---|---|---|
| **Agora — Best Mobile Trading App** | T1 | $10,000 | ◐ Mera sign-in **on web** (`7b64c9e`), AUSD shown with its peg (Home, Deposit, Portfolio), Perpl trades through Perpl's own DelegatedAccount on testnet (6 filled, 4 by an agent). | "**Mobile** app": Mera is web-only (Expo needs react-native-passkey, a passkey domain with AASA/assetlinks, a dev build). Testnet Perpl orders are **gas-blocked** (keys hold 0.0006–0.021 MON). | L (mobile Mera) · owner (MON) | **Highest** — $10k, and it stacks with Perpl API and both Mera bounties |
| **Perpl — Best use of the API** | All | $5,000 (2 × $2.5k) | ◐ A bot that trades on Perpl: agent orders through the DelegatedAccount, per-order/day/leverage caps, operator removal on stop. **Standing exits checked every 30 s** (10-05): liquidation buffer, stop-loss, take-profit and a funding-aware exit (a loser paying ≥ N% a year), set per desk on Perps, with a dry run of what each would do now. Public REST: context, funding history, candles (the risk tool). | No WS; the council's Perpl path and the exits have never closed a real position (no open position; orders gas-blocked). | owner (MON) | High |
| **Perpl — Analytics / Risk Tool** | T1 | $3,000 (3 × $1k) | ✓ **Perpl risk** (`/perpl`, built 10-05): per market, every funding payment over 24h or 7 days drawn above/below the line, what a long paid and its yearly pace, price move/range/trades, OI in $, spread, staleness; "Worth a look" alerts (crowded funding, ≥5% moves, wide books, stale marks, your positions near liquidation); your positions' liquidation distance and funding $/h at the current rate. On the build's own Perpl (testnet on the testnet build), public API only. | Live push (it reads per visit, no WS); your-positions part seen only in tests — every testnet position is closed and a new one needs gas. | — | Submit |
| **Kuru — Next Consumer Trading App** | T1 | $5,000 | ◐ Fills **through Kuru's book** via `KuruVenue` (best of Kuru/Uniswap measured through the contract) — **on the fork only**. | Fills on a real network (v2 testnet tokens from Kuru, or v1 mainnet with small funds); the required fields — **target users, evidence of demand, retention plan**, continuation plan. | S (the write-up) · owner (tokens/funds) | High once fills are real |
| **Kuru — New Assets and Markets** | T1 | $5,000 | ✗ | Market creation is permissioned (v2 testnet and v1 mainnet); only v1 testnet `deployProxy` is open, on a dead stack. Not this product. | L | Low — skip |
| **MetaMask — Agent Wallet Plugin** | T1 | $2,500 | ✗ | An `mm` plugin (oclif, `walletExecutor`) giving the agent wallet a new trading power, e.g. `mm perpl` (built-in `mm perps` is Hyperliquid only). | S–M (artifact) · M to run it (needs an agent-wallet sign-in) | Medium |
| **Mera — Best Mera-Powered UX** | All | $2,500 | ◐ One passkey ceremony, no email/OTP; 15-minute signing window with countdown and lock; the stateless test passes (storage cleared → same account). | Must be **deployed on Monad testnet/mainnet with real txs** — verified only on the fork; time-to-first-tx on testnet is gas-blocked; mobile. Privy email sign-in still offered beside it. | S once MON exists · M for gas sponsorship | High |
| **Mera — One Passkey, Many Keys** | All | $2,500 | ✓ A second PRF namespace (`xorr.notes.v1`) encrypts private notes; the server stores ciphertext only; reopened after clearing storage (`d5239c1`). | A **live cross-device** run on real hardware (the virtual authenticator cannot carry PRF across browsers). | S (demo) | High |
| **Chainlink — Best workflow with CRE** | All | $3,000 | ✗ Data Feeds used (council gate, peg); no CRE. | A real workflow (trigger → HTTP with consensus → EVM read → `writeReport`) to a `ReceiverTemplate` consumer on monad-testnet; `cre workflow simulate --broadcast` is accepted. CLI v1.36 is installed; **`cre login` is the owner's** (not logged in). | M | Medium–high |
| **Envio — Best Use of Envio** | All | $1,000 + hosting | ✗ History reads our contract's logs from the RPC. | HyperIndex V3 on 10143 over XorrDelegation + desk events, derived entities, a real screen reading it; public config/schema/handlers. Envio Cloud deploy needs an account (owner); self-host works. | S–M | Medium |
| **Privy — beyond authentication** | All | $5,000 | ◐ Privy email sign-in **and** its embedded wallet signs every grant, desk, send and stop. | "Beyond login" asks for more Privy features (gas sponsorship on 10143, session signers + policies); and two account layers (Privy + Mera) muddle the Agora/Mera story. | S–M · owner (dashboard sponsorship) | Low–medium (conflicts with D1) |
| **Nansen** | All | $5,000 pool | ✗ | A derived smart-money signal that changes a council vote; data is **mainnet only**; API key or x402 (real USDC). | S–M · owner (key) | Medium (its CEO judges the main track) |
| **Kimi (Moonshot)** | All | $3k credits / 10 teams | ✗ The council's language step uses OpenRouter (`src/bot/llm.ts`); no key in this project's env. | Run the load-bearing step on `kimi-k2.6`/`kimi-k3`; needs a Moonshot or OpenRouter key. | S · owner (key) | Low (credits) |
| **Alchemy** | All | $1k credits | ✗ | Gas Manager sponsorship or `monadLogs` — needs an Alchemy key. | S · owner (key) | Low |
| Aurora Intents | All | $5,000 | ✗ | Mainnet only, real funds. | M | Low — skip |
| Dynamic | All | $5,000 | ✗ | A third account layer. | — | Skip (conflicts with Mera) |
| Agora Cross-Border · Qwen · Hunyuan · Cleanverse | T2 / T4 / T3 / T4 | — | — | Other tracks. | — | Not eligible |

**What changed since the 24 Sep audit:** Agora's testnet AUSD faucet works again (it was empty); Kuru's v1 testnet book is
dead and Spot v2 (admin-minted tokens) is the testnet target; there is no Chainlink MON/USD on testnet (our price gate reads
mainnet's, which is right); Perpl testnet's minimum account is 100 AUSD (our desk opens with 150).

## The order to close them

**Mine, now (no owner input needed):**
1. ~~**Perpl risk tool**~~ — done 10-05: `/perpl` is the risk tool (funding history, alerts, liquidation distance).
2. **Kuru submission fields** — target users, evidence of demand, retention and continuation plan (`docs/KURU.md`).
3. **Envio** — a self-hosted HyperIndex V3 indexer on 10143 behind History.
4. ~~**Perpl bot hardening**~~ — done 10-05: exits on every desk, every tick (`server/src/monad/perpl-exits.ts`); live once MON exists.
5. **A test-funds path that uses Agora's faucet again**, and the demo refreshed on testnet once gas exists.

**The owner's, by deadline:**
- **Oct 6 23:59 UTC:** register; create the team and project on hackathon.monad.xyz.
- **MON for gas** on Monad testnet (faucet.monad.xyz): `0x5C19…2D938` (faucet key), `0xEe7d…c49f` (delegate),
  `0x0b21…453f` (Perpl operator). Unblocks Perpl orders, the council's Perpl path, Mera's first tx on a real network.
- **Kuru v2 test tokens** from the Kuru integration contact (USDC `0xA402…fEF1` and MON-side assets), or a few dollars on
  mainnet — for fills on a real network.
- **`cre login`** (one browser sign-in) — then the CRE workflow can be simulated with `--broadcast`.
- Keys, if wanted: Nansen, Moonshot/OpenRouter (Kimi), Alchemy. An Envio Cloud account for hosted indexing.
- Hosting the executor (Railway or similar) — the web goes on Vercel; the executor needs an always-on host.
