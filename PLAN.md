# xorr on Monad — the plan (source of truth)

Started 2026-09-24 from a snapshot of xorr-arbitrum (`fea3073`), the root commit `5681467` of this repository. Update the
status tags as work lands; nothing is DONE until its verification has been run and the evidence is named. The hackathon,
its rules and the ranked bounties: `docs/METROPOLIS.md`. Superseded: `docs/archive/PLAN-arbitrum-2026-09-23.md`.

## 1. Goals

**Pitch.** xorr is a non-custodial AI trading desk on Monad: you sign in with a passkey, grant a council of agents a
capped, revocable, on-chain permission, and they trade for you — spot through Kuru's order book and Uniswap, perps on
Perpl — every vote shown beside the transaction it produced. Monad's 400 ms blocks are why a council can deliberate and
still fill at the price it voted on. The permission is the product.

**Hackathon.** Monad Metropolis, track **Onchain Finance & Trading**. Deadline **2026-10-13 11:59 PM ET**. Must be
deployed on Monad mainnet or testnet, open source with an OSI licence, the foundation and AI tools disclosed in the README,
a demo video of 3 minutes or less.

**Definition of done**
- **Qualified** — `XorrDelegation` + `XorrAuditAnchor` deployed and Sourcify-verified on **Monad testnet**; repository
  public; MIT licence; README discloses foundation and AI tools.
- **Product** — a judge can: sign in with a passkey → see an AUSD and USDC balance → grant a cap → hire agents → watch
  the council vote and fill MON on Kuru (or Uniswap, whichever quotes better) → open a Perpl position from an agent → stop
  everything on-chain in one tap → withdraw.
- **Honest** — every price has a named source (Uniswap pool, Kuru book, Chainlink, Perpl); the gap between them gates a
  spend; a fork is always labelled a fork; nothing in a product path is fixture data.
- **Technical** — typecheck, lint, unit tests, `forge test`, `prove-monad.ts`, and CI green on `main`.
- **Submitted** — demo video, hackathon.monad.xyz form with contract addresses and the bounties below.

**Bounties we build for** (ranking and reasons in `docs/METROPOLIS.md`): Agora Best Mobile Trading App ($10K), Perpl
API ($5K), Kuru Next Consumer Trading App ($5K), Mera One Passkey Many Keys ($2.5K), Mera-Powered UX ($2.5K); then
Perpl Risk Tool ($3K), Chainlink CRE ($3K), Envio ($1K), Nansen ($5K pool), MetaMask Agent Wallet Plugin ($2.5K).

## 2. Architecture (decided)

| Piece | Decision |
|---|---|
| Chains | `monad-fork` (anvil fork of Monad mainnet 143: real USDC, AUSD, Uniswap v3, Kuru, Chainlink state) where fills are real with test money; `monad-testnet` (10143) where the contracts are deployed and verified; `monad` (143) only with ALLOW_MAINNET. |
| Permission | `XorrDelegation` (daily cap, venue allowlist, expiry, revoke, min-out, `spendVia`), settlement token USDC on spot. |
| Spot venues | Uniswap v3 (QuoterV2 + SwapRouter02) — wired and proven. Kuru's CLOB (MON/USDC) — read; routing next. Best quote wins. |
| Perps | Perpl (AUSD margin; Ed25519 API key enrolled once with a wallet signature). |
| Price truth | Uniswap pool, Kuru mid, Chainlink feed, read from Monad mainnet live; the widest gap between them gates a spend. |
| Accounts | Mera passkeys (web + Expo via react-native-passkey) replace Privy on this build (D1). |
| Hosting | Railway project (to create): `monad-fork` (infra/monad-fork, volume /data), `executor-monad-fork`, Postgres. Vercel project `xorr-metropolis`. |

**Decisions**
- **D1** Mera, not Privy, is the account layer: Agora requires Mera authentication and Mera's UX bounty requires it to be
  the whole account layer; Privy's own bounty requires more than login. $15K against $5K.
- **D2** USDC settles spot (Uniswap's and Kuru's deep MON books are USDC); AUSD is the Perpl margin and is shown as a
  balance (Agora). AUSD's Uniswap pools hold a few dollars and Kuru's MON/AUSD book was empty on 2026-09-24, so AUSD is
  not a spot settlement token until that changes.
- **D3** No stock screens: Monad has no tokenized equities (official token list, 2026-09-24).
- **D4** Monad testnet settles in xorr's TestUSDC: the USDC published for the testnet before its reset has no code.

## 3. Phases and tasks

Status: **DONE** (verified, evidence named) · **IN PROGRESS** · **NOT STARTED** · **BLOCKED** (reason).

### P0 — Foundation
- P0.1 **DONE** Repository `github.com/nickthelegend/xorr-metropolis` (private until submission), root commit `5681467`
  "Initial commit" = xorr-arbitrum `fea3073`. (`nickthelegend/xorr-monad` is a different, earlier project and untouched.)
- P0.2 **DONE** Chain keys `monad`, `monad-testnet`, `monad-fork` on both sides, with verified token addresses. Evidence:
  `79a25e5`; chain tests; `chain-agreement.test.ts`.
- P0.3 **DONE** `infra/monad-fork` (anvil fork of 143, state on a volume, a block a second, clock kept to wall time).
  Evidence: `b37b187`; ran locally, chain 143, mining.
- P0.4 **DONE** Fork bootstrap on `monad-fork`: XorrDelegation + anchor deployed, delegate funded, 25,000 USDC paid.
  Evidence: `b37b187`.
- P0.5 **DONE** Monad testnet deployment, settling in Agora's AUSD: XorrDelegation
  `0x5995925de0169574365cc7f6b65f765275b0bd4b`, anchor `0x5a717b204c77bfba8805ffe1f382b074a3d26203`, Sourcify-verified.
  Evidence: `86f7900`, `contracts/deployments/monad-testnet.json`.
- P0.6 **NOT STARTED** Hosting: Railway project + `monad-fork` + `executor-monad-fork` + Postgres; Vercel
  `xorr-metropolis`. Deploy scripts refuse without an explicit target (`900cdcd`).
- P0.7 **DONE** App builds for Monad: networks, hidden Arbitrum/Robinhood screens, Trade → Markets. Evidence: `aeddf20`;
  app tests 2,748 pass.

### P1 — Spot on Monad
- P1.1 **DONE** Uniswap v3 on 143 as the settlement venue; Monad token registry; prices. Evidence: `09b9443`.
- P1.2 **DONE** `server/src/prove-monad.ts` on a Monad fork: faucet → grant $100/day → $50 MON filled (2,065.82 WMON) →
  $60 refused off-chain and on-chain (`DailyCapExceeded(60000000, 50000000)`, mined) → close to USDC → revoke →
  `PolicyRevoked()`. Evidence: `131f988`, `docs/evidence/prove-monad-fork-2026-09-24.txt`; one of four runs failed at the
  close with the cause swallowed and did not recur.
- P1.3 **NOT STARTED** Kuru fill path: route MON/USDC through Kuru's router (or KuruFlow) from `spend()`; add the router
  to the grant's venues; best of Uniswap vs Kuru per trade. (Kuru bounty.)
- P1.4 **DONE** `closeHolding` records the raw error in an audit row and its response, as a failed buy does, so a failed
  close says why (the swallowed cause in P1.2). Evidence: server unit tests 1,481 pass.

### P2 — Price truth
- P2.1 **DONE** `server/src/monad/`: Chainlink feeds, Kuru top of book, Perpl markets, `crosscheckMon`; public
  `/monad/crosscheck`, `/monad/perpl`. Evidence: `d4c76b4`; live test: Uniswap $0.024112, Kuru $0.024117, Chainlink
  $0.024118, gap 2.2 bps.
- P2.2 **IN PROGRESS** The gap gates a council spend: the price desk vetoes a round whose fill is past 150 bps from
  Chainlink, or whose feed is stale, naming the numbers (`bf8b4f6`). A manual order is not gated yet.
- P2.3 **DONE** Council seats on Monad read Chainlink on Monad, the fill's venue, Kuru's book and Perpl funding (price desk,
  risk keeper, trend reader, perps desk). Evidence: `bf8b4f6`; round #2 on the fork approved 2–1 and executed
  (1,037.94 WMON, `0x6289f268…c9c121`, receipt status 1).

### P3 — Perps on Perpl (Agora, Perpl API)
- P3.1 **DONE** Public market read (`monad/perpl.ts`).
- P3.2 **DONE** Orders from an agent through Perpl's own `DelegatedAccount` — on chain, no API key: the owner owns the desk,
  xorr's key is its operator (trades, never withdraws). Evidence: `2c5fde5`,
  `docs/evidence/prove-perpl-desk-testnet-2026-09-24.txt` (desk `0xa21F…98b5`, account #692); UI flow on desk `0x3323…11b8`.
- P3.3 **DONE** The perps permission: per-order, per-day and leverage limits the owner sets on Perps (`9c0a894`), enforced
  before every order; removing the operator (Perps' hold, or Safety's stop, `9e101cf`) stops orders on chain.
- P3.4 **DONE** Positions with entry, mark, PnL, liquidation price and a meter (`9b84ce2`); Perpl live, every market's open
  interest and funding (`16c4fcb`).

### P4 — Accounts: Mera (Agora, Mera ×2)
- P4.1 **NOT STARTED** Mera passkey sign-in on web and Expo (iOS 18+/Android 9+, one passkey domain); Privy removed from
  the sign-in path.
- P4.2 **IN PROGRESS** AUSD is the testnet dollar ("Cash · AUSD" on Portfolio, `14e8745`); Agora's faucet (or the
  reserve) behind the Perps test-funds button (`2c5fde5`). Home and Deposit do not name it yet.
- P4.3 **NOT STARTED** Per-agent identity keys and an encrypted agent-memory key derived from the passkey's PRF output.
- P4.4 **NOT STARTED** Scoped session: agents trade without a prompt inside the grant; identity rebuilt on a fresh device.

### P5 — Data and orchestration
- P5.1 **NOT STARTED** Envio HyperIndex for `XorrDelegation` (grants, spends, revokes) driving History and Verify.
- P5.2 **NOT STARTED** Chainlink CRE workflow: price gate + council round hash → `XorrAuditAnchor` (simulation accepted).
- P5.3 **NOT STARTED** Nansen smart-money seat (needs a key).
- P5.4 **NOT STARTED** MetaMask Agent Wallet plugin.

### P6 — Submission
- P6.1 **IN PROGRESS** README Monad-first with the foundation and AI tools disclosed; MIT licence.
- P6.2 **BLOCKED (owner)** Repository public; register on hackathon.monad.xyz; demo video ≤ 3 min; submit before
  2026-10-13 11:59 PM ET.

## 4. Owner actions

1. Top up the Monad testnet deployer `0x5C1948d90570BA8547956B2Be2d3179454D22938` with test MON (faucet.monad.xyz): it
   is the faucet key for `/perps/fund-test` and the delegate's gas, and holds ~0.009 MON after the testnet runs.
2. Register on https://hackathon.monad.xyz (bounty pages are visible only to registered participants).
3. Make the repository public before submitting (the rules require it).
4. Keys when those phases start: Perpl API enrolment (a wallet signature), Nansen API key, a Monad archive RPC for the
   hosted fork (optional).
5. Perpl blocks US and GB users: record the Perpl part of the demo from where it is offered.
