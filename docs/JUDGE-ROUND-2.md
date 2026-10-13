# Judge round 2 (13 Oct 2026)

An independent judge (a fresh subagent given only the live URL, the public repo, `docs/PORTAL-COPY.md` and the official
rubric) judged xorr signed out. Its verdict, verbatim, then the fixes and the re-judge.

## Round 1 verdict

# xorr: judge's verdict (Monad Metropolis, Track 01)

**Bottom line:** I'd score it **7.4/10** on the main track. The Perpl desk is real and I checked it on chain, and the `/monad` and `/perpl` screens are well made. The submission still overclaims. None of the three contracts is on Sourcify, though the copy says "(Sourcify)". The Envio feed is empty. Several Monad-native features are labelled "Local fork / Awaiting testnet go" in the app itself.

Everything below is what I could check signed out, using Playwright at 1440px and 390px, `cast` against testnet-rpc.monad.xyz, the Sourcify v2 API and a clone of the repo. I made no accounts and signed nothing.

## What checks out
- **The live app is up.** `/welcome`, `/how` (3 steps), `/explore`, `/judges`, `/gauntlet`, `/markets`, `/council` and `/perpl` all return 200, with **no console errors** at either width.
- **`/monad` streams live Monad mainnet commit states.** Proposed, voted (~290 ms) and final (~560 ms) show up as claimed.
- **Tx 1** (`0x54a880…`) succeeded. It is `execOrder` on desk `0xa21F…`, emitted 5 Perpl logs, and the evidence file tags it as the exit guard's liquidation close.
- **Tx 2a** (`0x6babda…`) succeeded. It is `removeOperator`, sent by the desk owner `0x2ea1…`, and `owner()` on chain confirms that address.
- **Tx 2b** (`0xd9e94a…`) is the same operator's `execOrder`, **reverted** (status 0) four blocks later. The claim holds.
- **Tx 3** (`0x0a228a…`) succeeded. It is `report(...)` sent through the forwarder `0xb9f7…`, and it emitted an event from `XorrPriceReceiver`.
- **Bytecode exists** at all three contract addresses.
- **Every file the copy names exists:** `src/auth/mera`, `perpl-desk.ts`, `perpl-risk.ts`, `KuruVenue.sol`, `docs/KURU.md`, `mm-plugin-perpl/`, `cre/mon-price`, `indexer/`, `strategist.ts`, the evidence file and an MIT LICENSE. The demo video runs **2:38**, as stated.
- **The executor answers.** `/health` reports chain `monad-testnet` with the claimed delegation address, and `POST /x402/council` returns **402**, so the paywall is live.
- **The README has a clear "Disclosures" section** about pre-existing code.

## Main track (Onchain Finance & Trading)

| Criterion (20% each) | Score | Why |
|---|---|---|
| Product quality | 7 | Polished dark UI, a clear 3-step explainer, and good 390px layouts. At desktop width it's a phone frame with the tagline repeated beside it, plus a white gradient bleeding off the right edge. |
| Technical excellence | 8 | A real operator/owner split on Perpl, an exit guard that runs without user action, and a revocation proven by a revert. The backend is big and coherent. |
| Monad integration | 7 | The `monadNewHeads` view and the P256 `0x0100` check are live on mainnet. `eth_sendRawTransactionSync`, staking and x402 show "Local fork / Awaiting testnet go". |
| Track fit | 8 | Agent trading inside a limit enforced on chain fits the track exactly. |
| Innovation | 7 | A council of voting seats with replay is a fresh framing. The delegated-limit agent idea is familiar. |
| **Weighted** | **7.4** | |

## Bounties (meets requirement 40 / technical 30 / Monad 20 / innovation 10)

| Bounty | Req | Tech | Monad | Innov | **Total** | Note |
|---|---|---|---|---|---|---|
| Perpl: Best use of the API | 9 | 8 | 8 | 7 | **8.3** | All three txs check out on chain. This is the strongest entry. |
| Perpl: Analytics / Risk | 8 | 7 | 7 | 6 | **7.3** | `/perpl` is live and readable: 8 markets, funding APR, open interest, spread, staleness. |
| Chainlink CRE | 7 | 7 | 6 | 5 | **6.6** | The report tx is real and the receiver emitted an event. The receiver isn't verified. |
| Mera: One Passkey, Many Keys | 5 | 7 | 8 | 7 | **6.4** | The P256 check is live on mainnet. The PRF-sealed notes can't be seen signed out. |
| Agora: Mobile Trading App | 5 | 7 | 7 | 6 | **6.1** | It's the web app in a phone browser. The native app isn't shown and the AUSD balance needs sign-in. |
| Kuru: Consumer Trading App | 4 | 7 | 6 | 6 | **5.5** | Proven on a mainnet fork only. The testnet buy path goes to Perpl, not Kuru. |
| Kimi | 6 | 6 | 4 | 5 | **5.5** | The seat is visible on `/council`, but I couldn't watch it vote signed out. |
| Mera: Best UX | 5 | 6 | 5 | 6 | **5.4** | Can't verify signed out. The app still loads `auth.privy.io`, which undercuts "Mera is the whole account layer". |
| MetaMask Agent Wallet plugin | 5 | 6 | 5 | 5 | **5.3** | The directory exists. There's no live demo or tx. |
| Envio | 4 | 6 | 6 | 4 | **5.0** | `GET /indexed/recent` on the executor returns `{"fills":[]}`. |

## Claims I could not verify
- **"XorrDelegation (Sourcify)" and "XorrPriceReceiver (Sourcify)":** the Sourcify v2 API returns `match: null` on chain 10143 and `{"results":[]}` across all chains, for all three contracts. MonadVision sits behind a Cloudflare challenge, so I couldn't see its "verified" badge. As far as I can tell they are not verified.
- **That the "daily limit the chain enforces" works:** no tx in the copy shows a spend over the limit reverting. The only revert shown comes from removing the operator.
- **"Envio … `/indexed/recent` shows everyone's latest fills":** the endpoint returns an empty list, and the app route `/indexed/recent` shows "Not found". History is behind sign-in.
- **"Receipts with the send" (`eth_sendRawTransactionSync`), staking at `0x1000` and x402 settlement:** the app's own `/monad` cards say these are fork-only or "Awaiting testnet go".
- **Kuru fills:** the copy itself says they are fork-only, and I found no testnet tx.
- **Mera stateless sign-in, the signing session, PRF notes, the native Expo passkey path and the MetaMask plugin:** none can be seen without an account.
- **"Kimi breaks ties":** I couldn't observe a council round signed out.
- **The deployed executor version is `…-dirty`:** it was built from an uncommitted tree, so the repo may not match what is running.

## Broken or confusing steps
- **`/how` step 2 promises "Only the venues you allow — Kuru and Uniswap".** But `/council` says an approved buy on testnet opens a **1x Perpl long**, so the venue story contradicts itself on testnet.
- **The app route `/indexed/recent` is a 404 screen,** even though it appears in the app's public-paths list.
- **`/monad` never finishes loading** (it streams forever, so `networkidle` times out). Users won't notice, but automated checkers will hang.
- **Much of the signed-out tour ends at "Sign in to see this"** (`/council`, `/history`), so the core loop can't be seen without making a passkey.

## Dense or ugly screens
- **Desktop, every page:** the page is 1728px wide in a 1440px viewport. A white radial gradient spills past the right edge and can be scrolled to. The left panel repeats the hero tagline on every route.
- **`/gauntlet`:** a wall of strategy codenames ("B200 Sess 8", "Liq Absorption") with small out-of-sample returns (+0.19% to +2.5%). It's dense and doesn't sell the product.
- **`/monad`:** eight technical cards, each with mixed "Live / Local fork / Awaiting" pills. It's honest, but at 390px it reads like a status page, not a product.

## The reason I'd vote no
The one thing this project fully proves on Monad testnet is a solid Perpl desk with operator revocation. The headline, "a limit the chain enforces", has no tx showing it. The copy says the contracts are verified on Sourcify, and Sourcify has none of them. Four of the "Monad-native" features are fork-only by the app's own labels, and the Envio feed is empty. Claiming ten bounties spreads the work thin, so it reads as overclaimed rather than finished. I'd back it for the **Perpl API** and **Perpl Risk** bounties, and not much else.

## Fixes after round 1 (13 Oct)

- **Sourcify:** the three contracts were exact matches on MonadVision's Sourcify instance only; now they are exact
  matches on public sourcify.dev too, and the copy says both.
- **The cap:** the copy now cites the contract's `DailyCapExceeded(60000000, 50000000)` revert (fork evidence) and
  says what the stop is on testnet.
- **Monad-native:** the copy separates what is live from what runs on the fork, as the app labels them.
- **Envio and Mera:** the copy says what the testnet index holds, and that Privy email remains a second way in.
- **The app:** the explainer's venue line matches the chain (Perpl desk on testnet); the desktop page no longer
  overflows sideways.
