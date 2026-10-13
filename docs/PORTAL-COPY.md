# Portal copy — paste-ready for hackathon.monad.xyz (13 Oct 2026)

**Project name:** xorr

**Tagline (≤ 80):** A council of AI agents trades for you on Monad, and one hold stops it on chain

**Short description (≤ 280):**
xorr lets a council of AI agents trade for you on Monad. Four desks read Chainlink, Kuru, Uniswap and Perpl funding and vote
on every trade, inside limits you set; one hold stops everything on chain. Passkey accounts (Mera), perps on Perpl.

**Full description:**
- **Problem.** Nobody can watch a market all night, and handing a bot your keys means trusting it with everything.
- **Solution.** You sign one permission with a passkey: a daily limit, an end date, the venues. A council of agents
  votes on every trade on Monad's own numbers — Chainlink on Monad, Kuru's order book, Uniswap, Perpl funding — and
  Kimi breaks ties. Every vote is kept beside the transaction it produced and can be replayed seat by seat. The contract
  refuses anything past the limit, perps run through Perpl's own DelegatedAccount (the agent can trade, never withdraw),
  and one hold revokes everything on chain.
- **Why Monad.** 300 ms blocks, final in ~600 ms: the council can deliberate and still fill at the price it voted on.
  xorr uses Monad itself, not just the EVM. **Live:** commit states from `monadNewHeads`, the passkey checked by the P256
  precompile `0x0100`, staking reads at `0x1000`, `txpool_statusByHash`, the x402 paywall (a 402 from Monad's
  facilitator). **On the fork / at settlement:** receipts with the send (`eth_sendRawTransactionSync`), gas billed on the
  declared limit (10% head-room, the 10 MON reserve). The app's Built on Monad screen labels each one.
- **What's live.** https://xorr-metropolis.vercel.app on Monad testnet (executor on Railway, Envio indexer on
  HyperSync), the CRE receiver with a broadcast report, and the Perpl desk proven end to end on 13 Oct.

**Track:** 01 — Onchain Finance & Trading

**Repo:** https://github.com/nickthelegend/xorr-metropolis (MIT) · **Live:** https://xorr-metropolis.vercel.app
· **Demo video:** `docs/demo/xorr-demo.mp4` (2:56) · **Pitch:** `docs/demo/xorr-pitch.mp4` (1:33) · **Full walkthrough:** `docs/demo/xorr-walkthrough.mp4` (4:32); captions as `.srt` beside each

**Contracts (Monad testnet, 10143):**
All three are exact matches on public Sourcify (https://repo.sourcify.dev/10143/<address>) and on MonadVision's Sourcify.
- XorrDelegation — https://testnet.monadvision.com/address/0x5995925de0169574365cc7f6b65f765275b0bd4b
- XorrAuditAnchor — https://testnet.monadvision.com/address/0x5a717b204c77bfba8805ffe1f382b074a3d26203
- XorrPriceReceiver (CRE) — https://testnet.monadvision.com/address/0x5309e806fA530426c0ad72F22D15E473F9b7aD42

**The limit, enforced by the contract:** a spend over the day's cap is mined as a revert —
`DailyCapExceeded(60000000, 50000000)` on a fork of Monad mainnet (`docs/evidence/prove-monad-fork-2026-09-24-final.txt`),
and `forge test` covers the cap, the end date and the venue list. On testnet the agents trade perps through Perpl's own
desk, where removing the operator is the stop (tx 2 below).

**Best 3 transactions:**
1. Perpl exit guard closes a position on its own — https://testnet.monadvision.com/tx/0x54a880a1620e74216b3f782b57426988ce48b53b1e3d0cfcc284fd28c53e3ee4
2. Owner removes the operator; a raw order after it reverts — https://testnet.monadvision.com/tx/0x6babda2cd2223fff91024027e3bc60c8fd72962185a87f8c7e90e9bf1bfd367e · https://testnet.monadvision.com/tx/0xd9e94a3d06845f125326ae206bc63720b067d866767dd6067925c7286365aaac
3. CRE workflow report (MON/USD) — https://testnet.monadvision.com/tx/0x0a228a1365c0873ca5c5f8d02b96fb818bd809a4ede68f3a1fb4977fe49fc101

## Bounties

| Bounty | Required fields, answered |
|---|---|
| **Agora — Best Mobile Trading App** | Auth: Mera passkeys (`src/auth/mera/`). AUSD balance: Home, Perps and Deposit, with its Chainlink peg. Perpl trade: through the desk (`server/src/monad/perpl-desk.ts`); txs above. Mobile: Expo app (`finance.xorr.app`); shown in a phone browser, native passkey path built. |
| **Perpl — Best use of the API** | A trading bot on Perpl: caps checked before signing, standing exits every 30 s, orders priced from the on-chain book, per-owner operator keys, one-hold stop. Proof: `docs/evidence/prove-perpl-desk-testnet-2026-10-13.txt`. |
| **Perpl — Best Analytics / Risk Tool** | `/perpl`: every market's funding (paid by longs, APR), price move, open interest, spread, staleness. Code: `server/src/monad/perpl-risk.ts`. |
| **Kuru — Next Consumer Trading App** | Every spot order measures Kuru's book against Uniswap v3 and fills on the better (`contracts/src/KuruVenue.sol`, `docs/KURU.md`); proven on a fork of Monad mainnet (testnet has no Kuru spot market). |
| **MetaMask — Best Agent Wallet Plugin** | `mm-plugin-perpl/`: Perpl markets, risk, account, open and close for the MetaMask Agent Wallet (mm 7). |
| **Mera — Best Mera-Powered UX** | Mera passkeys are the account layer: passkey sign-up, a signing session (no popups), the stateless test (wipe storage, same account). Privy email sign-in remains as a second way in. |
| **Mera — One Passkey, Many Keys** | A second PRF key seals private notes; the passkey's own signature checked by Monad's P256 precompile (`/monad`). |
| **Chainlink — Best workflow with CRE** | `cre/mon-price`: a workflow that writes MON/USD (and a halt) to `XorrPriceReceiver`; the council's price desk reads it. Broadcast tx above. |
| **Envio — Best Use of Envio** | HyperIndex powers History (`indexer/`): grants, revocations, Perpl desks and audit anchors, hosted on Railway with HyperSync on Monad testnet. Spot fills (`/indexed/recent`) are indexed on the mainnet fork; testnet has no spot venue, so that feed is empty there. |
| **Kimi** | Kimi sits on the council as the Strategist (`server/src/council/strategist.ts`), weighs the desks and breaks ties; cached, capped per day. |

**Team:** nickthelegend. **Pre-existing code:** yes — earlier xorr builds (Base, Solana, X Layer, Arbitrum); the Monad
work is listed in README → "Disclosures". **AI tools:** Claude Code (Anthropic), credited as co-author on its commits.
