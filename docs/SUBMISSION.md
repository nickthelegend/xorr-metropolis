# xorr — Monad Metropolis submission

**Track: 01 Onchain Finance & Trading.**

**Pitch.** Nobody can watch a market all night. xorr lets a council of AI agents do it for you on Monad, inside a
spending permission you grant on chain once and take back in one tap. Every trade is voted on first, and every vote
sits beside the transaction it produced. Spot fills go to whichever of Kuru's order book or Uniswap delivers more. Perps
go through Perpl's own DelegatedAccount: the agent can trade there but never withdraw. The account is a Mera passkey.

**Where this stands (6 Oct).**
- Built, and exercised end to end with real signed transactions on a local fork of Monad mainnet, which runs the real
  Kuru, Uniswap, Perpl, Chainlink and AUSD contracts.
- The core contracts are deployed and Sourcify-verified on Monad testnet; Perpl orders filled on Perpl testnet on 24 Sep.
- By the owner's decision, nothing new is deployed or hosted until the owner says go. Each bounty below names the live
  step it still needs; [`DEPLOY-LATER.md`](DEPLOY-LATER.md) is the one-hour runbook for them.
- Every component's status from a real run: [`TEST-PLAN-ZERO-MOCK.md`](TEST-PLAN-ZERO-MOCK.md).

---

## Portal fields (project)

| Field | Answer |
|---|---|
| Project name | xorr |
| Tagline | A council of AI agents trades for you on Monad, inside a permission you can revoke |
| Track | 01 — Onchain Finance & Trading |
| Repository | https://github.com/nickthelegend/xorr-metropolis (public, MIT) |
| Demo video (≤ 3 min) | [`docs/demo/xorr-monad-fork-demo.mp4`](demo/xorr-monad-fork-demo.mp4) (1:39, 6 Oct, the current product on a fork of Monad mainnet); [`docs/demo/xorr-monad-demo.mp4`](demo/xorr-monad-demo.mp4) (2:59, 24 Sep, with Perpl on Monad testnet); the final cut on testnet follows the go ([script below](#3-minute-demo-script)) |
| Live app | after the go (DEPLOY-LATER §6); locally: `sh infra/monad-fork/local-stack.sh refork` |
| Contracts (Monad testnet, 10143) | `XorrDelegation` [`0x5995925de0169574365cc7f6b65f765275b0bd4b`](https://testnet.monadvision.com/address/0x5995925de0169574365cc7f6b65f765275b0bd4b) (Sourcify-verified) · `XorrAuditAnchor` [`0x5a717b204c77bfba8805ffe1f382b074a3d26203`](https://testnet.monadvision.com/address/0x5a717b204c77bfba8805ffe1f382b074a3d26203) |
| Transactions (Monad testnet) | the table under [Evidence on Monad testnet](#evidence-on-monad-testnet) |
| Why Monad | 400 ms blocks let the council deliberate and still fill at the price it voted on; Kuru is a real on-chain order book to route against; Perpl's DelegatedAccount is the agent permission built in; gas is cheap enough to check the cap on chain on every spend. README → "Why Monad" |
| Pre-existing code | Yes: the earlier xorr builds (Base, Solana, X Layer, Arbitrum; September 2026). The root commit `5681467` is the Arbitrum build. The 100 commits since are the Monad work, listed in README → "Disclosures" |
| AI tools | Claude Code (Anthropic), credited as co-author on its commits; README → "Disclosures" |
| Team | nickthelegend |

### Evidence on Monad testnet

| What | Transaction |
|---|---|
| `XorrDelegation` deployed (settles in Agora AUSD) | [`0x808687be…d764e`](https://testnet.monadvision.com/tx/0x808687beb5699fc3a07353f65780e4e89f83d52452795b6871fb6b0c148d764e) |
| `XorrAuditAnchor` deployed | [`0xeb90b3eb…2fe`](https://testnet.monadvision.com/tx/0xeb90b3ebded116e7195da07942baade60e7bc21e763159469111f634107ce2fe) |
| Perpl desk created from the owner's signature (`createWithSignature`) | [`0x568e7975…b231`](https://testnet.monadvision.com/tx/0x568e79751adaa3f94b352a0ba7798eb55a17cb44cf007f268d4d069d70e5b231) |
| Desk's Perpl account opened with 150 AUSD (#692) | [`0xa2cebf40…7608`](https://testnet.monadvision.com/tx/0xa2cebf401fe1d750d041e6bf57b10932edd8c7d32eaa57ba62b3b38937f37608) |
| Agent opens a MON long through the desk | [`0xa2e9cb77…8f74`](https://testnet.monadvision.com/tx/0xa2e9cb774b23d7936e8a7e27cdda698afc3bb6c477daaf88a00982a4f9d18f74) |
| Agent closes it | [`0x3f0b0aa6…ac44`](https://testnet.monadvision.com/tx/0x3f0b0aa66e0ced670b028f51fc912fb3df94eacc02708a405f12023f569cac44) |
| Owner removes the operator | [`0x506bbe9e…3738`](https://testnet.monadvision.com/tx/0x506bbe9ececbfe4a8018f94c4e2728169c5e1a9f6af8eff2f04cf6a78d133738) |
| A raw operator order after that, mined as a revert | [`0x963b290a…76d0`](https://testnet.monadvision.com/tx/0x963b290a5fa35d1ac400dd2fce4fcbff9b99952936a8c0fdabdf23716e2476d0) |
| Owner withdraws 149.32 AUSD | [`0x42185571…b531`](https://testnet.monadvision.com/tx/0x421855713c3116469e1b18e1c51143055e2b7cbfd6e4267f137158f825abb531) |

Full log: [`evidence/prove-perpl-desk-testnet-2026-09-24.txt`](evidence/prove-perpl-desk-testnet-2026-09-24.txt).
Fork transactions are real signed transactions on a local chain, so they have no public explorer; their logs are in
[`evidence/`](evidence/).

---

## Run it — one command, then the whole product in a browser

```bash
sh infra/monad-fork/local-stack.sh refork       # fork Monad at the head; contracts, grant, Perpl keeper, executor, Envio indexer, web
npm run e2e:fork && npm run e2e:flows && npm run e2e:email && npm run e2e:crawl
sh infra/monad-fork/local-stack.sh down
```

The specs drive Chromium with a WebAuthn authenticator that has PRF, and each step fails on any console error or API
response ≥ 400. Results on 6 Oct:
- **The journey** ([`e2e-fork-journey-2026-10-06.txt`](evidence/e2e-fork-journey-2026-10-06.txt)), 9 steps:
  passkey account → fund → permission (3.1–5.6 s to the first confirmed transaction) → stateless sign-in → buy MON (the
  run names the other venue's number) → History indexed by Envio → Perpl desk → long and close → hold to stop, read back
  from the chain.
- **The flows** ([`e2e-flows-2026-10-06.txt`](evidence/e2e-flows-2026-10-06.txt)), 9 of 9 pass: zero and over-balance
  amounts refused, close a holding, a private note, a send to an allowlisted address, a council round, a hired agent
  trading on its own, the signing lock, the executor down and back.
- **Email sign-in** ([`e2e-email-2026-10-06.txt`](evidence/e2e-email-2026-10-06.txt)): Privy, with a test account's
  real one-time code typed into the form; the executor accepts the session.
- **The crawl** ([`crawl-fork-2026-10-06.txt`](evidence/crawl-fork-2026-10-06.txt)): all 116 screens at 375 px; 90
  render, 26 hidden on Monad by design, 0 failures; every control a screen reader reaches has a name, every image an alt.
- **Proofs without a browser:** `server/src/prove-monad.ts` (grant → fill → cap refusal mined → close → revoke mined) and
  `server/src/prove-perpl-desk.ts` (desk → open → cap refusal → close → exit guard → operator removed → withdrawal).
- **Quality gate** ([`quality-gate-2026-10-06.txt`](evidence/quality-gate-2026-10-06.txt)): app 2,855 tests, executor
  1,545, forge 66, plugin 16, CRE 7; typecheck and lint clean; slither triaged; secret scan clean.

---

## Per bounty — the portal's fields

Each bounty is set out the same way: what it asks, how xorr meets it, where the code is, the evidence, and the live step
left. The portal shows each bounty's own form only to registered teams, so these answers are written to paste into it.

### Agora — Best Mobile Trading App (Track 1, $10,000)

- **Asks:** a mobile app that authenticates via **Mera**, holds and displays an **AUSD balance**, and executes trades
  through **Perpl**. Demo: passkey login → AUSD balance → at least one Perpl trade.
- **How xorr meets it:**
  - **Mera is the account layer** on the web and in the native app. `src/auth/mera/platform.native.ts` runs Mera's
    ceremonies through its React Native client (`react-native-passkey` 3.6.1) and keeps the session in the
    Keychain/Keystore.
  - **AUSD** is Perpl's margin. The wallet's AUSD shows on Perps, Home and Deposit, with its Chainlink peg.
  - **Perpl** orders go through Perpl's own DelegatedAccount: the agent's key can trade and can never withdraw, and one
    tap removes it.
- **Code:** `src/auth/mera/`, `app/perps.tsx`, `server/src/monad/perpl-desk.ts`, `server/src/monad/perpl-routes.ts`.
- **Evidence:**
  - Journey steps 1, 7–9 on the fork: passkey → AUSD → Perpl long and close → stop.
  - Testnet, 24 Sep: desk, long, close and withdraw (the transactions above).
- **Status:** built. Shown end to end in the browser; the native passkey path has not yet run on a device.
- **Live step left:** serve `docs/passkey-domain/.well-known/*` (Apple team id, Android fingerprint) and make a
  development build with `EXPO_PUBLIC_MERA_RP_ID`; then record the same flow on a phone against testnet.

### Perpl — Best use of the API (all tracks, $5,000)

- **Asks:** a production-ready trading bot or automation system on Perpl.
- **How xorr meets it:**
  - **Every order is checked before anything is signed:** per-order, per-day and leverage caps; a simulation first; a
    refusal names its reason.
  - **Standing exits every 30 s:** liquidation buffer, stop-loss, take-profit, and a funding-aware exit (a losing
    position paying ≥ 50% a year). The exit guard closed a live position by itself in the fork proof.
  - **Orders are priced from the Exchange's on-chain book.**
  - **Each owner's agent has its own operator key**, so one owner's stop affects nobody else.
  - **Hold to stop** removes the operator on chain.
- **Code:** `server/src/monad/perpl-desk.ts`, `perpl-exits.ts`, `perpl-chain.ts`; on the fork,
  `server/src/fork/perpl-keeper.ts`.
- **Evidence:**
  - [`prove-perpl-desk-fork-2026-10-06.txt`](evidence/prove-perpl-desk-fork-2026-10-06.txt): open → $300 refused over
    the $250 per-order cap → close → exit guard → operator removed (a raw order reverts `OnlyOwnerOrOperator`) →
    withdrawal.
  - The testnet transactions above.
- **Status:** met on the fork and on testnet (24 Sep).
- **Live step left:** test MON for the delegate, then a fresh testnet run (DEPLOY-LATER §8).

### Perpl — Best Analytics / Risk Tool (Track 1, $3,000)

- **Asks:** a real-time analytics, risk-monitoring or portfolio intelligence dashboard focused on Perpl.
- **How xorr meets it:** `/perpl` shows, per market:
  - every funding payment over 24 h or 7 days, drawn above or below the line;
  - what a long paid and its yearly pace;
  - the price move and trades;
  - open interest in dollars, spread and staleness.
  - Above them, "worth a look" alerts: crowded funding, big moves, wide books, stale marks, and your positions near
    liquidation.
  - Signed in: your positions' distance to liquidation and their funding per hour.
- **Code:** `app/perpl.tsx`, `server/src/monad/perpl-risk.ts` (public API: context, funding history, candles).
- **Evidence:** the crawl renders `/perpl` with live data; `perpl-risk.test.ts`.
- **Status:** met. **Live step left:** none (it reads the build's own Perpl).

### Kuru — Next Consumer Trading App (Track 1, $5,000)

- **Asks:** a consumer spot product routing trades through Kuru's on-chain order book, with target users, evidence of
  demand, and an acquisition, retention and continuation plan.
- **How xorr meets it:**
  - `KuruVenue` fills through Kuru's MON/USDC book.
  - For every order, the executor measures Kuru and Uniswap through the contract and sends the better one.
  - Each fill says what routing was worth, for example: "Kuru measured 634.44 WMON; Uniswap v3 would have delivered
    633.51 — 0.15% more by routing here."
  - Users, demand (a mainnet measurement of Kuru against Uniswap at $10–$20,000), retention and continuation are in
    [`KURU.md`](KURU.md).
- **Code:** `contracts/src/KuruVenue.sol`, `server/src/venues/kuru-fill.ts`, `server/src/monad/kuru.ts`.
- **Evidence:** journey step 5;
  [`kuru-vs-uniswap-mainnet-2026-10-05.txt`](evidence/kuru-vs-uniswap-mainnet-2026-10-05.txt).
- **Status:** met on the fork.
- **Live step left:** a fill on a real network (Kuru v2 test tokens from Kuru, or a few dollars on mainnet).

### MetaMask — Best Agent Wallet Plugin (Track 1, $2,500)

- **Asks:** a plugin that gives the MetaMask Agent Wallet a new trading power.
- **How xorr meets it:**
  - [`mm-plugin-perpl/`](../mm-plugin-perpl/README.md) adds Perpl perps on Monad to the agent wallet:
    `mm perpl markets · risk · account · deposit · open · close`.
  - Every transaction is simulated first and sent through `ctx.walletExecutor` (Guard mode, Blockaid, 2FA).
- **Evidence:** [`mm-perpl-2026-10-05.txt`](evidence/mm-perpl-2026-10-05.txt) — `markets` and `risk` ran inside
  `mm` 7.0.0 on both networks; 16 unit tests.
- **Status:** built.
- **Live step left:** `mm login` and a wallet with test MON and AUSD for the trading commands.

### Mera — Best Mera-Powered UX (all tracks, $2,500)

- **Asks:** Mera as the entire account layer; time to first transaction; session design; the stateless test.
- **How xorr meets it:**
  - **One passkey ceremony, no email.**
  - **Time to first transaction: 3.1–5.6 s**, from the app on screen to a confirmed permission: the account is created,
    test funds arrive, and Mera's signing session signs the grant with no prompt.
  - **A 15-minute signing window** with a countdown and a lock. A page load starts locked, and the next signature asks
    the passkey again (flow B16).
  - **The stateless test:** storage cleared mid-run → "Sign in with a passkey" → the same account.
- **Code:** `src/auth/mera/`, `server/src/auth/passkey-session.ts`.
- **Evidence:** journey steps 1–4; flows B16.
- **Status:** met on the fork.
- **Live step left:** the same on Monad testnet (test MON for gas).

### Mera — One Passkey, Many Keys (all tracks, $2,500)

- **Asks:** a creative non-wallet use of Mera's PRF-derived key material, and a live cross-device test.
- **How xorr meets it:**
  - A second PRF namespace (`xorr.notes.v1`) derives a key that encrypts private notes on each trade.
  - The server stores only ciphertext, and the passkey opens the notes on any device.
- **Evidence:** flows B15 (sealed, ciphertext on the server, reopened after a reload).
- **Status:** met in the browser.
- **Live step left:** a cross-device run on real hardware (a virtual authenticator cannot carry PRF across devices).

### Chainlink — Best workflow with CRE (all tracks, $3,000)

- **Asks:** a CRE workflow as an orchestration layer between a chain and an external API or agent; a CLI simulation is
  accepted.
- **How xorr meets it:**
  - [`cre/`](../cre/README.md) runs cron → HTTP with consensus (Perpl's MON mark) → EVM reads on Monad mainnet (Kuru's
    book, Chainlink MON/USD) → a median and a halt → `writeReport` to `XorrPriceReceiver` on Monad testnet, which has
    no MON/USD feed.
  - The executor's testnet price gate anchors MON to that report and refuses trades on a halt.
- **Code:** `cre/mon-price/workflow.ts`, `contracts/src/XorrPriceReceiver.sol`, `server/src/monad/cre-price.ts`.
- **Evidence:** it compiles to WASM; 7 workflow tests, 7 receiver tests, 4 gate tests.
- **Status:** built, not yet simulated.
- **Live step left:** `cre login`, then `cre workflow simulate` (and `--broadcast` after the receiver is deployed,
  ~0.12 MON).

### Envio — Best Use of Envio (all tracks, $1,000 + hosting)

- **Asks:** HyperIndex, HyperSync or HyperRPC powering real on-chain data in a core feature; a public config, schema and
  handlers.
- **How xorr meets it:**
  - [`indexer/`](../indexer/config.yaml) is HyperIndex v3 over `XorrDelegation` (grants, spends, closes, revokes,
    venue changes), the audit anchor, and Perpl's DelegatedAccount factory. Each desk registers as a contract of its own
    when it is created.
  - It derives per-owner totals, per-day spend against the cap, per-venue volume, and desk state.
  - It writes into the executor's Postgres; `GET /indexed` is its API, and History leads with it.
- **Evidence:** journey step 6 (History's "Indexed by Envio" card).
- **Status:** met locally (RPC sync).
- **Live step left:** an Envio API token (HyperSync) for testnet, or Envio Cloud.

### Kimi (all tracks, credits)

- **How xorr uses it:**
  - The council's fifth seat, **Strategist (Kimi)**, reads every desk's readings and ballot, and its vote decides split
    rounds.
  - It cannot veto, and every number in its reason must be one a desk reported (`server/src/council/strategist.ts`).
- **Without `MOONSHOT_API_KEY`** the seat does not sit: four desks vote, and the Council screen says so. There is no
  stand-in answer (flows B7).
- **Live step left:** `MOONSHOT_API_KEY`.

---

## 3-minute demo script

Recorded from the hosted testnet app after the go, with the Kuru beat from the fork. The shot list and recording notes
are in [`DEPLOY-LATER.md`](DEPLOY-LATER.md) §10. The 6 Oct fork cut,
[`demo/xorr-monad-fork-demo.mp4`](demo/xorr-monad-fork-demo.mp4), is the same order without the terminal and explorer
beats (0:00–1:39, captions in the frame, recorded by `npm run demo:record`).

| Time | On screen | Words |
|---|---|---|
| 0:00 | Home | "Nobody can watch a market all night. xorr is a council of AI agents that trades for you on Monad — inside a limit the chain enforces." |
| 0:12 | Create a passkey account; the address appears | "One passkey — Mera. No email, no seed phrase. The wallet comes from the passkey itself." |
| 0:30 | Test funds; the permission: $ a day, an end date, the venues; signed, no popup; the timer | "I give the agents a daily limit and an end date. Mera's signing session signs it — no wallet popup. Under six seconds to my first transaction." |
| 0:50 | Clear storage → "Sign in with a passkey" → same address | "Nothing is stored. Wipe the browser, and the passkey brings back the same account." |
| 1:02 | (fork) Buy $20 of MON; the run screen | "Every order measures Kuru's order book against Uniswap and fills on the better one — and says what routing was worth." |
| 1:22 | Council round: four desks, the vote, "Executed"; the Strategist seat | "Before an agent trades, four desks vote on Monad's own numbers — Chainlink, Kuru, Perpl funding, my limit. Kimi breaks ties. On Monad the vote and the fill land in the same second." |
| 1:42 | Perps: AUSD balance; the Perpl desk; long MON 1x; position with liquidation distance | "Perps run on Perpl through Perpl's own delegated account, with AUSD as margin. The agent can trade it — it can never withdraw." |
| 2:02 | Exit rules on the desk; `/perpl` risk screen | "Every 30 seconds, standing exits — liquidation buffer, stop-loss, a funding-aware exit. And a risk view of every Perpl market." |
| 2:20 | History: "Indexed by Envio" | "The on-chain record — every grant, spend and desk — indexed by Envio." |
| 2:30 | Terminal: `mm perpl markets`; the CRE report on MonadVision | "The same Perpl trading as a MetaMask Agent Wallet plugin, and a Chainlink CRE workflow that brings MON/USD to testnet." |
| 2:42 | Hold to stop; the explorer shows the revoke and `removeOperator` | "And one hold stops everything: the permission is revoked and the operator removed — on chain, where I can check it." |
| 2:55 | Repo URL; "MIT · built with Claude Code" | "xorr. The agents trade; the chain keeps the limit." |

---

## Live steps left, in one place

All of them are in [`DEPLOY-LATER.md`](DEPLOY-LATER.md), in order.

- Register on hackathon.monad.xyz (**Oct 6 23:59 UTC**) and submit before **Oct 13 23:59 ET**.
- The testnet go, with MON: 2.5 for the deployer/faucet key, 1.5 for the delegate (DEPLOY-LATER §1).
- Keys and sign-ins: `MOONSHOT_API_KEY` (Kimi), `cre login`, `mm login`, an Envio API token.
- The passkey domain's two files and a development build (Mera on the phone).
- Kuru v2 test tokens, or a few dollars on mainnet.
- Hosting: Railway for the executor and the indexer, Vercel for the web (DEPLOY-LATER §4–6).

## Disclosures

Built from the earlier xorr builds (Base, Solana, X Layer, Arbitrum), as the README says. What is new in the window is
listed in README → "Disclosures". Written with AI coding assistance (Claude Code), also stated in the README.
