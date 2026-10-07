# 100 features that would make xorr win Metropolis — ranked, then built from the top

Direction (owner, 2026-09-24): build on **Perpl** (perps), **Kuru** (spot CLOB) and **Agora** (AUSD — the Best Mobile
Trading App bounty). Pitch: *an AUSD trading desk your agents run on Monad — spot on Kuru, perps on Perpl, one on-chain
leash, one tap to stop.*

Score = **Impact** (would a judge notice) × **Feasibility** (buildable for real now) × **Fit** (strengthens the pitch),
each 1–5. Status: **BUILT ✓** (run and verified; evidence named) · **PARTIAL** · **TODO** · **SKIPPED** (reason).
Buckets: F functional · S sponsor depth · D design/motion · P production-readiness.

| # | Feature | B | I | F | Fit | Score | Status |
|---|---|---|---|---|---|---|---|
| 1 | **Deployed on Monad testnet** — XorrDelegation(AUSD) + anchor, Sourcify-verified | P | 5 | 5 | 5 | 125 | BUILT ✓ `86f7900` |
| 2 | **Perpl desk on Perpl's own `DelegatedAccount`** — the user owns the Perpl account, xorr's agent key is its operator: can trade, can never withdraw | S | 5 | 4 | 5 | 100 | BUILT ✓ `2c5fde5` — testnet desk `0xa21F…98b5`, account #692 (docs/evidence/prove-perpl-desk-testnet-2026-09-24.txt) |
| 3 | **Agents trade Perpl perps** — MON/BTC/ETH IOC opens and closes from the executor through the desk, tx hash stored with the run | S | 5 | 4 | 5 | 100 | BUILT ✓ `2c5fde5` `9b84ce2` — Long/Close of MON through desk `0x3323…11b8` in the UI; tx stored in `perp_orders` |
| 4 | **AUSD is the app's dollar** on testnet — named on Home and Portfolio; Agora's faucet one tap away | S | 5 | 5 | 4 | 100 | BUILT ✓ `14e8745` — "Cash · AUSD" on Portfolio (testnet); the desk funds in AUSD with Agora's faucet one tap away |
| 5 | **One tap stops perps too** — the kill switch removes the desk operator on-chain beside revoking the grant | F | 5 | 4 | 5 | 100 | BUILT ✓ `9e101cf` — Safety's hold also removes xorr's desk operator on testnet (a second signature), and says if it could not |
| 6 | **Perps screen** — positions with entry, mark, PnL, margin, liquidation price, funding (µ/interval → %) read from the Exchange | S | 5 | 4 | 5 | 100 | BUILT ✓ `9b84ce2` — entry, mark, PnL, deposit, liquidation price with a meter, funding %/interval |
| 7 | **Withdraw from the desk** — owner-only `withdrawCollateral`, AUSD back in the wallet | F | 4 | 5 | 5 | 100 | BUILT ✓ `9b84ce2` — withdrew 149.80 AUSD to the owner on testnet |
| 8 | **The council votes on Monad** — perps and MON proposals; seats read Perpl funding/OI/book, Kuru's book, Chainlink MON/USD | F | 5 | 4 | 5 | 100 | BUILT ✓ `bf8b4f6` — live inputs read on the fork: Uniswap, Kuru, Chainlink MON/ETH/BTC, Perpl funding; testnet rounds trade the desk |
| 9 | **Monad-true surfaces** — welcome line, Sources, the grant notice, Council pills, Markets with MON; no Robinhood/USDG/GMX anywhere | P | 5 | 5 | 4 | 100 | BUILT ✓ `aad59b3` `f92f331` `654f99b` `7414e70` — crawl G5 clean except recorded 1inch fills (see TESTPLAN) |
| 10 | **Kuru spot fills** — MON market orders on Kuru's on-chain book through the delegation (mainnet fork: real resting orders) | S | 5 | 3 | 5 | 75 | BUILT ✓ `e504cd2` — `KuruVenue` adapter; best of Kuru/Uniswap measured through the contract; a sale (`0x8244ec4c…`) and a buy (`0xe8397cea…`) filled on Kuru's book on the fork |
| 11 | **Live Kuru book in the MON ticket** — top levels from Kuru's market-data API, redrawn as blocks land | D | 4 | 4 | 5 | 80 | TODO |
| 12 | **Test MON for gas on testnet** — the executor drips a little MON to a new wallet so a judge can sign | P | 4 | 5 | 4 | 80 | BUILT ✓ `2c5fde5` — `/perps/fund-test`: MON for gas + AUSD (Agora's faucet, else the reserve) |
| 13 | **Hold-to-stop with a visible ring** — the kill switch shows "Hold to stop" and fills as you hold | D | 4 | 5 | 4 | 80 | BUILT ✓ `3d2e6f9` — "Hold to stop all trading", fill as you hold, "Keep holding" on an early release |
| 14 | **Home tells the truth about the grant** — no "NOT GRANTED" after a confirmed grant | P | 4 | 5 | 4 | 80 | BUILT ✓ `57b7b90` — reads the executor's contract when none is pinned; "Stopped" verified for the revoked judge wallet |
| 15 | **`/health` never 503s on a healthy node** — find the probe that times out under load | P | 4 | 4 | 4 | 64 | BUILT ✓ `4b0662c` — the fork's remote reads froze anvil ~2 min (anvil 45 s × 5 retries); bounded to 10 s × 3; charts warm first |
| 16 | **Hedge my MON** — one tap shorts the Perpl MON perp sized to the MON you hold | F | 5 | 3 | 5 | 75 | TODO |
| 17 | **Funding-carry agent** — long MON spot on Kuru + short MON perp on Perpl when funding pays shorts | S | 5 | 3 | 5 | 75 | TODO |
| 18 | **Perpl risk dashboard** — protocol view (OI, long/short skew, funding by market) ↔ wallet view (positions, liq distance) | S | 4 | 4 | 4 | 64 | BUILT ✓ `16c4fcb` — /perpl: OI in dollars, book width, who pays funding per hour, geo-block; wallet side is /perps |
| 19 | **Bounded approvals** — no "No limit" approvals; the grant approves only what the cap can spend | P | 4 | 4 | 4 | 64 | PARTIAL `3d2e6f9` — settlement approval is cap × days; sell-side stays unlimited by design and Safety says what bounds it (contract minOut to the owner) |
| 20 | **Mera passkey sign-in** (Agora's requirement) — PRF → BIP-39 → EVM account; web + Expo | S | 5 | 2 | 5 | 50 | BUILT ✓ (web) `7b64c9e` — PRF → BIP-39 → EVM account on the device; executor session from a signed challenge; bounded signing session; verified with a virtual PRF authenticator. Expo: not built |
| 21 | Per-agent identity keys from PRF namespaces (Mera) | S | 4 | 2 | 4 | 32 | TODO |
| 22 | Encrypted agent memory in Postgres, key from the passkey (Mera) | S | 4 | 2 | 3 | 24 | PARTIAL `d5239c1` — a second PRF key (own salt) encrypts private notes per run, server stores ciphertext only; per-agent memory not built |
| 23 | Liquidation-distance meter on each position — a bar that fills toward the liq price | D | 4 | 4 | 4 | 64 | BUILT ✓ `9b84ce2` — LiqMeter on each Perpl position |
| 24 | Monad block pulse — the block number ticks visibly on the desk (300 ms) | D | 3 | 5 | 4 | 60 | BUILT ✓ `2d6297c` — BlockPulse on the desk: the head each second, a dot that brightens on each block |
| 25 | Council vote reveal — seats resolve one by one, then the tx hash slides in | D | 4 | 4 | 4 | 64 | BUILT ✓ `b405872` — a round convened in the last minute reveals seat by seat, then outcome and tx |
| 26 | Fill confirmation with the explorer link (testnet.monadvision.com) on every agent trade | D | 4 | 5 | 4 | 80 | PARTIAL — Perpl orders link testnet.monadvision.com; spot fills on the fork have no public explorer |
| 27 | Toasts never cover the primary action (the Buy button bug) | P | 3 | 5 | 3 | 45 | TODO |
| 28 | Order ticket in the app's dark theme | D | 3 | 5 | 3 | 45 | TODO |
| 29 | Recurring buy offers only routable assets (no AUSD, no ETH+WETH duplicate) | P | 3 | 5 | 3 | 45 | BUILT ✓ `7414e70` — /market/tradable on Monad drops native MON and AUSD; Send still lists them |
| 30 | Button-in-button hydration error on Portfolio/Watchlist fixed | P | 2 | 5 | 3 | 30 | BUILT ✓ `7f39251` `c286a00` — Row and PositionCard controls sit beside their press |
| 31 | Expected refusals (409) never logged as console errors | P | 2 | 4 | 3 | 24 | TODO |
| 32 | Blank `/history`, `/more`, `/crosscheck` render content or explain | P | 3 | 4 | 3 | 36 | BUILT ✓ `f92f331` — /more goes Home; /crosscheck prices from Uniswap on Monad and says so; /history renders |
| 33 | Positions by symbol (`/position/WETH`) and auto-close routes resolve on Monad | P | 2 | 4 | 3 | 24 | NO CHANGE NEEDED — the 404s were the crawl's bogus ids; a real position id renders (crawl re-pointed) |
| 34 | Agents that exist on Monad — roster names and strategies for MON spot and perps; no stock/earnings/Aave agents | F | 5 | 4 | 5 | 100 | BUILT ✓ `d6d1a12` — Momentum Scout (MON/ETH/BTC Chainlink trend), Earnings Desk (Perpl funding), Yield Keeper (MON daily), Drawdown Guard |
| 35 | Perps limit orders that rest on Perpl's book (post-only) with cancel | S | 4 | 3 | 4 | 48 | TODO |
| 36 | Agent stop-losses on perps, enforced by the executor's stop machinery and closed with CloseLong/CloseShort | F | 4 | 3 | 4 | 48 | TODO |
| 37 | Daily perps notional cap + leverage cap per user, enforced before every order, shown on the grant | F | 5 | 4 | 5 | 100 | TODO |
| 38 | Perpl market list with live mark/funding/OI in Markets ("Perps" tab) | S | 4 | 5 | 4 | 80 | BUILT ✓ `16c4fcb` — Markets' "Perps on Perpl ›" opens the desk on testnet, Perpl live on the fork |
| 39 | Council cites Perpl's order-book imbalance (bid/ask volume) | S | 3 | 3 | 4 | 36 | TODO |
| 40 | Kuru market-data candles for MON charts instead of CoinGecko | S | 3 | 4 | 4 | 48 | TODO |
| 41 | MON price crosscheck (Uniswap / Kuru / Chainlink) shown on the MON asset screen | S | 4 | 5 | 4 | 80 | BUILT ✓ `ce4e112` — MON's asset screen: Uniswap · Kuru · Chainlink and the gap |
| 42 | Price-gap gate: refuse a MON trade when sources disagree past a limit, with the three numbers | F | 4 | 4 | 4 | 64 | BUILT ✓ `d9ff059` — council and manual buys refused past 150 bps from Chainlink or on a stale round, numbers named (WBTC refused at 469 bps on the fork) |
| 43 | AUSD peg line (Chainlink AUSD/USD) beside the balance | S | 3 | 5 | 4 | 60 | BUILT ✓ `665570d` `cbd0dc3` — Portfolio and Home: '1 AUSD = $0.9998 · Chainlink' |
| 44 | Agora supply stat on the AUSD screen (api.agora.finance) | S | 2 | 5 | 3 | 30 | TODO |
| 45 | Envio index of XorrDelegation + desk events driving History | S | 4 | 2 | 3 | 24 | TODO |
| 46 | Chainlink CRE workflow attesting council rounds to the anchor | S | 4 | 2 | 3 | 24 | TODO |
| 47 | Perpl price relay for the mainnet fork (replays Perpl's Chainlink-signed keeper updates) | S | 3 | 3 | 3 | 27 | TODO |
| 48 | Kuru V2 spot on testnet (SpotRouter) so spot also runs on a real network | S | 4 | 2 | 4 | 32 | TODO |
| 49 | Onboarding for perps in three steps: gas → AUSD → open desk | D | 4 | 4 | 5 | 80 | BUILT ✓ `9b84ce2` — Perps setup: gas + AUSD → sign Create → fund and open |
| 50 | Desk status chip: "Agent can trade · can't withdraw" read live from `isOperator` | D | 4 | 5 | 5 | 100 | BUILT ✓ `9b84ce2` — "Agent can trade · can't withdraw" read from `isOperator` |
| 51 | Position PnL pulses green/red on each mark update | D | 3 | 4 | 3 | 36 | TODO |
| 52 | Haptic tick on fills (native) | D | 2 | 4 | 3 | 24 | TODO |
| 53 | Skeleton loaders instead of spinners on Perps and Markets | D | 2 | 4 | 3 | 24 | TODO |
| 54 | Empty states that say what to do next (no desk, no positions, no AUSD) | P | 3 | 5 | 4 | 60 | TODO |
| 55 | Perpl down / geo-blocked → a named refusal, not a spinner | P | 3 | 4 | 4 | 48 | TODO |
| 56 | Gas limits set from estimates on Monad (billed on the limit) for every signed tx | P | 3 | 4 | 4 | 48 | TODO |
| 57 | Network screen shows both deployments (testnet contracts with explorer links) | P | 3 | 5 | 4 | 60 | TODO |
| 58 | README deployment table filled with testnet addresses + verification links | P | 4 | 5 | 5 | 100 | BUILT ✓ `5b0ed37` |
| 59 | Hosted demo (Vercel + Railway) | P | 5 | 3 | 5 | 75 | TODO |
| 60 | Crawl test of every screen in CI | P | 3 | 4 | 3 | 36 | TODO |
| 61 | Demo video ≤ 3 min | P | 5 | 3 | 5 | 75 | PARTIAL `183a12a` — a 2:59 recording of the real app with captions (`docs/demo/xorr-monad-demo.mp4`); voice-over and publishing are the owner's |
| 62 | Explain-this-trade: each agent perp run explains the seat votes and funding it used | F | 3 | 4 | 4 | 48 | TODO |
| 63 | "Why can't my agent withdraw?" sheet linking Perpl's DelegatedAccount source | D | 3 | 5 | 4 | 60 | TODO |
| 64 | Operator key rotation (resign + add) without redeploying the desk | F | 2 | 4 | 3 | 24 | TODO |
| 65 | Per-agent leverage limits in the roster | F | 3 | 4 | 4 | 48 | TODO |
| 66 | Close-all perps (flatten) in one tap | F | 4 | 4 | 4 | 64 | TODO |
| 67 | Isolated-margin top-up (`increasePositionCollateral`) when liq distance < X% | F | 4 | 3 | 4 | 48 | TODO |
| 68 | Funding paid/received history per position | F | 3 | 3 | 3 | 27 | TODO |
| 69 | Perp fees shown before the order (taker fee from `getTakerFee`) | P | 3 | 5 | 4 | 60 | TODO |
| 70 | Slippage limit on perps (IOC limit = ask × (1+tol)) shown in the ticket | P | 3 | 5 | 4 | 60 | TODO |
| 71 | Kuru `getL2Book` depth gate before spot orders | S | 3 | 3 | 4 | 36 | TODO |
| 72 | KuruFlow best-route comparison vs direct book | S | 3 | 3 | 3 | 27 | TODO |
| 73 | Kuru AMM vault for idle AUSD/USDC | S | 3 | 2 | 3 | 18 | TODO |
| 74 | AUSD permit (EIP-2612) for one-signature desk funding | S | 3 | 3 | 4 | 36 | TODO |
| 75 | AUSD EIP-3009 gasless transfer to the desk (executor submits) | S | 3 | 3 | 4 | 36 | TODO |
| 76 | Share a trade card (image) of an agent's fill | D | 3 | 3 | 3 | 27 | TODO |
| 77 | Leaderboard of agents by realised perps PnL | F | 3 | 3 | 3 | 27 | TODO |
| 78 | Watch a public Perpl wallet (read-only positions) | F | 2 | 4 | 3 | 24 | TODO |
| 79 | Price alerts on Perpl marks | F | 2 | 4 | 3 | 24 | TODO |
| 80 | Nansen smart-money seat (x402 in Monad USDC) | S | 3 | 2 | 3 | 18 | SKIPPED unless time — thin Monad data |
| 81 | MetaMask Agent Wallet plugin exposing the desk | S | 3 | 2 | 2 | 12 | TODO (last) |
| 82 | Mera EIP-7702 batched setup | S | 3 | 1 | 3 | 9 | TODO |
| 83 | Dark/light parity audit across screens | D | 2 | 3 | 2 | 12 | TODO |
| 84 | Reduced-motion respect for every new animation | P | 2 | 5 | 3 | 30 | TODO |
| 85 | Accessibility labels on the perps controls | P | 2 | 5 | 3 | 30 | TODO |
| 86 | Number formatting for tiny MON prices ($0.02412 — 5 dp) everywhere | P | 3 | 5 | 4 | 60 | BUILT ✓ `aad59b3` — price() gives 5 dp for $0.01–0.1, 6 below |
| 87 | Stale-price label when Perpl's mark is older than 60 s | P | 3 | 4 | 4 | 48 | BUILT ✓ `028d74c` — 'Updated 3s ago' per market, warning ink past 60 s |
| 88 | Audit trail rows for desk actions (open, operator added/removed, withdraw) | P | 4 | 4 | 4 | 64 | TODO |
| 89 | Anchor the audit chain on Monad testnet from the executor | F | 3 | 4 | 4 | 48 | TODO |
| 90 | Session restore after refresh mid-desk-setup | P | 3 | 3 | 3 | 27 | TODO |
| 91 | Remove the Base-era onboarding proposal sleeves | P | 2 | 5 | 3 | 30 | BUILT ✓ `f92f331` — Monad sleeves: WETH+WBTC, WMON, cash in the settlement dollar |
| 92 | Sign-out clears desk state; sign-in restores from chain | P | 2 | 4 | 3 | 24 | TODO |
| 93 | Kuru MON/AUSD vault quote shown with its gap to MON/USDC (honest note) | S | 2 | 4 | 3 | 24 | TODO |
| 94 | xStock Chainlink feeds on Monad (if tokens trade) | S | 3 | 1 | 3 | 9 | SKIPPED — token contracts not located |
| 95 | Aurora intents deposit from any chain | S | 2 | 1 | 2 | 4 | SKIPPED — not a target sponsor |
| 96 | Chainlink CCIP deposit | S | 2 | 1 | 2 | 4 | SKIPPED — no demo value vs cost |
| 97 | Voice briefing of the desk | D | 1 | 2 | 1 | 2 | SKIPPED — clutter |
| 98 | Social copy-trading | F | 2 | 1 | 1 | 2 | SKIPPED — off-pitch |
| 99 | Tokenized stocks on Monad | F | 3 | 1 | 2 | 6 | SKIPPED — not tradable here |
| 100 | Dynamic/Privy dual auth | S | 1 | 2 | 1 | 2 | SKIPPED — conflicts with Mera |

Build order: by score, with dependencies first (desk → trades → screen → stop), and the Monad-true fixes early because
every demo screen depends on them.
