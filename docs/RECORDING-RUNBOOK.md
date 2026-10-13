# Recording runbook — the ≤ 3-minute video on the live app (13 Oct 2026)

**Start state.** Chrome, a fresh profile or incognito, window at phone width (DevTools device mode, 390 × 844) or a phone,
on https://xorr-metropolis.vercel.app/welcome. Google Password Manager available (passkeys with PRF). A screen recorder at
1080p. Nothing else needed: the app makes the account, funds it from xorr's faucet and pays the agent's gas.

**What it spends** (Monad testnet, from xorr's own keys — no top-up needed): ~0.13 MON from the faucet
`0x5C19…2938` (gas drip + Perps test funds) and 500 test AUSD to the new wallet; ~0.05 MON of the delegate
`0xEe7d…c49f` for the desk and the operator; no USDC.

| # | Seconds | Click | On screen | Caption |
|---|---|---|---|---|
| 1 | 0:00–0:12 | — (Welcome) | the tagline and the coin | "A council of AI agents trades for you on Monad, inside a limit the chain enforces." |
| 2 | 0:12–0:30 | Get started → Next → Next | the five seats; the permission; **Monad mainnet's blocks going Proposed → Voted → Final, live** | **Pause 4 s on the commit strip:** "A block every 300 ms, final in about half a second." |
| 3 | 0:30–0:45 | Create my account → Create a passkey | the passkey sheet, then the address | "One passkey, Mera. No seed phrase." |
| 4 | 0:45–1:00 | Continue — add funds → Get test funds; Continue — set the limits → Sign this permission | funds land; the permission signs with no popup | "A daily limit and an end date. The contract refuses anything past it." |
| 5 | 1:00–1:25 | Home → Perps → Open my Perpl desk → Long MON ($50, 2x) | the desk, then the position with its liquidation distance | "Perps on Perpl through a desk the agent can trade but never withdraw from." |
| 6 | 1:25–1:50 | Home → Council → Put $50 MON to the council | the verdict chip and the vote chips | "Four desks vote on Monad's own numbers; Kimi breaks ties." |
| 7 | 1:50–2:10 | Replay on the round | each seat with what it read, then the verdict | **Pause on the verdict:** "Every vote, replayed with the readings behind it." |
| 8 | 2:10–2:30 | Explore → Built on Monad → Check my passkey on Monad | commit states; "signature valid" on mainnet and the fork | "My passkey, checked by Monad's P256 precompile." |
| 9 | 2:30–2:50 | Safety → hold "Hold to stop all trading" | the curtain, then "Trading stopped" | "One hold stops everything, on chain." |
| 10 | 2:50–3:00 | — | the repo URL | "xorr. The agents trade; the chain keeps the limit." |

**Monad moments to hold on:** the commit strip (step 2, and again on Built on Monad), the council's vote-to-fill line
(step 6), the speed card where a fill shows one.

**If something hiccups:**
- Passkey sheet does not offer PRF (a local-profile passkey): use Google Password Manager, or a phone.
- "Get test funds" slow: Agora's AUSD faucet rate-limits everyone; wait 30 s and tap again (xorr's faucet tops it up).
- The council does not approve (it can vote no on a falling market): say so — "the council is the brake as well as the
  trigger" — and move on; the replay still plays.
- Kimi sits out with "daily capacity reached": the four desks decide; set `KIMI_DAILY_CALLS` higher on Railway only for
  the recording.
- Anything else: reload; the session and the account survive (the stateless test).
