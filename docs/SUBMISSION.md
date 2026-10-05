# xorr — Monad Metropolis submission

**Track: 01 Onchain Finance & Trading.** A council of AI agents trades for you on Monad inside a spending permission you
grant on chain and take back in one tap. Every trade is voted on first and every vote sits beside the transaction it
produced; spot fills go to whichever of Kuru's book or Uniswap delivers more, perps go through Perpl's own
DelegatedAccount, and the account is a Mera passkey.

**Where this stands (6 Oct).** Built and exercised end to end on a local fork of Monad mainnet; the contracts are deployed
and Sourcify-verified on Monad testnet. By the owner's decision, nothing new is deployed or hosted yet — the live steps
each bounty still needs are listed under it, and in one place at the end.

---

## Run it — one command, then the whole product in a browser

```bash
sh infra/monad-fork/local-stack.sh refork       # fork Monad at the head; contracts, grant, Perpl keeper, executor, Envio indexer, web
WEB=http://localhost:8092 API=http://localhost:8790 npm run e2e:fork
```

`e2e/web/fork-journey.mjs` drives Chromium with a WebAuthn authenticator that has PRF and checks every step on screen,
then reads the chain back (`docs/evidence/e2e-fork-journey-2026-10-06.txt`):

1. **Create a passkey account** (Mera) — about 1.5 s; nothing that signs is stored.
2. **Fund** from the fork faucet, **sign the trading permission** — Mera's signing session signs, no wallet popup. 3.1 s
   from the app on screen to the confirmed permission. Then **the stateless test**: storage cleared, the passkey brings
   back the same account.
3. **Buy $20 of MON**; the run says where it filled and what the other venue would have delivered.
4. **History** shows the wallet's on-chain record, **indexed by Envio**.
5. **Perps**: an AUSD balance, a Perpl desk, a MON long and its close.
6. **Hold to stop**: the permission is revoked on chain and the desk's operator removed — read back from the chain.

0 console errors. Proofs that run without a browser: `server/src/prove-monad.ts` (grant → fill → cap refusal mined →
close → revoke mined) and `server/src/prove-perpl-desk.ts` (desk → open → cap refusal → close → exit guard → operator
removed → withdrawal), both passing on the fork.

---

## Per bounty

### Agora — Best Mobile Trading App (T1) — *built; the phone needs its passkey domain*

**Asks:** a mobile app authenticating via **Mera**, holding an **AUSD balance**, executing trades through **Perpl**.

- **Mera** is the account layer on the web and now in the native app: `src/auth/mera/platform.native.ts` runs Mera's
  ceremonies through its React Native client (`react-native-passkey` 3.6.1), keeps the session in the Keychain/Keystore,
  and the native auth, token and signing hooks carry the same Mera branches as the web ones.
- **AUSD**: Perpl's margin; the wallet's AUSD is on Perps, Home and Deposit, with its Chainlink peg.
- **Perpl**: orders through Perpl's own DelegatedAccount — the agent's key can trade and can never withdraw; one tap
  removes it.
- **Shown end to end** in the browser journey above (passkey → AUSD → Perpl long and close) on the fork.
- **Live step left:** serve `docs/passkey-domain/.well-known/*` on the passkey domain (team id and signing fingerprint
  filled in) and make a development build with `EXPO_PUBLIC_MERA_RP_ID` set — then the same flow runs on the phone.

### Perpl — Best use of the API (All) — *met on the fork*

**Asks:** a production-ready trading bot or automation system on Perpl.

- Agents open and close through each owner's DelegatedAccount, inside per-order / per-day / leverage caps checked before
  anything is signed; every order is simulated first and a refusal is named (`server/src/monad/perpl-desk.ts`).
- **Standing exits** every 30 s: liquidation buffer, stop-loss, take-profit and a funding-aware exit (a loser paying
  ≥ 50% a year), set per desk; the exit guard closed a live position by itself in the fork proof
  (`server/src/monad/perpl-exits.ts`, `docs/evidence/prove-perpl-desk-fork-2026-10-06.txt`).
- Orders are priced from the book the Exchange holds now, not an API copy.
- **On the fork with a keeper**: `server/src/fork/perpl-keeper.ts` posts Perpl's live marks (kept inside the fork's own
  book) so Perpl's real Exchange and order book trade locally.
- **Live step left:** test MON for the operator key to run the same on Perpl's testnet (it did on 24 Sep: 6 orders).

### Perpl — Best Analytics / Risk Tool (T1) — *met*

**Asks:** a real-time analytics, risk-monitoring or portfolio intelligence dashboard focused on Perpl.

- `/perpl`: per market, every funding payment over 24 h or 7 days drawn above/below the line, what a long paid and its
  yearly pace, the price move and trades, open interest in dollars, spread and staleness; "worth a look" alerts (crowded
  funding, big moves, wide books, stale marks, your positions near liquidation); your positions' distance to liquidation
  and funding per hour. Public API only (`server/src/monad/perpl-risk.ts`).

### Kuru — Next Consumer Trading App (T1) — *met on the fork*

**Asks:** a consumer spot product routing trades through Kuru's on-chain order book; target users, evidence of demand,
retention plan.

- `contracts/src/KuruVenue.sol` fills through Kuru's MON/USDC book; the executor measures Kuru and Uniswap through the
  contract for every order and sends the better one. **Each fill now says what routing was worth** — "Kuru measured
  634.44 WMON; Uniswap v3 would have delivered 633.51 — 0.15% more by routing here" — on the run screen.
- Users, demand (a mainnet measurement of Kuru against Uniswap at $10–$20,000), retention and continuation:
  [`docs/KURU.md`](KURU.md).
- **Live step left:** a fill on a real network (Kuru v2 test tokens, or a few dollars on mainnet).

### MetaMask — Best Agent Wallet Plugin (T1) — *built*

**Asks:** a plugin giving the MetaMask Agent Wallet a new trading power.

- [`mm-plugin-perpl/`](../mm-plugin-perpl/README.md): `mm perpl markets · risk · account · deposit · open · close` —
  Perpl perps on Monad for the agent wallet, every transaction simulated first and sent through `ctx.walletExecutor`
  (Guard mode, Blockaid, 2FA). `markets` and `risk` ran inside `mm` 7.0.0 on both networks; 16 unit tests.
- **Live step left:** `mm login` and a wallet with test MON and AUSD for the trading commands.

### Mera — Best Mera-Powered UX (All) — *met on the local chain*

**Asks:** Mera as the entire account layer; time-to-first-transaction; session design; the stateless test.

- One passkey ceremony, no email. **Time to first transaction: 3.1 s** from the app on screen to a confirmed permission
  (account, test funds, the grant signed by Mera's signing session with no prompt). A 15-minute signing window with a
  countdown and a lock. **The stateless test**, in the journey: storage cleared mid-run, "Sign in with a passkey", the same
  account back from the passkey alone (`docs/evidence/e2e-fork-journey-2026-10-06.txt`).
- **Live step left:** the same on Monad testnet (test MON for gas).

### Mera — One Passkey, Many Keys (All) — *met*

- A second PRF namespace (`xorr.notes.v1`) encrypts private notes on each trade; the server stores ciphertext only;
  reopened after clearing storage. **Live step left:** a cross-device run on real hardware.

### Chainlink — Best workflow with CRE (All) — *built; not yet simulated*

- [`cre/`](../cre/README.md): cron → HTTP with consensus (Perpl's MON mark) → EVM reads on Monad mainnet (Kuru's book,
  Chainlink MON/USD) → median and a halt → `writeReport` to `XorrPriceReceiver` (a `ReceiverTemplate`) on Monad testnet,
  where no MON/USD feed exists; the testnet price gate anchors MON to it and refuses on halt. Compiles to WASM; 7 + 7 + 4
  tests.
- **Live step left:** `cre login`, then `cre workflow simulate ./mon-price`.

### Envio — Best Use of Envio (All) — *met locally*

**Asks:** HyperIndex / HyperSync / HyperRPC powering real on-chain data in a core feature; derived entities; a consumer.

- [`indexer/`](../indexer/config.yaml): HyperIndex v3 over XorrDelegation (grants, spends, closes, revokes, venue
  changes), the audit anchor, and Perpl's DelegatedAccount factory with each desk registered as a contract of its own.
  Derived entities: per-owner totals, per-day spend against the cap, per-venue volume, desk state. Synced over RPC (no
  token), written into the executor's Postgres; `GET /indexed` is its API and History shows it.
- **Live step left:** an Envio API token (HyperSync) or Envio Cloud for a hosted index.

### Kimi (All) — *built; needs a key*

- The council's fifth seat, **Strategist (Kimi)**, reads every desk's readings and ballot and casts the vote that decides
  split rounds; it cannot veto, and every number in its reason must be one a desk reported
  (`server/src/council/strategist.ts`). Without `MOONSHOT_API_KEY` it is a labelled fixture that never votes.

---

## Deployed

| | |
|---|---|
| Monad testnet `XorrDelegation` (AUSD) | `0x5995925de0169574365cc7f6b65f765275b0bd4b` — Sourcify-verified |
| Monad testnet `XorrAuditAnchor` | `0x5a717b204c77bfba8805ffe1f382b074a3d26203` |
| Perpl testnet desk (24 Sep proof) | `0xa21Fa8708008890565817c9d73538Cabc3d098b5`, account #692 |

## Live steps left, in one place

- Register on hackathon.monad.xyz (Oct 6 23:59 UTC) and submit.
- Test MON for the testnet keys; ~0.12 MON for the CRE receiver.
- Keys and sign-ins: `MOONSHOT_API_KEY` (Kimi), `cre login`, `mm login`, an Envio API token.
- The passkey domain's two files and a development build (Mera on the phone).
- Kuru v2 test tokens, or a few dollars on mainnet.
- Hosting the executor and web.

## Disclosures

Built from the earlier xorr builds (Base, Solana, X Layer, Arbitrum); see the README. Written with AI coding assistance
(Claude Code), as the README states.
