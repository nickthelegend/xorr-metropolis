# A skeptical judge's verdict — xorr on Monad, as it stands on 2026-09-24

Judged against commit `47edeea` on the running stack (anvil fork of Monad mainnet, the executor, the Expo web build),
against **Metropolis' own main-track criteria** — product quality, technical excellence, Monad integration, track fit
(Onchain Finance & Trading), innovation, 20% each — plus the sponsor bounties the project targets and the demo.
Nothing was fixed.

How it was tested: a fresh Privy test account (`test-0356@privy.io`) taken through welcome → goals → sign-in → faucet →
the 4-signature grant → a buy → an over-balance order → the kill switch → an order after the stop → an agent → a
recurring buy, and the Council, Markets, Network and Portfolio screens, with every console error and every API response
captured. Claude in Chrome was used where its tab could render (its window sits behind the Claude app, so the page is
"hidden" and animations never run — 0 animation frames in 1.5 s); the animated flows (Privy's signing sheets, the stop)
were driven in headless Chromium instead, same app, same executor. Every on-chain claim below was read back from the
chain with `cast`.

## Scores

| Category | Score | Why, in one sentence |
|---|---|---|
| Product quality | **5 / 10** | The core loop really works — sign in, faucet, grant, buy, stop — but Home says "NOT GRANTED" after a confirmed grant, the headline agent can do nothing on Monad, and a stale-screen toast covers the Buy button. |
| Technical excellence | **6 / 10** | The permission is enforced by a contract and proven (mined `DailyCapExceeded`, `PolicyRevoked`), with 4,000+ tests and no mocks — but the AI council reads another chain's data and `/health` intermittently 503s after a 5 s probe timeout. |
| Monad integration | **2 / 10** | It runs on a fork of Monad mainnet against real pools, but **nothing is deployed on Monad testnet or mainnet** (the rules require it) and nothing on screen uses anything Monad-specific. |
| Track fit (Onchain Finance & Trading) | **5 / 10** | A capped-permission trading agent is squarely on-track, but on Monad the "trading" a judge can do is one Uniswap swap button and a weekly buy. |
| Innovation | **5 / 10** | "Votes next to the transaction they produced" under an on-chain, revocable cap is a real idea, but judges have seen many agent-trading apps and the council isn't running on this chain. |
| Sponsor tech (targeted bounties) | **1 / 10** | Not one of Agora, Perpl, Kuru, Mera, Chainlink CRE, Envio, Nansen or MetaMask Agent Wallet is visible in the product (`docs/SPONSOR-AUDIT.md`). |
| Presentation / demo | **2 / 10** | No hosted URL, no video, a private repository, and a README whose deployment table reads "pending". |

## What is actually wrong, ranked

### Dealbreakers — would visibly lose the round
1. **Not eligible as submitted.** The rules require deployment on Monad mainnet or testnet with addresses, a public
   open-source repo, and a video ≤ 3 minutes. Today: no Monad deployment (the testnet deployer holds 0 MON), a private
   repo, no video, no hosted app. A judge cannot even open it.
2. **The AI council — the pitch's centrepiece — does not run on Monad.** On this Monad build the Council offers only
   NVDA/TSLA/AAPL/SPY and a live round reported "Chainlink $225.55 (133 min old), pool $225.72" and "ETH longs pay
   0.0008%/h" — Robinhood Chain's feed and pool, and GMX on Arbitrum. *A technical judge would catch this in under a
   minute: the screen says NVDA on a chain with no NVDA pool in this app.*
3. **The agents have nothing to do.** Home leads with Momentum Scout ("Buys the stock with the strongest trend"), Earnings
   Desk and Yield Keeper; opening Momentum Scout says "No strategy to add for Momentum Scout yet." "A bot that trades
   while you get on with your life" has no bot that trades on Monad.
4. **The first screen sells the wrong product.** "Tokenized US stocks, traded by agents…" on a Monad build whose Markets
   list is BTC/ETH/AAVE/LINK — with **MON absent**, the chain's own asset and the only deep pool. The grant screen carries a
   "Stock Tokens are not for US persons" notice for tokens the app doesn't trade.

### Real deductions — would cost meaningful points
5. **Screens contradict the chain.** After four confirmed signatures (`remainingToday` = $1,600 on-chain), Home still
   shows "NOT GRANTED" and an unticked Permit step, even after a reload, while Safety says "Trading is live".
6. **Intermittent `/health` 503s** (executor log: two `GET /health 503 5004ms`) raise a "Back online — screens were out of
   date" toast that sits exactly over the Buy button; the first buy attempt could not be pressed.
7. **Unlimited approvals.** Safety lists WETH and WBTC approvals as "No limit" — a security-minded judge marks that down on
   a product whose pitch is limits.
8. **The kill switch hides its gesture.** A tap on "Stop all trading" does nothing; it needs a press-and-hold with no hint.
   (Once held, it is excellent: Privy sheet → "Trading stopped… CONFIRMED ON-CHAIN 0x919032…a0b474", and the next order is
   refused with "No active trading permission on-chain".)
9. **Sponsor tech is invisible.** Kuru's book, Chainlink MON/USD and Perpl's markets are fetched for real — behind
   `/monad/crosscheck` and `/monad/perpl`, which no screen calls. AUSD held (25 AUSD tested) is counted into the total and
   named nowhere.
10. **Four signatures to grant**, announced as "You'll sign 4 times" — heavy for a mobile-first trading demo.
11. **The recurring-buy asset list** offers AUSD (no route: it can never execute) and both ETH and WETH.

### Polish — only matters in a close call
12. The order ticket is white inside an otherwise black app.
13. An expected refusal (409 after the stop) shows as a red "Failed to load resource" in the console.
14. Dev-build console noise: ~25 styled-components warnings from Privy's modal and a require cycle.
15. The onboarding "proposal" screen (reachable from the strategy ladder) shows Base-era sleeves: "WETH and cbBTC",
   "NVDAc, AAPLc and six more tokenized stocks".
16. Sources screen still describes Robinhood Chain feeds and "the v3 pool against USDG".

## What is genuinely strong (and should be scored that way)
- **No fakery.** Every number traced back to a real source; no mocked responses; fixtures are catalogues, not prices.
- **The permission is real and enforced on-chain.** Faucet → 1,000 USDC on-chain; grant → allowance and a $1,600/day
  policy on-chain; a $250 WETH buy filled (0.0930 WETH in the wallet); the stop revoked on-chain and the executor refused
  afterwards. Few hackathon projects can show a contract refusing their own bot.
- Careful copy and honest error states throughout ("Nothing is granted until the last", "Test funds only").

## The one thing standing between this and winning
**Make it a Monad product, on Monad.** Deploy the contracts on Monad and have the agents and the council trade MON on
Monad's own venues with Monad's own data — today the permission is on a Monad fork but the intelligence, the agents and
the pitch are still on Robinhood Chain.

## Would it place?
**No — as it stands it gets cut in the first pass: it isn't deployed on Monad, isn't public and has no video, and the AI
council it's selling votes on NVDA from another chain.**
