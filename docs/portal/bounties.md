### Best use of Perpl's API   (Perpl)
**Video of the bot/automation with real on-chain activity (required, ≤ 2:00)**
docs/demo/bounty-perpl.mp4 → upload, paste the link
**Link to the bot/automation**
https://xorr-metropolis.vercel.app/perps — the agent desk (sign in with a passkey). Code: https://github.com/nickthelegend/xorr-metropolis/blob/main/server/src/monad/perpl-desk.ts · article: https://github.com/nickthelegend/xorr-metropolis/blob/main/docs/PERPL.md

**What we did**
- Agents trade Perpl through each owner's own DelegatedAccount (the desk), created from the owner's signature with xorr's per-owner operator key: the agent can place orders, never withdraw.
- Caps are checked before signing (per order, per day, leverage); orders are IOC, priced from Perpl's on-chain book and simulated before sending.
- An exit guard checks every position every 30 s: near liquidation, at a stop-loss or take-profit, or when a loser pays too much funding.
- The council (four desks plus Kimi) votes on each trade, and an approved round fills through the desk.
- One hold removes xorr's operator on chain; any order after that reverts.

**Evidence (Monad testnet, https://testnet.monadvision.com/tx/…)**
- Exit guard close: 0x54a880a1620e74216b3f782b57426988ce48b53b1e3d0cfcc284fd28c53e3ee4
- CloseLong via desk: 0x1d530ae29ffc2b64798851d832826ba017ffb280852a6b254a5456f3e50e6e4f
- removeOperator (the stop): 0x6babda2cd2223fff91024027e3bc60c8fd72962185a87f8c7e90e9bf1bfd367e · order after the stop reverts: 0xd9e94a3d06845f125326ae206bc63720b067d866767dd6067925c7286365aaac
- Council fill, round 11 (team-seeded, labelled): 0x47e37f0c1702d8d5ca5351a61a3814966bd636b225cd7e09e80f23b43baea21e
- Full log: docs/evidence/prove-perpl-desk-testnet-2026-10-13.txt, docs/evidence/seed-13oct.md

### Best Analytics / Risk Tool   (Perpl)
**Link to the real-time Perpl dashboard (protocol + wallet views)**
https://xorr-metropolis.vercel.app/perpl — protocol view open to anyone; the wallet view (your desk's positions) appears when signed in.
**Video walking through it (required, ≤ 2:00)**
docs/demo/bounty-perpl-risk.mp4 → upload, paste the link

**What we did**
- Protocol view: every Perpl market, read live — funding paid by longs or shorts and its yearly pace, price move, open interest, spread and staleness, with alerts for what deserves a look.
- Wallet view: your desk's positions read from the chain — distance to liquidation, margin drawn, and the funding each pays now; the same alerts apply to your positions.
- The same readings feed the council's Perps desk, so the dashboard is what the agents act on.
- Code: server/src/monad/perpl-risk.ts, app/perpl.tsx, src/data/perplRisk.ts.

**Evidence**
- Live: https://xorr-metropolis.vercel.app/perpl (Perpl testnet, where the desks trade).
- The positions it reads are the desks above (txs under "Best use of Perpl's API").

### Best Mobile Trading App   (Agora Onchain Trading)
**Describe the core features**
xorr is a mobile-first trading app (one Expo / React Native codebase, served mobile-first in the browser) where a council of AI agents trades for you inside a limit you sign. Sign in with a Mera passkey: no seed phrase, nothing that can sign is stored. AUSD is the settlement token on Monad testnet: the XorrDelegation permission is denominated in AUSD, AUSD is the margin of your Perpl desk, and the app shows your AUSD balance with its peg read from Chainlink. You trade Perpl perps through a desk the agent can trade but never withdraw from, with exits every 30 s; every trade is voted on by the council and shown beside its transaction; one hold stops everything on chain. Native passkeys are built but not yet shipped to a device: the app is shown at phone width in a browser.
**Video: passkey login → AUSD balance → at least one trade on Perpl (required, ≤ 2:00)**
docs/demo/bounty-agora.mp4 → upload, paste the link

**What we did**
- Passkey account (Mera), then AUSD into the Perpl desk and a long on Perpl, all in the app.
- AUSD as settlement and margin; the peg is read from Chainlink.
- The desk and its AUSD on Monad testnet, with txs.

**Evidence (Monad testnet)**
- AUSD to a desk and createAccount(150 AUSD), round-11 wallet (team-seeded): 0x3300985b08c86a8f21765e1d0d06e549e7e40f3a5fb06c6107ad686913af0a10, 0x0fdda18bb741680b085ffa4ebf21b5f03529fdeeae38f75a8478135a86384efd
- Its Perpl trade: 0x47e37f0c1702d8d5ca5351a61a3814966bd636b225cd7e09e80f23b43baea21e
- Article: https://github.com/nickthelegend/xorr-metropolis/blob/main/docs/AGORA.md
- The video's signed-in footage (passkey → AUSD → Perpl long) is recorded on a local fork of Monad mainnet and tagged so on screen.

### Best workflow with CRE   (Chainlink)
**Describe how CRE is used as an orchestration layer**
cre/mon-price is a CRE workflow that gathers MON/USD from several sources, checks their spread and their gap to Chainlink's own feed, and writes one report (price, sources, spread, gap, and a halt flag) to XorrPriceReceiver on Monad testnet through CRE's forwarder. xorr's executor and the council's Price desk read that receiver: a stale or halted report makes the Price desk veto, so nothing trades on a price the workflow did not vouch for. On 13 Oct the stored report aged past its heartbeat and the Price desk vetoed the MON rounds — the gate working. The report on chain was written by `cre workflow simulate … --broadcast` through CRE's simulation forwarder; the workflow is not yet deployed on a schedule.
**Video of a CRE CLI simulation or live deployment (required, ≤ 2:00)**
docs/demo/bounty-cre.mp4 → upload, paste the link

**What we did**
- Workflow: cre/mon-price (TypeScript, compiled to WASM), with its tests.
- Receiver: XorrPriceReceiver 0x5309e806fA530426c0ad72F22D15E473F9b7aD42, exact match on Sourcify.
- The council's Price desk gates on it (server/src/council/monad-inputs.ts).

**Evidence**
- Report tx: https://testnet.monadvision.com/tx/0x0a228a1365c0873ca5c5f8d02b96fb818bd809a4ede68f3a1fb4977fe49fc101
- Article: https://github.com/nickthelegend/xorr-metropolis/blob/main/docs/CHAINLINK-CRE.md

### Best Builds Powered by KIMI   (Kimi)
**Published article describing how KIMI was used and what value KIMI brought to the project**
https://xorr-metropolis.vercel.app/blog/kimi

**What we did**
- Kimi (kimi-k2.6) holds the council's fifth seat, the Strategist: it weighs the four desks and casts a real vote that settles split rounds, with a reason the owner reads.
- It cannot veto or invent a number; its JSON answer is validated field by field.
- A $10 budget on a public app: a 30-minute cache, no call on vetoed rounds, a daily cap persisted in Postgres, failing closed.

**Evidence**
- Round 11 (team-seeded): Kimi voted yes with its reason; fill 0x47e37f0c1702d8d5ca5351a61a3814966bd636b225cd7e09e80f23b43baea21e
- Also in the repo: https://github.com/nickthelegend/xorr-metropolis/blob/main/docs/articles/kimi.md

### Best Mera-Powered UX on Monad   (Mera)
**Describe Mera as the entire account layer**
Mera passkeys are xorr's account layer: sign-up is one passkey (no email, no seed phrase), the wallet key comes from the passkey, and nothing that can sign is stored. A Mera signing session lets the app sign the permission and trades without wallet popups. The stateless test: wipe the browser's storage, sign in with the passkey alone, and the same account comes back. The passkey's own signature is also checked by Monad's P256 precompile on /monad. Honest note: Privy sign-in remains as a second, optional way in. Code: src/auth/mera/. Article: https://github.com/nickthelegend/xorr-metropolis/blob/main/docs/MERA.md
**Video focused on UX (optional, ≤ 2:00)**
— (the demo and walkthrough videos show sign-up and the stateless test, on a local fork of Monad mainnet)

### Mera: One Passkey, Many Keys   (Mera)
**Describe Mera used in non-account work (PRF namespace)**
The same passkey derives a second key through its PRF extension in a separate namespace, and that key seals private notes on trades: the server stores only ciphertext and cannot read them. The passkey also signs a challenge that Monad's P256 precompile (0x0100) verifies on /monad — on mainnet and on the executor's own chain — and refuses the tampered message. Article: https://github.com/nickthelegend/xorr-metropolis/blob/main/docs/MERA.md
**Video (optional, ≤ 2:00)**
—

### Best Use of Envio   (Envio)
**Describe how HyperIndex/HyperSync/HyperRPC powers real data driving a feature**
An Envio HyperIndex indexer (indexer/, config.testnet.yaml) runs on Railway over HyperSync on Monad testnet. It indexes XorrDelegation grants, spends and revocations, Perpl desks as they are created, and audit anchors, and that index drives the app's History screen ("On chain, indexed by Envio": spend against the cap, desks, fills), the latest fills shown on an empty History or Runs screen, and the Envio row on /monad ("indexed to block …"). Spot fills are indexed on the mainnet fork (testnet has no spot venue). Article: https://github.com/nickthelegend/xorr-metropolis/blob/main/docs/ENVIO.md
**Video of data flowing end to end (optional, ≤ 2:00)**
— (the demo video's History step shows it, on the fork)

### Build the Next Consumer Trading App on Kuru   (Kuru)
**(1) Target user segments**
People holding MON and USDC on Monad who want a rule run for them without handing over a key; small-ticket traders ($10 to a few thousand dollars an order), where Kuru's book beat Uniswap in our mainnet measurement; and people new to on-chain trading on a phone (passkeys, every vote beside its transaction). Not for market makers or single orders in the tens of thousands, which xorr routes to Uniswap when Uniswap delivers more.
**(2) Case studies or research showing demand**
Measured, not invented: server/src/kuru-vs-uniswap.ts read both venues on Monad mainnet twice, 33 s apart (docs/evidence/kuru-vs-uniswap-mainnet-2026-10-05.txt). Kuru delivered more at $10–$100 in both runs (+2 to +9 bps), the better venue flipped within a minute at $1k–$5k, and Uniswap won by ~1% at $20k. So an app that measures every order beats one that hard-codes a venue. In our recorded run on a fork of Monad mainnet, a $20 buy filled on Kuru 0.31% better than Uniswap, executed in 510 ms. xorr has not launched, so we cite no user numbers.
**(3) Roadmap beyond the hackathon**
Deploy KuruVenue on mainnet and run first real fills with small funds; Kuru spot on testnet once test tokens exist; agents as makers (resting limit orders on Kuru's book for DCA and take-profit); MON/AUSD and KuruFlow pairs; the Expo app with passkeys on device.
**(4) Trader onboarding and retention strategy**
Onboarding: one passkey, test funds, one signed limit, under a minute. Retention: every fill reports itself with the council's reasons and the venue that won; the cap renews daily; alerts only for fills, refusals and revocations; leaving is one hold, so staying is a choice. Measured from the first mainnet fills: 7- and 30-day active agents, fills per wallet per week, Kuru's win share and dollars saved. Article: https://github.com/nickthelegend/xorr-metropolis/blob/main/docs/KURU.md

### Not claimed
- Best Agent Wallet Plugin (MetaMask): mm-plugin-perpl builds and its tests pass, but its trading commands have not run in a signed-in agent wallet and there is no skills/<name>/SKILL.md, so we don't claim it.
- Privy (it is only a second sign-in), Agora Payments, Kuru new assets, Cleanverse, Nansen, Qwen, Hunyuan: not built. Best Community Team Project: [user decides].
