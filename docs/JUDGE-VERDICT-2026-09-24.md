# A skeptical judge's verdict — xorr on Monad, as it stands (evening, 2026-09-24)

Judged at commit `0d2a5f4`, replacing the morning's verdict (`b7abb23`, at `47edeea`). Nothing was fixed during
judging. Criteria are **Metropolis' own**: main track = product quality, technical excellence, Monad integration, track
fit (Onchain Finance & Trading), innovation, 20% each; bounties = requirements 40%, technical implementation 30%, Monad
integration 20%, innovation 10%; plus the rules' hard requirements (public OSI repo, a deployment on Monad testnet or
mainnet, a public demo video of ≤ 3 minutes). Source: `docs/METROPOLIS.md`.

**How it was tested.** First what a judge receives: the repository, the README, any link, any video. Then the product,
the way a rushed judge would use it, on the build the rules count — **Monad testnet** — with a brand-new account
(`test-1430@privy.io`, nothing pre-funded): welcome → goals → the real email-code sign-in → fund → the grant → Perps →
test funds → open a desk. Every executor request, status and answer logged; balances read on chain after each step.
The fork-of-mainnet build (real fills with test money) was judged on the end-to-end flows run the same day
(`docs/TESTPLAN-MONAD.md`, F1–F20 and the 91-route crawl). The code was grepped for mocks, stubs, fakes, hardcoded data
and TODOs.

## Scores

| Category | Morning | Now | Why, in one sentence |
|---|---|---|---|
| Product quality | 5 | **6 / 10** | On the fork every flow a judge would try works and says the truth (grant, buy, sell, stop, send, sign out and back, a reload mid-grant, an executor restart) — but on testnet a fresh user cannot get past the grant, because nothing gives them gas. |
| Technical excellence | 6 | **7 / 10** | A limit the chain enforces, a Perpl desk whose trading key can never withdraw, a Chainlink price gate that vetoes with live numbers, 4,300+ passing tests and no mocks — marked down because both executors exited unattended at 09:22 with nothing logged and nobody noticed for four hours. |
| Monad integration | 2 | **6 / 10** | Deployed and verified on testnet, real Perpl orders there (six filled, four by an agent), Monad's own Chainlink, Kuru and Perpl read live — but spot trading exists only on a local fork, and the testnet path is out of gas tonight. |
| Track fit | 5 | **7 / 10** | Agents trading spot and perps on Monad venues inside an on-chain, revocable limit is exactly Onchain Finance & Trading. |
| Innovation | 5 | **6 / 10** | Votes shown beside the transactions they produced, on a perps desk the agent cannot withdraw from, is a real idea — in a field judges have seen many agent traders in. |
| Sponsor tech | 1 | **4 / 10** | Perpl, AUSD and Chainlink feeds are real and on screen; Kuru only prices; Mera — the first requirement of the $10K Agora bounty — is absent, as are CRE, Envio, Nansen and MetaMask (`docs/SPONSOR-AUDIT.md`). |
| Presentation / demo | 2 | **1 / 10** | The repository is private, nothing is hosted, and the only videos in the repo (`docs/demo/`) came with the root commit from the Arbitrum build — there is no Monad demo at all. |

Main track (five criteria, equal weight): **6.4 / 10** on the product. The submission itself does not yet meet the rules.

## What is actually wrong, ranked

### Dealbreakers — would visibly lose the round
1. **There is nothing a judge can open.** The repository is **private** (the rules require a public, OSI-licensed repo),
   no build is hosted (README: "Hosted Monad fork, executor, web — pending"), and there is **no Monad video** (the rules
   require ≤ 3 minutes showing real Monad interactions; the three videos in `docs/demo/` are the Arbitrum build's). A
   judge cuts this before looking at the product.
2. **A fresh testnet user dead-ends at gas.** Fund on testnet says "Send AUSD to your address" and offers no test
   funds; the grant's first signature then fails with "Signer had insufficient balance · Please try again." The only
   test-funds button is on Perps, and it answered **502 after 44.8 s** ("Signer had insufficient balance") — the faucet
   key holds 0.0074 MON, the delegate that pays desk creation and tops up the agent 0.0006 MON, the agent's key 0.021
   MON against ~0.048 MON per order. Wallet after all of it: 0 MON, 0 AUSD. *A technical judge would catch this in under
   a minute* — it is the first thing they would press.
3. **The $10K bounty's first requirement is missing.** Agora's Best Mobile Trading App requires sign-in through Mera;
   sign-in is Privy. AUSD and a Perpl trade — the other two — are real.

### Real deductions — would cost meaningful points
4. **Spot trading only exists on a local fork.** On testnet there is no spot venue at all (Home says so, honestly);
   Kuru's testnet router exists and is unused, and on mainnet data Kuru only prices.
5. **"The council trades perps" has never happened.** The code routes an approved round to Perpl on testnet; no round
   has ever been convened there.
6. **Both executors exited unattended** (~09:22, within a minute of each other) with no error, no signal and no drain
   logged, and were down for four and a half hours before anyone noticed. Cause undetermined; they now run under a
   supervisor that logs every exit — a hosted deployment needs the same, plus an alert.
7. **Five targeted sponsors have no code** (Mera, CRE, Envio, Nansen, MetaMask) though the README's plan names them;
   Kuru's bounty (a trade routed through its book) is unmet.

### Polish — would only matter in a close call
8. "Signer had insufficient balance · Please try again." — wallet jargon, and trying again cannot help. It should say
   the wallet needs MON for gas and where to get it.
9. The test-funds button shows nothing for 45 seconds, then an error.
10. The test funds live on Perps, not on the Fund step where a new user is told to fund.
11. Networks on this build: "This build talks to an executor none of these serve." — true locally, alarming to read.
12. WMON's asset screen: a fill "would happen nearer $0.02" — a sub-cent price rounded to two decimals.
13. A grep for "hardcoded" finds dozens of hits — all of them comments recording hardcoding that was *removed*; a
    skimming judge may not read far enough to see that.

**Mocks and fakery: none found.** No mocked response, stubbed function or demo data in any runtime path; every number
checked (balances, orders, votes, prices) traced to the chain or a named live source, and inputs change the answers
(the council's reasons move with the live gap: 66 bps in the morning, 98.2 bps tonight).

## The one thing between this and winning

**A judge cannot see it work on Monad.** Make it public, host it, fund the three testnet keys, and record the three
minutes — the product underneath is better than its presentation, and right now nobody outside this machine can find
that out.

## Would it place?

**As it stands: cut in the first pass** — a private repo, no hosted link and no Monad video fail the rules' own
requirements, and the testnet path a judge would try runs out of gas.
