# xorr on Monad — honest completion

**Now: 32 of 44 · 73%** (second measurement, below). First measurement the same evening: 22 of 44 · 50%.

**100% is the project's own definition of done** (`PLAN.md` §1: Qualified · Product · Honest · Technical · Submitted),
plus the phases `PLAN.md` §3 commits to (P2–P5, the sponsor work) and the rules in `docs/METROPOLIS.md`. Each item is
verified by running it — the flow driven in a real browser with its requests logged, the transaction's receipt read, the
command run — never by a file existing. Mocked, stubbed, broken or unreachable counts as not done; nothing is rounded up.
The Arbitrum build's measurement this file used to hold is in `docs/archive/COMPLETION-arbitrum.md`.

## First measurement — 2026-09-24 evening, commit `cb1ec6c` — **22 of 44 · 50%**

✓ verified done · ✗ not done (why, and where)

### Qualified and submitted (the rules) — 3 of 7
| # | Item | | Evidence / gap |
|---|---|---|---|
| 1 | Contracts deployed and verified on Monad testnet | ✓ | Sourcify: exact match for XorrDelegation `0x5995…0bd4b` and the anchor `0x5a71…6203` on 10143, read tonight |
| 2 | Repository public | ✗ | `gh repo view`: **PRIVATE**. Owner action (the rules require public) |
| 3 | MIT licence | ✓ | `LICENSE` |
| 4 | README discloses the foundation and AI tools | ✓ | README "Disclosures (Metropolis rules)" |
| 5 | A hosted build a judge can open | ✗ | P0.6 not started; README "pending" |
| 6 | Demo video ≤ 3 min of real Monad interactions | ✗ | The videos in `docs/demo/` are the Arbitrum build's (root commit) |
| 7 | Submitted on hackathon.monad.xyz | ✗ | Owner action |

### Product — "a judge can…" — 8 of 14
| # | Item | | Evidence / gap |
|---|---|---|---|
| 8 | Sign in with a passkey (Mera) | ✗ | Sign-in is Privy; 0 lines of Mera (P4.1) |
| 9 | See a USDC balance | ✓ | Fork: Home and Send show 25,000 → 24,990 USDC after two sends, equal to the chain (F17) |
| 10 | See an AUSD balance | ✓ | Testnet Portfolio: "CASH · AUSD $499.80 · 1 AUSD = $0.9998 · Chainlink" = 499.800293 on chain |
| 11 | AUSD named where money is shown first (Home, Deposit) | ✗ | Only Portfolio names it (P4.2) |
| 12 | Grant a capped permission | ✓ | Fork: F3, F14 (Privy-signed; `remainingToday` $1,600 on chain) |
| 13 | …as a fresh user on testnet | ✗ | Fund on testnet offers no test funds; the grant fails "Signer had insufficient balance"; Perps' test funds 502 after 44.8 s (faucet key 0.0074 MON) |
| 14 | Hire an agent that trades on its own | ✓ | F12: Yield Keeper's own wallet bought 415.18 WMON inside the cap |
| 15 | Watch the council vote and fill MON, each vote beside the transaction | ✓ | Fork round #2 executed (`0x6289f268…`); tonight's live round cites Chainlink, the fill and Kuru |
| 16 | …filled on Kuru when Kuru quotes better | ✗ | No Kuru fill path (P1.3); Kuru only prices |
| 17 | Open a Perpl position from an agent — **now** | ✗ | Real before (6 orders on chain, 4 by an agent) but tonight the operator key has 0.021 MON for a ~0.048 MON order and the delegate 0.0006 |
| 18 | The perps permission: caps before every order, removing the agent stops it on chain | ✓ | 1 order refused by caps on record; `OnlyOwnerOrOperator` revert after removal (`docs/evidence/prove-perpl-desk-testnet-2026-09-24.txt`) |
| 19 | The council opens a Perpl position (testnet) | ✗ | Code path exists (`council-executor.ts:86`); never run — 0 testnet rounds |
| 20 | Stop everything on chain | ✓ | Proof re-run tonight: `PolicyRevoked()` mined (`docs/evidence/prove-monad-fork-2026-09-24-evening.txt`) |
| 21 | Withdraw / send | ✓ | F17: $5 to an allowlisted address, both balances read on chain |

### Honest — 2 of 5
| # | Item | | Evidence / gap |
|---|---|---|---|
| 22 | Every price names its source | ✗ | WMON's asset screen: "the market feed" (CoinGecko, unnamed) vs "two price sources" (unnamed; the second is Uniswap on the fork, carried in a field called `oneinch`), and "a fill would happen nearer $0.02" |
| 23 | The price gap gates a spend | ✗ | The council's does (> 150 bps vetoed); a manual order is not gated (P2.2) |
| 24 | A fork is always labelled a fork | ✓ | Fund, Send, Privy's sheet ("Network Monad fork"), Perpl ("read live from mainnet") |
| 25 | No fixture data in a product path | ✓ | Grep: every "hardcoded" hit is a comment about hardcoding removed; 91-route crawl |
| 26 | Errors say what actually happened | ✗ | A Uniswap quote that **timed out** on a cold fork is reported as "No liquidity for WMON -> USDC at this size" (`server/src/venues/uniswap.ts:239`) — it failed the proof once tonight |

### Technical — 5 of 8
| # | Item | | Evidence / gap |
|---|---|---|---|
| 27 | Typecheck | ✓ | app and server `tsc --noEmit` clean |
| 28 | Lint | ✗ | 6 errors ("Cannot call impure function during render" ×2, unescaped `'` ×4), 25 warnings |
| 29 | Unit tests | ✓ | app 2,774 · executor 1,496 passed |
| 30 | `forge test` | ✓ | 53/53 |
| 31 | `prove-monad.ts` | ✓ | Passed on the warm fork tonight; failed twice while the fork was cold (item 26) |
| 32 | CI green on `main` | ✗ | Every run today fails at Lint |
| 33 | A real, persisted database | ✓ | Postgres; strategies, runs, audit (12/12 hash-linked) identical across an executor restart (F20) |
| 34 | The executor stays up unattended | ✗ | Both executors exited at ~09:22 with nothing logged and stayed down 4.5 h; now supervised with exit tracing, cause unknown |

### The sponsor phases PLAN commits to — 2 of 8 (item 43 is item 16)
| # | Item | | Evidence / gap |
|---|---|---|---|
| 35 | Chainlink on Monad gates the council (P2.3) | ✓ | Live round: Chainlink $0.02396 vs fill $0.02372 vs Kuru, 98.2 bps (limit 150) |
| 36 | Perpl markets, positions, liquidation (P3.1, P3.4) | ✓ | `/perpl` live; Perps positions with entry, mark, PnL, liquidation |
| 37 | Per-agent identity keys and encrypted memory from the passkey (P4.3) | ✗ | Not started |
| 38 | Scoped session; identity rebuilt on a fresh device (P4.4) | ✗ | Not started |
| 39 | Envio index behind History and Verify (P5.1) | ✗ | Not started |
| 40 | Chainlink CRE workflow (P5.2) | ✗ | Not started |
| 41 | Nansen seat (P5.3) | ✗ | Not started; no key (x402 would spend real USDC) |
| 42 | MetaMask Agent Wallet plugin (P5.4) | ✗ | Not started |
| 43 | Kuru trade routed through its book (the Kuru bounty) | ✗ | = item 16 |

### The test plan — 2 of 2
| # | Item | | Evidence |
|---|---|---|---|
| 44 | Every route renders clean | ✓ | 91/91, run 6 |
| 45 | The end-to-end flows | ✓ | F1–F20 pass (`docs/TESTPLAN-MONAD.md`) |

(Item 43 duplicates 16 and is not counted twice: 22 of 44 unique items.)


## Second measurement — the same evening, after the build, commit `d5239c1`+ — **32 of 44 · 73%**

Re-measured across the whole checklist, not only the items touched: the 91-route crawl again (**91/91**, run 7), the
proof again (**passed**: grant, a fill on Kuru, `DailyCapExceeded` mined, close, `PolicyRevoked` mined —
`docs/evidence/prove-monad-fork-2026-09-24-final.txt`), every suite (app 2,812 · executor 1,516 · contracts 59 passing;
typecheck 0 errors on both sides; lint 0 errors), CI on `main`, and each changed flow in the browser
(`docs/TESTPLAN-MONAD.md`, "the evening build").

| # | Item | First | Now | What moved it |
|---|---|---|---|---|
| 6 | Demo video ≤ 3 min | ✗ | ✓ | 2:59 recorded from the running app (`docs/demo/xorr-monad-demo.mp4`, `183a12a`); publishing it is item 7 |
| 8 | Sign in with a passkey (Mera) | ✗ | ✓ | `7b64c9e` — web; verified with a virtual PRF authenticator (Expo not built) |
| 11 | AUSD named on Home and Deposit | ✗ | ✓ | `cbd0dc3` |
| 16 / 43 | MON filled on Kuru when it delivers more | ✗ | ✓ | `e504cd2` — `KuruVenue`; sale and buy filled on Kuru on the fork; the proof's buy chose Kuru |
| 22 | Every price names its source | ✗ | ✓ | `0cc4173` |
| 23 | The price gap gates a spend | ✗ | ✓ | `d9ff059` — manual buys too (WBTC refused at 469 bps) |
| 26 | Errors say what happened | ✗ | ✓ | `6e526e7` (a timeout is not "no liquidity"), `5ebb4e2` (missing gas, in MON, before any sheet) |
| 28 | Lint | ✗ | ✓ | `4d3a490` — 0 errors |
| 32 | CI green on `main` | ✗ | ✓ | green on every push since `4d3a490` |
| 38 | Scoped session; identity rebuilt on a fresh device (P4.4) | ✗ | ✓ | `7b64c9e`, `d5239c1` — 15-minute signing window with a countdown; storage cleared → the same account, grant and notes |

**Still not done, and why:**

| # | Item | Why |
|---|---|---|
| 2 | Repository public | Owner: publishing is an outward-facing action |
| 5 | A hosted build | Owner: a Railway/Vercel deployment costs money and needs the owner's accounts |
| 7 | Submitted | Owner: registration and submission on hackathon.monad.xyz |
| 13 | A fresh user completes the grant on testnet | The product now says why and where gas comes from (`5ebb4e2`); the faucet key holds 0.0053 MON — owner: fund `0x5C19…2D938` and `0xEe7d…c49f` at faucet.monad.xyz (a captcha-gated site) |
| 17 | A Perpl position from an agent, now | Same keys: the operator holds 0.021 MON for a ~0.048 MON order |
| 19 | The council opens a Perpl position on testnet | Needs the same gas to run once |
| 34 | The executor stays up unattended | Both exited at ~09:22 with nothing logged; now supervised with exit tracing and no unexplained exit since 13:50 — the cause is not found, so it is not claimed |
| 37 | Per-agent identity keys + encrypted memory (P4.3) | Half: the notes key is built (`d5239c1`); per-agent identity keys are not |
| 39 | Envio index (P5.1) | Not built: a judge could only see it hosted (an Envio account), and its local stack would need ports another project holds and disk this machine lacks |
| 40 | Chainlink CRE workflow (P5.2) | Not built: CRE needs a Chainlink account (`cre login`; deployment needs access approval) — an account is the owner's to create |
| 41 | Nansen seat (P5.3) | No key; x402 pay-per-call spends real USDC on Monad mainnet — the owner's call |
| 42 | MetaMask Agent Wallet plugin (P5.4) | Not built: last by plan, a separate CLI artifact |
