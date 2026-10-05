# Sponsor gap check — xorr on Monad (5 Oct; status updated 6 Oct)

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

## Status after the 6 Oct local build (owner's direction: no Monad transactions, no hosting yet)

Everything below was exercised on a local fork of Monad mainnet (`infra/monad-fork/local-stack.sh`), in a real browser
(`npm run e2e:fork`, `e2e:flows`, `e2e:crawl` — every step fails on a console error or an API response ≥ 400) and by the
proofs; every component's status is in `docs/TEST-PLAN-ZERO-MOCK.md`, and the go-live steps in `docs/DEPLOY-LATER.md`. "Met locally" means the stated requirement works end to end on
the fork; the live step each needs is in the last column. `docs/SUBMISSION.md` has the same, per bounty, for judges.

| Bounty | Status | What changed on 6 Oct | Live step left |
|---|---|---|---|
| Agora — Mobile Trading App (T1) | ◐ built | Mera now in the native app (React Native client, Keychain session, native auth/signing); passkey → AUSD → Perpl long/close shown end to end in the browser on the fork | Serve `docs/passkey-domain/.well-known/*`, dev build with `EXPO_PUBLIC_MERA_RP_ID` |
| Perpl — Best use of the API | ✓ met locally | Full cycle on the fork with a local keeper posting Perpl's marks; the exit guard closed a live position itself; orders priced from the on-chain book | Test MON for the operator, then the same on Perpl testnet |
| Perpl — Risk Tool (T1) | ✓ met | (5 Oct) | — |
| Kuru — Consumer App (T1) | ✓ met locally | Each fill records and shows what the other venue would have delivered | A fill on a real network (Kuru v2 tokens or a few real dollars) |
| MetaMask — Agent Wallet Plugin (T1) | ◐ built | (5 Oct) | `mm login` + a funded agent wallet |
| Mera — UX | ✓ met locally | One ceremony; 3.1–5.6 s from the app on screen to a confirmed permission, signed with no prompt; the stateless test and the signing lock in the browser specs; stop read back from the chain | The same on Monad testnet (test MON) |
| Mera — One Passkey, Many Keys | ✓ met | — | A cross-device run on real hardware |
| Chainlink — CRE | ◐ built | (5 Oct) | `cre login`, then simulate; ~0.12 MON for the receiver |
| Envio | ✓ met locally | HyperIndex v3 (`indexer/`) over XorrDelegation, the anchor and Perpl's desk factory (desks as dynamic contracts); derived owner/day/venue/desk entities; RPC sync, no token; `GET /indexed` and a History card read it | An Envio API token or Envio Cloud for a hosted index |
| Kimi | ◐ built | Fifth council seat decides split rounds; numbers checked against the desks'. The fixture is gone (no production mocks): without a key the seat does not sit and the Council says "not configured" | `MOONSHOT_API_KEY` |
| Qwen | — | Track 4 only: not eligible for xorr (Track 1) | — |

**Keys and accounts the owner holds the only copy of:** `MOONSHOT_API_KEY` (Kimi), `cre login` (Chainlink CRE),
`mm login` (MetaMask agent wallet), an Envio API token, the Apple team id and Android signing fingerprint for the passkey
domain files.

## The table (5 Oct)

Value = prize × how likely this build meets the stated requirements once the gap is closed. Effort: S (hours), M (a day),
L (days). ✓ met · ◐ partly · ✗ not met.

| Bounty | Track lock | Prize | Status today | Gap | Effort | Value |
|---|---|---|---|---|---|---|
| **Agora — Best Mobile Trading App** | T1 | $10,000 | ◐ Mera sign-in **on web** (`7b64c9e`), AUSD shown with its peg (Home, Deposit, Portfolio), Perpl trades through Perpl's own DelegatedAccount on testnet (6 filled, 4 by an agent). | "**Mobile** app": Mera is web-only (Expo needs react-native-passkey, a passkey domain with AASA/assetlinks, a dev build). Testnet Perpl orders are **gas-blocked** (keys hold 0.0006–0.021 MON). | L (mobile Mera) · owner (MON) | **Highest** — $10k, and it stacks with Perpl API and both Mera bounties |
| **Perpl — Best use of the API** | All | $5,000 (2 × $2.5k) | ◐ A bot that trades on Perpl: agent orders through the DelegatedAccount, per-order/day/leverage caps, operator removal on stop. **Standing exits checked every 30 s** (10-05): liquidation buffer, stop-loss, take-profit and a funding-aware exit (a loser paying ≥ N% a year), set per desk on Perps, with a dry run of what each would do now. Public REST: context, funding history, candles (the risk tool). | No WS; the council's Perpl path and the exits have never closed a real position (no open position; orders gas-blocked). | owner (MON) | High |
| **Perpl — Analytics / Risk Tool** | T1 | $3,000 (3 × $1k) | ✓ **Perpl risk** (`/perpl`, built 10-05): per market, every funding payment over 24h or 7 days drawn above/below the line, what a long paid and its yearly pace, price move/range/trades, OI in $, spread, staleness; "Worth a look" alerts (crowded funding, ≥5% moves, wide books, stale marks, your positions near liquidation); your positions' liquidation distance and funding $/h at the current rate. On the build's own Perpl (testnet on the testnet build), public API only. | Live push (it reads per visit, no WS); your-positions part seen only in tests — every testnet position is closed and a new one needs gas. | — | Submit |
| **Kuru — Next Consumer Trading App** | T1 | $5,000 | ◐ Fills **through Kuru's book** via `KuruVenue` (best of Kuru/Uniswap measured through the contract) — **on the fork only**. | Fills on a real network (v2 testnet tokens from Kuru, or v1 mainnet with small funds); the required fields — **target users, evidence of demand, retention plan**, continuation plan. | S (the write-up) · owner (tokens/funds) | High once fills are real |
| **Kuru — New Assets and Markets** | T1 | $5,000 | ✗ | Market creation is permissioned (v2 testnet and v1 mainnet); only v1 testnet `deployProxy` is open, on a dead stack. Not this product. | L | Low — skip |
| **MetaMask — Agent Wallet Plugin** | T1 | $2,500 | ◐ **Built 10-05** (`mm-plugin-perpl/`): `mm perpl markets · risk · account · deposit · open · close` — Perpl perps on Monad for the agent wallet, every tx simulated first and sent through `ctx.walletExecutor` (Guard mode, Blockaid, 2FA). `markets` and `risk` ran inside `mm` 7.0.0 on both networks; 16 unit tests. | The wallet commands have not run live: they need `mm login` (owner) and a wallet with test MON and AUSD. | owner (`mm login`, MON) | Medium–high (T1-locked) |
| **Mera — Best Mera-Powered UX** | All | $2,500 | ◐ One passkey ceremony, no email/OTP; 15-minute signing window with countdown and lock; the stateless test passes (storage cleared → same account). | Must be **deployed on Monad testnet/mainnet with real txs** — verified only on the fork; time-to-first-tx on testnet is gas-blocked; mobile. Privy email sign-in still offered beside it. | S once MON exists · M for gas sponsorship | High |
| **Mera — One Passkey, Many Keys** | All | $2,500 | ✓ A second PRF namespace (`xorr.notes.v1`) encrypts private notes; the server stores ciphertext only; reopened after clearing storage (`d5239c1`). | A **live cross-device** run on real hardware (the virtual authenticator cannot carry PRF across browsers). | S (demo) | High |
| **Chainlink — Best workflow with CRE** | All | $3,000 | ◐ **Built 10-05** (`cre/`): cron → HTTP consensus (Perpl's MON mark) → EVM reads on monad-mainnet (Kuru's book, Chainlink MON/USD) → median + halt → `writeReport` to `XorrPriceReceiver` (a `ReceiverTemplate`) on monad-testnet, where no MON/USD feed exists; the executor's testnet price gate anchors MON to it and refuses on halt. Typechecks, compiles to WASM, 7 + 7 + 4 tests. | **Not simulated**: the CLI refuses every command until `cre login` (owner). The receiver needs ~0.12 MON to deploy for `--broadcast`. | owner (`cre login`, MON) | Medium–high |
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

**Mine, now (no owner input needed) — where each stands after 10-05:**
1. ~~**Perpl risk tool**~~ — done: `/perpl` is the risk tool (funding history, alerts, liquidation distance), `5815019`.
2. ~~**Kuru submission fields**~~ — done: `docs/KURU.md`, with a mainnet measurement of Kuru against Uniswap, `22ccda9`.
3. **Envio** — **blocked**: HyperSync on 10143 answers 401 without an API token, and indexing 68M blocks over RPC is not
   practical. Needs a free token from app.envio.dev (owner), then it is S–M.
4. ~~**Perpl bot hardening**~~ — done: exits on every desk, every tick (`server/src/monad/perpl-exits.ts`), `27f513a`; live
   once MON exists.
5. **Test funds through Agora's faucet** — already the code's first choice (`/perps/fund-test` calls
   `requestFunds(owner)` when Agora serves); blocked only on MON: the call costs ~0.012 MON and the faucet key holds 0.0053.
   The demo refresh waits on the same MON.
6. ~~**Chainlink CRE**~~ — built (`cre/`, `602e11f`); waits on `cre login` to simulate and ~0.12 MON to deploy the receiver.
7. ~~**MetaMask plugin**~~ — built (`mm-plugin-perpl/`, `b6857fa`); read commands ran in `mm` 7.0.0; wallet commands wait
   on `mm login` and a funded wallet.

**The owner's, by deadline:**
- **Oct 6 23:59 UTC:** register; create the team and project on hackathon.monad.xyz.
- **MON for gas** on Monad testnet (faucet.monad.xyz): `0x5C19…2D938` (faucet key), `0xEe7d…c49f` (delegate),
  `0x0b21…453f` (Perpl operator). Unblocks Perpl orders, the council's Perpl path, Mera's first tx on a real network.
- **Kuru v2 test tokens** from the Kuru integration contact (USDC `0xA402…fEF1` and MON-side assets), or a few dollars on
  mainnet — for fills on a real network.
- **`cre login`** (one browser sign-in) — then `cre workflow simulate ./mon-price` runs (`cre/README.md`); `--broadcast`
  also needs the receiver deployed (~0.12 test MON).
- **`mm login`** (MetaMask Agent Wallet sign-in) and a wallet with test MON + AUSD — then `mm perpl deposit/open/close` run
  for real (`mm-plugin-perpl/README.md`).
- **An Envio API token** (free, app.envio.dev) — unblocks the HyperIndex indexer.
- Keys, if wanted: Nansen, Moonshot/OpenRouter (Kimi), Alchemy.
- Hosting the executor (Railway or similar) — the web goes on Vercel; the executor needs an always-on host.
