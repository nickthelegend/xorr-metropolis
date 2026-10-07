# Screen review — every screen of xorr, scored (7 Oct)

Every screen of the running app, photographed on the local fork of Monad mainnet with a real account (test funds,
the permission, a $20 buy routed between Kuru and Uniswap, a council round, an open Perpl long) at 390 × 844 and
1440 × 900 — 103 screens, in `docs/screens/<area>/`, by `e2e/web/capture.mjs`. Contact sheets per area are
in `sheets/`, the gallery is `index.html`, and this file is written by `e2e/web/review.py` from the same manifest.

## Rubric

Each screen is scored 1–5 on the whole of: **hierarchy** (the one thing the screen is about is the first thing seen),
**spacing** (the scale, nothing cramped or floating), **type** (roles used for what they mean, numbers tabular), **copy**
(one true sentence, no dead ends, nothing that names another build), **states** (loading, empty and failure each say
what they are), and **mobile fit** (390 px with no sideways scroll; the desktop stage at 1440).

| Score | Means |
|---|---|
| 5 | A hero moment: the screen's point is unmistakable and it has life — light, a figure that matters, motion that answers. |
| 4 | Clean and consistent with the system; nothing wrong a user would notice. |
| 3 | Works, with a visible weakness: a bare empty state, raw data, weak hierarchy. **Polished.** |
| 2 | A defect a user would notice: wrong copy for this account, raw machine values, a dead end, a stuck-looking load. **Polished.** |
| 1 | Broken. (None.) |

## Result

- **First capture of the redesigned app: average 3.91** — 9 at 5 · 80 at 4 · 10 at 3 · 4 at 2.
- **After polishing every screen at 3 or less: average 4.09** — 9 at 5 · 94 at 4. Nothing is left at 3 or below.
- 14 screens polished, each re-captured; before and after are in `polish/<screen>-{before,after}-{mobile,desktop}.png`
  and side by side in `sheets/polished.png`.
- **The redesign itself** (6–7 Oct, the owner's "the UI is stale"): the same 38 screens on the UI before it and today are
  in `sheets/then-and-now.png` and `before/`. Before it, the app scored about 3 on this rubric almost everywhere — flat
  grey cards on black, a white order ticket and a lavender Messages drawer in a black app, no accent, no motion — with the
  Run screen and the theme breaks at 2.

## Polished

| Screen | Before | After | What was wrong | The fix |
|---|---|---|---|---|
| `/history` (a new account, nothing traded yet) | 3 | 4 | Bare empty state. | The shared empty state. |
| `/runs` (a new account, nothing traded yet) | 3 | 4 | Bare empty state. | The shared empty state. |
| `/agent/basket` | 3 | 4 | A paragraph alone at the top of an empty screen. | The shared empty state. |
| `/allocation` (a route this build hides) | 2 | 4 | The page for a hidden route offered "Trade stocks" on Monad, where no stocks are listed — a dead end. | Offers the markets this build has ("See the markets"). |
| `/allowlist` | 3 | 4 | Bare empty state. | The shared empty state. |
| `/approvals` | 2 | 4 | Each unlimited allowance printed as its raw 78-digit uint256, pushing the card’s button down. | Named instead: "2²⁵⁶ − 1 — the most a token can allow"; a limited one still shows its exact value. |
| `/briefing` | 2 | 4 | Skeletons and nothing else for the ~12 s the briefing takes to read the news: it looked stuck. | Says what it is doing while it reads ("Reading what moved and what each agent did…"). |
| `/disposals` | 3 | 4 | One grey sentence alone at the top of a black screen read as half-drawn. | The shared empty state: a lit mark, the sentence, and its action as a pill. |
| `/pnl` | 3 | 4 | Bare empty state. | The shared empty state, with its link as a pill. |
| `/proposals` | 3 | 4 | Bare empty state. | The shared empty state. |
| `/recovery` | 2 | 4 | A passkey account was told "Your email is the way back" and offered a key export with nothing to export. | For a passkey account: "Your passkey is the way back", and why there is nothing to write down. |
| `/risk` | 3 | 4 | Bare empty state. | The shared empty state. |
| `/search` | 3 | 4 | The browser drew its square blue focus box around the rounded field. | A focused field is ringed in the accent, following its corners — on every field in the app. |
| `/venues` | 3 | 4 | Two bare addresses: nothing said which venue was which. | Each venue is named by the executor (Uniswap v3 · SwapRouter02; Kuru · KuruVenue) above its full address. |

## Notes

- **`/bot/<agent>/backtest` is photographed loading.** The replay reads daily closes from CoinGecko, which answered
  429 (rate-limited) to this machine throughout the capture — several projects share its address. The screen's own
  answer to that is a retryable "warming" message after the executor's 12 s budget; the wait now says what it is doing
  ("Replaying the window on real daily closes…"). With CoinGecko answering, it draws the equity curve, as in
  `before/agents/03-bot-momentum-scout-backtest-mobile.png`.
- **The offline states** are the app with every executor request refused by the browser; the console errors those
  refusals log are expected and are the only ones in the run.


## Every screen

### Onboarding

| # | Screen | Score | Phone | Desktop |
|---|---|---|---|---|
| 01 | `/welcome` | 5 | [phone](onboarding/01-welcome-mobile.png) | [desktop](onboarding/01-welcome-desktop.png) |
| 02 | `/wallet` — signed out | 4 | [phone](onboarding/02-wallet-mobile.png) | [desktop](onboarding/02-wallet-desktop.png) |
| 03 | `/wallet` — passkey account made | 4 | [phone](onboarding/03-wallet-created-mobile.png) | [desktop](onboarding/03-wallet-created-desktop.png) |
| 04 | `/fund` | 4 | [phone](onboarding/04-fund-mobile.png) | [desktop](onboarding/04-fund-desktop.png) |
| 05 | `/fund` — test funds arrived | 4 | [phone](onboarding/05-fund-added-mobile.png) | [desktop](onboarding/05-fund-added-desktop.png) |
| 06 | `/delegate` | 4 | [phone](onboarding/06-delegate-mobile.png) | [desktop](onboarding/06-delegate-desktop.png) |
| 07 | `/goals` | 4 | [phone](onboarding/07-goals-mobile.png) | [desktop](onboarding/07-goals-desktop.png) |
| 08 | `/proposal` | 4 | [phone](onboarding/08-proposal-mobile.png) | [desktop](onboarding/08-proposal-desktop.png) |

### Home

| # | Screen | Score | Phone | Desktop |
|---|---|---|---|---|
| 01 | `/` | 5 | [phone](home/01-home-mobile.png) | [desktop](home/01-home-desktop.png) |
| 02 | `/briefing` | 2 → **4** | [phone](home/02-briefing-mobile.png) | [desktop](home/02-briefing-desktop.png) |
| 03 | `/catchup` | 4 | [phone](home/03-catchup-mobile.png) | [desktop](home/03-catchup-desktop.png) |
| 04 | `/explore` | 4 | [phone](home/04-explore-mobile.png) | [desktop](home/04-explore-desktop.png) |
| 05 | `/inbox` | 4 | [phone](home/05-inbox-mobile.png) | [desktop](home/05-inbox-desktop.png) |
| 06 | `/more` | 4 | [phone](home/06-more-mobile.png) | [desktop](home/06-more-desktop.png) |
| 07 | `/notifications` | 4 | [phone](home/07-notifications-mobile.png) | [desktop](home/07-notifications-desktop.png) |
| 08 | `/profile` | 4 | [phone](home/08-profile-mobile.png) | [desktop](home/08-profile-desktop.png) |
| 09 | `/search` | 3 → **4** | [phone](home/09-search-mobile.png) | [desktop](home/09-search-desktop.png) |

### Trade

| # | Screen | Score | Phone | Desktop |
|---|---|---|---|---|
| 01 | `/order/WMON` — $20 entered | 4 | [phone](trade/01-order-ticket-mobile.png) | [desktop](trade/01-order-ticket-desktop.png) |
| 02 | `/asset/MON` | 4 | [phone](trade/02-asset-MON-mobile.png) | [desktop](trade/02-asset-MON-desktop.png) |
| 03 | `/chart/MON` | 4 | [phone](trade/03-chart-MON-mobile.png) | [desktop](trade/03-chart-MON-desktop.png) |
| 04 | `/coverage` | 4 | [phone](trade/04-coverage-mobile.png) | [desktop](trade/04-coverage-desktop.png) |
| 05 | `/crosscheck/MON` | 4 | [phone](trade/05-crosscheck-MON-mobile.png) | [desktop](trade/05-crosscheck-MON-desktop.png) |
| 06 | `/markets` | 4 | [phone](trade/06-markets-mobile.png) | [desktop](trade/06-markets-desktop.png) |
| 07 | `/markets/crypto` | 4 | [phone](trade/07-markets-crypto-mobile.png) | [desktop](trade/07-markets-crypto-desktop.png) |
| 08 | `/order/WMON` | 4 | [phone](trade/08-order-WMON-mobile.png) | [desktop](trade/08-order-WMON-desktop.png) |
| 09 | `/route/MON` | 4 | [phone](trade/09-route-MON-mobile.png) | [desktop](trade/09-route-MON-desktop.png) |
| 10 | `/sources` | 4 | [phone](trade/10-sources-mobile.png) | [desktop](trade/10-sources-desktop.png) |
| 11 | `/swap` | 4 | [phone](trade/11-swap-mobile.png) | [desktop](trade/11-swap-desktop.png) |
| 12 | `/venues` | 3 → **4** | [phone](trade/12-venues-mobile.png) | [desktop](trade/12-venues-desktop.png) |

### Money

| # | Screen | Score | Phone | Desktop |
|---|---|---|---|---|
| 01 | `/auto-close/1a29f81d-de85-4670-b154-fe0bdb27db8b` | 4 | [phone](money/01-auto-close-1a29f81d-de85-4670-b154-fe0bdb27db8b-mobile.png) | [desktop](money/01-auto-close-1a29f81d-de85-4670-b154-fe0bdb27db8b-desktop.png) |
| 02 | `/deposit` | 4 | [phone](money/02-deposit-mobile.png) | [desktop](money/02-deposit-desktop.png) |
| 03 | `/disposals` | 3 → **4** | [phone](money/03-disposals-mobile.png) | [desktop](money/03-disposals-desktop.png) |
| 04 | `/export` | 4 | [phone](money/04-export-mobile.png) | [desktop](money/04-export-desktop.png) |
| 05 | `/flatten` | 4 | [phone](money/05-flatten-mobile.png) | [desktop](money/05-flatten-desktop.png) |
| 06 | `/holdings` | 4 | [phone](money/06-holdings-mobile.png) | [desktop](money/06-holdings-desktop.png) |
| 07 | `/pnl` | 3 → **4** | [phone](money/07-pnl-mobile.png) | [desktop](money/07-pnl-desktop.png) |
| 08 | `/portfolio` | 4 | [phone](money/08-portfolio-mobile.png) | [desktop](money/08-portfolio-desktop.png) |
| 09 | `/position/1a29f81d-de85-4670-b154-fe0bdb27db8b` | 4 | [phone](money/09-position-1a29f81d-de85-4670-b154-fe0bdb27db8b-mobile.png) | [desktop](money/09-position-1a29f81d-de85-4670-b154-fe0bdb27db8b-desktop.png) |
| 10 | `/sell-everything` | 4 | [phone](money/10-sell-everything-mobile.png) | [desktop](money/10-sell-everything-desktop.png) |
| 11 | `/send` | 4 | [phone](money/11-send-mobile.png) | [desktop](money/11-send-desktop.png) |
| 12 | `/tokens` | 4 | [phone](money/12-tokens-mobile.png) | [desktop](money/12-tokens-desktop.png) |
| 13 | `/watchlist` | 4 | [phone](money/13-watchlist-mobile.png) | [desktop](money/13-watchlist-desktop.png) |
| 14 | `/withdraw-everything` | 4 | [phone](money/14-withdraw-everything-mobile.png) | [desktop](money/14-withdraw-everything-desktop.png) |

### Agents and strategies

| # | Screen | Score | Phone | Desktop |
|---|---|---|---|---|
| 01 | `/agent/momentum-scout` | 4 | [phone](agents/01-agent-momentum-scout-mobile.png) | [desktop](agents/01-agent-momentum-scout-desktop.png) |
| 02 | `/agent/basket` | 3 → **4** | [phone](agents/02-agent-basket-mobile.png) | [desktop](agents/02-agent-basket-desktop.png) |
| 03 | `/agent/new` | 4 | [phone](agents/03-agent-new-mobile.png) | [desktop](agents/03-agent-new-desktop.png) |
| 04 | `/agent/risk` | 4 | [phone](agents/04-agent-risk-mobile.png) | [desktop](agents/04-agent-risk-desktop.png) |
| 05 | `/agent/strategies` | 4 | [phone](agents/05-agent-strategies-mobile.png) | [desktop](agents/05-agent-strategies-desktop.png) |
| 06 | `/bot` | 4 | [phone](agents/06-bot-mobile.png) | [desktop](agents/06-bot-desktop.png) |
| 07 | `/bot/momentum-scout/backtest` | 4 | [phone](agents/07-bot-momentum-scout-backtest-mobile.png) | [desktop](agents/07-bot-momentum-scout-backtest-desktop.png) |
| 08 | `/bot/momentum-scout/intro` | 4 | [phone](agents/08-bot-momentum-scout-intro-mobile.png) | [desktop](agents/08-bot-momentum-scout-intro-desktop.png) |
| 09 | `/bot/momentum-scout/settings` | 4 | [phone](agents/09-bot-momentum-scout-settings-mobile.png) | [desktop](agents/09-bot-momentum-scout-settings-desktop.png) |
| 10 | `/bot/leaderboard` | 4 | [phone](agents/10-bot-leaderboard-mobile.png) | [desktop](agents/10-bot-leaderboard-desktop.png) |
| 11 | `/bot/roster` | 4 | [phone](agents/11-bot-roster-mobile.png) | [desktop](agents/11-bot-roster-desktop.png) |
| 12 | `/judge` | 4 | [phone](agents/12-judge-mobile.png) | [desktop](agents/12-judge-desktop.png) |
| 13 | `/proposals` | 3 → **4** | [phone](agents/13-proposals-mobile.png) | [desktop](agents/13-proposals-desktop.png) |
| 14 | `/roster-compare` | 4 | [phone](agents/14-roster-compare-mobile.png) | [desktop](agents/14-roster-compare-desktop.png) |
| 15 | `/schedule` | 4 | [phone](agents/15-schedule-mobile.png) | [desktop](agents/15-schedule-desktop.png) |
| 16 | `/strategies` | 4 | [phone](agents/16-strategies-mobile.png) | [desktop](agents/16-strategies-desktop.png) |
| 17 | `/strategy-library/b200_sess_8` | 4 | [phone](agents/17-strategy-library-b200-sess-8-mobile.png) | [desktop](agents/17-strategy-library-b200-sess-8-desktop.png) |
| 18 | `/strategy/a4585653-6f66-4235-910e-42912913491a` | 4 | [phone](agents/18-strategy-a4585653-6f66-4235-910e-42912913491a-mobile.png) | [desktop](agents/18-strategy-a4585653-6f66-4235-910e-42912913491a-desktop.png) |
| 19 | `/strategy/dca` | 4 | [phone](agents/19-strategy-dca-mobile.png) | [desktop](agents/19-strategy-dca-desktop.png) |
| 20 | `/strategy/grid` | 4 | [phone](agents/20-strategy-grid-mobile.png) | [desktop](agents/20-strategy-grid-desktop.png) |
| 21 | `/voice` | 4 | [phone](agents/21-voice-mobile.png) | [desktop](agents/21-voice-desktop.png) |

### Council

| # | Screen | Score | Phone | Desktop |
|---|---|---|---|---|
| 01 | `/council` | 5 | [phone](council/01-council-mobile.png) | [desktop](council/01-council-desktop.png) |

### Perps on Perpl

| # | Screen | Score | Phone | Desktop |
|---|---|---|---|---|
| 01 | `/perpl` | 5 | [phone](perps/01-perpl-mobile.png) | [desktop](perps/01-perpl-desktop.png) |
| 02 | `/perps` | 5 | [phone](perps/02-perps-mobile.png) | [desktop](perps/02-perps-desktop.png) |
| 03 | `/risk` | 3 → **4** | [phone](perps/03-risk-mobile.png) | [desktop](perps/03-risk-desktop.png) |

### History and audit

| # | Screen | Score | Phone | Desktop |
|---|---|---|---|---|
| 01 | `/activity` | 4 | [phone](history/01-activity-mobile.png) | [desktop](history/01-activity-desktop.png) |
| 02 | `/audit/554` | 4 | [phone](history/02-audit-554-mobile.png) | [desktop](history/02-audit-554-desktop.png) |
| 03 | `/audit/anchor` | 4 | [phone](history/03-audit-anchor-mobile.png) | [desktop](history/03-audit-anchor-desktop.png) |
| 04 | `/audit/chain` | 4 | [phone](history/04-audit-chain-mobile.png) | [desktop](history/04-audit-chain-desktop.png) |
| 05 | `/explain/554` | 4 | [phone](history/05-explain-554-mobile.png) | [desktop](history/05-explain-554-desktop.png) |
| 06 | `/history` | 4 | [phone](history/06-history-mobile.png) | [desktop](history/06-history-desktop.png) |
| 07 | `/metrics` | 4 | [phone](history/07-metrics-mobile.png) | [desktop](history/07-metrics-desktop.png) |
| 08 | `/network` | 4 | [phone](history/08-network-mobile.png) | [desktop](history/08-network-desktop.png) |
| 09 | `/networks` | 4 | [phone](history/09-networks-mobile.png) | [desktop](history/09-networks-desktop.png) |
| 10 | `/runs` | 4 | [phone](history/10-runs-mobile.png) | [desktop](history/10-runs-desktop.png) |
| 11 | `/runs/026ed316-2bc0-494d-be64-32a88e4bac4b` | 5 | [phone](history/11-runs-026ed316-2bc0-494d-be64-32a88e4bac4b-mobile.png) | [desktop](history/11-runs-026ed316-2bc0-494d-be64-32a88e4bac4b-desktop.png) |
| 12 | `/system` | 4 | [phone](history/12-system-mobile.png) | [desktop](history/12-system-desktop.png) |
| 13 | `/verify` | 4 | [phone](history/13-verify-mobile.png) | [desktop](history/13-verify-desktop.png) |

### Safety and settings

| # | Screen | Score | Phone | Desktop |
|---|---|---|---|---|
| 01 | `/alerts` | 4 | [phone](safety/01-alerts-mobile.png) | [desktop](safety/01-alerts-desktop.png) |
| 02 | `/alerts/new` | 4 | [phone](safety/02-alerts-new-mobile.png) | [desktop](safety/02-alerts-new-desktop.png) |
| 03 | `/allocation` — a route this build hides | 2 → **4** | [phone](safety/03-not-here-mobile.png) | [desktop](safety/03-not-here-desktop.png) |
| 04 | `/allowlist` | 3 → **4** | [phone](safety/04-allowlist-mobile.png) | [desktop](safety/04-allowlist-desktop.png) |
| 05 | `/approvals` | 2 → **4** | [phone](safety/05-approvals-mobile.png) | [desktop](safety/05-approvals-desktop.png) |
| 06 | `/business` | 4 | [phone](safety/06-business-mobile.png) | [desktop](safety/06-business-desktop.png) |
| 07 | `/delegation` | 4 | [phone](safety/07-delegation-mobile.png) | [desktop](safety/07-delegation-desktop.png) |
| 08 | `/legal/terms` | 4 | [phone](safety/08-legal-terms-mobile.png) | [desktop](safety/08-legal-terms-desktop.png) |
| 09 | `/limits` | 4 | [phone](safety/09-limits-mobile.png) | [desktop](safety/09-limits-desktop.png) |
| 10 | `/policy` | 4 | [phone](safety/10-policy-mobile.png) | [desktop](safety/10-policy-desktop.png) |
| 11 | `/recovery` | 2 → **4** | [phone](safety/11-recovery-mobile.png) | [desktop](safety/11-recovery-desktop.png) |
| 12 | `/safety` | 5 | [phone](safety/12-safety-mobile.png) | [desktop](safety/12-safety-desktop.png) |
| 13 | `/settings` | 4 | [phone](safety/13-settings-mobile.png) | [desktop](safety/13-settings-desktop.png) |

### States — empty, offline, stopped

| # | Screen | Score | Phone | Desktop |
|---|---|---|---|---|
| 01 | `/history` — a new account, nothing traded yet | 3 → **4** | [phone](states/01-history-empty-mobile.png) | [desktop](states/01-history-empty-desktop.png) |
| 02 | `/activity` — a new account, nothing traded yet | 4 | [phone](states/02-activity-empty-mobile.png) | [desktop](states/02-activity-empty-desktop.png) |
| 03 | `/runs` — a new account, nothing traded yet | 3 → **4** | [phone](states/03-runs-empty-mobile.png) | [desktop](states/03-runs-empty-desktop.png) |
| 04 | `/council` — a new account, nothing traded yet | 4 | [phone](states/04-council-empty-mobile.png) | [desktop](states/04-council-empty-desktop.png) |
| 05 | `/portfolio` — a new account, nothing traded yet | 4 | [phone](states/05-portfolio-empty-mobile.png) | [desktop](states/05-portfolio-empty-desktop.png) |
| 06 | `/` — the executor unreachable | 4 | [phone](states/06-home-offline-mobile.png) | [desktop](states/06-home-offline-desktop.png) |
| 07 | `/portfolio` — the executor unreachable | 4 | [phone](states/07-portfolio-offline-mobile.png) | [desktop](states/07-portfolio-offline-desktop.png) |
| 08 | `/safety` — before the stop | 5 | [phone](states/08-safety-live-mobile.png) | [desktop](states/08-safety-live-desktop.png) |
| 09 | `/safety` — after hold-to-stop, read back from the chain | 5 | [phone](states/09-safety-stopped-mobile.png) | [desktop](states/09-safety-stopped-desktop.png) |

