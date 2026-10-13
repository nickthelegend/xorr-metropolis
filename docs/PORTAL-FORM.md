# Portal form: hackathon.monad.xyz → "Complete your entry"

The fields are in the portal's order, each within its limit, ready to paste. Lines marked **[user fills in]** are yours.

The portal wants video *links*. Upload the MP4s to YouTube or Loom (unlisted is fine) and paste the links into fields 9,
10 and 13.

---

## 1. Primary track

01 — Onchain Finance & Trading

## 2. Logo

`docs/brand/logo-portal.png`: 1254×1254 PNG, 382 KB.

## 3. Project name (≤ 120)

xorr

## 4. Tagline (≤ 200)

A council of AI agents trades for you on Monad, inside a limit you sign and the chain enforces, and one hold stops it on chain.

## 5. Description (≤ 8,000)

PROBLEM
Trading bots ask for a lot of trust. Most want your keys, or a balance they can move however they like, and when one goes wrong there is no brake. Nobody can watch a market all night, but handing an agent everything is the wrong answer.

SOLUTION
xorr lets a council of AI agents trade crypto and perps for you without ever holding your money.
- You sign up with one passkey (Mera): no seed phrase, and nothing that can sign is stored.
- You sign one permission: a daily limit, an end date and the venues. The XorrDelegation contract refuses anything past it.
- Every trade is put to a council of five seats that vote on Monad's own numbers:
  - Price: Chainlink on Monad against Kuru's order book;
  - Risk: your limit;
  - Trend: price history;
  - Perps: Perpl funding;
  - Kimi (Moonshot): weighs the four and explains its vote.
- Every vote is kept beside the transaction it produced and can be replayed seat by seat.
- Spot buys measure Kuru's on-chain book against Uniswap v3 and fill on the better one.
- Perps run on Perpl through Perpl's own DelegatedAccount: the agent can trade it, never withdraw, with standing exits every 30 seconds.
- One hold stops everything: the permission is revoked and the desk's operator removed, on chain, and the app reads both back from the chain.

WHY MONAD
A council has to deliberate and still fill at the price it voted on. On Monad, a block is final in about half a second; the app's live reading shows voted in ~300 ms and final in ~560–580 ms. A send returns its receipt (eth_sendRawTransactionSync), so in our recorded run a council round went from vote to fill in 0.2 s, and a routed buy executed in 510 ms for $0.0011 of gas.

xorr uses Monad itself, and the in-app "Built on Monad" screen reads each item live and says where it runs:
- commit states from monadNewHeads;
- the passkey's signature checked by the P256 precompile at 0x0100;
- native staking at 0x1000;
- txpool_statusByHash;
- gas billed on the declared limit;
- an x402 paywall for other agents buying the council's read.

WHAT'S LIVE (Monad testnet, 10143)
- App: https://xorr-metropolis.vercel.app. The executor runs on Railway, and an Envio HyperIndex indexer runs over HyperSync.
- Three contracts, exact match on Sourcify:
  - XorrDelegation: 0x5995925de0169574365cc7f6b65f765275b0bd4b
  - XorrAuditAnchor: 0x5a717b204c77bfba8805ffe1f382b074a3d26203
  - XorrPriceReceiver (Chainlink CRE): 0x5309e806fA530426c0ad72F22D15E473F9b7aD42
- The Perpl desk was proven end to end on testnet on 13 Oct: open, exit guard, close, operator removal, and a raw order reverting after the stop.
- A Chainlink CRE report writes MON/USD on chain.
- TEAM-SEEDED ACTIVITY, labelled as such: on 13 Oct we created four team wallets ourselves. Each signed a Perpl desk permission and had council rounds convened.
  - Rounds 8–11 were approved and filled on Perpl.
  - Rounds 1–7 were vetoed, while the public RPC rate-limited reads and testnet's MON feed was stale. We kept them in the record.
  - The team-seeded rounds are viewable without signing in at /council/sample, and are labelled "team-seeded" in the app.
  - Every transaction is in docs/evidence/seed-13oct.md.

WHAT RUNS WHERE
Kuru and Uniswap spot markets exist only on Monad mainnet, not testnet. The full signed-in journey in the demo video (passkey, permission, Kuru vs Uniswap routing, council, Perpl desk, Envio History, the stop) is therefore recorded on a local fork of Monad mainnet, and tagged that way on screen. The testnet part of the video shows team-seeded round 11 and its fill.

## 6. First users, and how we reach them (≤ 8,000)

FIRST USERS
- People who already trade crypto and perps and want an agent to do it overnight, but won't hand a bot their keys or an unbounded balance.
- Perpl traders who want standing exits and a bot they can stop in one hold.
- Monad testnet users who want a mobile-first way to trade with a limit they can see and revoke.

HOW WE REACH THEM
- Monad's testnet community: the app runs in any browser with a passkey and no install, and test funds come from xorr's own faucet.
- Shareable council replays: any round can be opened by link without signing in, so a single trade's reasoning, votes and transaction can be posted on X and in Monad and Perpl community channels.
- Perpl's and Kuru's communities: xorr routes order flow to Kuru's book and trades through Perpl's own desk contract, so their users get a safer agent on venues they already use.
- The MetaMask Agent Wallet plugin (mm-plugin-perpl) brings Perpl markets, risk, and open/close to agent-wallet users.
- Next: invite a small group of testnet users, watch where they stop, and add more Monad venues for the council to route to.

## 7. Repo URL

https://github.com/nickthelegend/xorr-metropolis

## 8. Live app URL (Monad testnet)

https://xorr-metropolis.vercel.app

## 9. Demo video (≤ 3:00)

- **Upload:** `/Volumes/Extreme SSD/Projects/xorr-metropolis/docs/demo/xorr-demo.mp4` (2:56, 1080p, captions in `xorr-demo.srt`).
- **What it shows:** the working product only, with no slides and no code. The full real flow plays with fast-forward chips on waits, then live testnet round 11 and its fill.
- **Link:** [user fills in, after uploading]

## 10. Pitch video (≤ 2:00)

- **Upload:** `/Volumes/Extreme SSD/Projects/xorr-metropolis/docs/demo/xorr-pitch.mp4` (1:24, captions in `xorr-pitch.srt`).
- **What it covers:** the hook, who we are (no names), the problem, why now, the product in three verbs (hire, limit, stop), one card of facts verifiable on Monad testnet, who it's for and how we reach them, and a close.
- **Style:** kinetic type over the brand's art, with one 4-second glimpse of the app.
- **Link:** [user fills in, after uploading]

Team: [user fills in]

## 11. Testing instructions for judges (≤ 8,000)

NO LOGIN NEEDED (start here)
1. Open https://xorr-metropolis.vercel.app (Monad testnet, chain 10143). It works in any desktop or phone browser.
2. "For judges: each bounty, and where it is met" on the Welcome screen (/judges) maps every bounty to its screen and evidence.
3. /monad, "Built on Monad": Monad mainnet's blocks going Proposed → Voted → Final live, plus txpool, P256, staking, gas and x402. Each row says where it runs.
4. /council/sample: a team-seeded council round (labelled), replayed seat by seat with what each desk read, then the verdict and the transaction.
5. /gauntlet: 313 strategies backtested, and the 10 that survived out-of-sample tests.

THE FULL FLOW (needs a passkey; about 3 minutes)
1. Welcome → Get started → Create my account → Create a passkey. Chrome with Google Password Manager works best (PRF support).
2. Continue → Get test funds: xorr's faucet sends test AUSD and gas.
3. Continue → set the limits → Sign this permission: a daily limit and an end date, with no wallet popup.
4. Home → Perps → Open my Perpl desk → Long MON ($50, 2x). Watch the position, its liquidation distance and its standing exits.
5. Home → Council → Put $50 to the council. Watch the vote chips, then tap Replay.
6. Safety → hold "Hold to stop all trading": the permission is revoked and the desk operator removed, on chain.

NOTES AND CAPS
- Kuru and Uniswap spot routing is mainnet-only, so it is shown on a local fork of Monad mainnet in the demo video. Testnet has no Kuru spot market.
- Kimi (the Strategist seat) is capped at 30 calls a day and cached for 30 minutes per proposal. When the cap is reached, the four desks decide and the round says so.
- If "Get test funds" is slow, Agora's AUSD faucet is rate-limiting; wait 30 s and tap again.
- The public Monad testnet RPC answers 15 requests a second, and reads fall back to other public testnet RPCs.
- A round can vote no or veto: the council is the brake as well as the trigger.
- Evidence and transaction hashes:
  - docs/evidence/seed-13oct.md
  - docs/evidence/prove-perpl-desk-testnet-2026-10-13.txt
  - docs/SPONSOR-COVERAGE.md

## 12. Bounties

Testnet explorer base: https://testnet.monadvision.com/tx/

### Perpl: Best use of the API

- **What:** a trading bot on Perpl. Agents trade through each owner's Perpl DelegatedAccount (the desk), with xorr's per-owner operator key.
- **Safeguards:**
  - caps are checked before signing;
  - orders are priced from the on-chain book (IOC);
  - standing exits run every 30 s: near liquidation, stop-loss or take-profit, or when funding is too expensive;
  - one hold removes the operator.
- **Code:** `server/src/monad/perpl-desk.ts`, `server/src/monad/perpl-chain.ts`
- **Evidence:** `docs/evidence/prove-perpl-desk-testnet-2026-10-13.txt`
- **Txs:**
  - exit guard close: 0x54a880a1620e74216b3f782b57426988ce48b53b1e3d0cfcc284fd28c53e3ee4
  - CloseLong via desk: 0x1d530ae29ffc2b64798851d832826ba017ffb280852a6b254a5456f3e50e6e4f
  - removeOperator: 0x6babda2cd2223fff91024027e3bc60c8fd72962185a87f8c7e90e9bf1bfd367e
  - order after the stop reverts: 0xd9e94a3d06845f125326ae206bc63720b067d866767dd6067925c7286365aaac
  - council fill (round 11, team-seeded): 0x47e37f0c1702d8d5ca5351a61a3814966bd636b225cd7e09e80f23b43baea21e

### Perpl: Best Analytics / Risk Tool

- **What:** /perpl lists every market with:
  - funding paid by longs or shorts, and its yearly pace;
  - price move and open interest;
  - spread and staleness;
  - what deserves a look.
- **Code:** `server/src/monad/perpl-risk.ts`. The demo video shows it at the "Perpl risk" step.

### Agora: Best Mobile Trading App

- **Auth:** Mera passkeys (`src/auth/mera/`).
- **AUSD:** the balance appears on Home, Perps and Deposit, with its Chainlink peg.
- **Perpl trade:** through the desk; txs as above.
- **Mobile:** an Expo app, mobile-first in the browser at phone width; the native passkey path is built.

### Kuru: Next Consumer Trading App

- **What:** every spot order measures Kuru's on-chain order book against Uniswap v3 and fills on the better one. The run shows what routing was worth.
- **Code:** `contracts/src/KuruVenue.sol`, `docs/KURU.md`
- **Where it runs:** proven on a fork of Monad mainnet, because testnet has no Kuru spot market. In the demo video, Kuru beat Uniswap by 0.31% on a $20 buy, executed in 510 ms.

### Mera: Best Mera-Powered UX

- **What:** passkeys are the account layer. You sign up with one passkey, and a signing session means no popups.
- **The stateless test:** wipe browser storage, sign in with the passkey alone, and the same account comes back. It is shown in the walkthrough.

### Mera: One Passkey, Many Keys

- A second PRF-derived key seals private notes.
- The passkey's own signature is verified by Monad's P256 precompile on /monad.

### Chainlink: Best workflow with CRE

- **What:** `cre/mon-price` writes MON/USD (and a halt) to XorrPriceReceiver on Monad testnet.
- **Receiver:** 0x5309e806fA530426c0ad72F22D15E473F9b7aD42
- **Report tx:** 0x0a228a1365c0873ca5c5f8d02b96fb818bd809a4ede68f3a1fb4977fe49fc101

### Envio: Best Use of Envio

- **What:** HyperIndex powers History (`indexer/`): grants, revocations, Perpl desks and audit anchors.
- **Hosting:** Railway, with HyperSync on Monad testnet.
- **Spot fills:** indexed on the mainnet fork, shown in the demo video's History step.

### MetaMask: Best Agent Wallet Plugin

`mm-plugin-perpl/`: Perpl markets, risk, account, and open and close, for the MetaMask Agent Wallet (mm 7).

### Kimi (Moonshot)

- **Published article (required field):** https://github.com/nickthelegend/xorr-metropolis/blob/main/docs/KIMI.md
- **What:** Kimi sits on the council as the Strategist (`server/src/council/strategist.ts`). It weighs the four desks, votes, and explains why.
- **Limits:** cached and capped per day.
- **On testnet:** in team-seeded round 11, Kimi voted yes with its reason on screen. That round's fill is above.

## 13. Optional promo clip (≤ 0:30)

- **Upload:** `/Volumes/Extreme SSD/Projects/xorr-metropolis/docs/demo/xorr-promo.mp4`
- **Link:** [user fills in, after uploading]

## 14. X link

[user fills in]

---

- **Pre-existing code:** yes. There are earlier xorr builds on Base, Solana, X Layer and Arbitrum; the Monad work is listed in README → "Disclosures".
- **AI tools:** Claude Code (Anthropic), credited as co-author on its commits.
