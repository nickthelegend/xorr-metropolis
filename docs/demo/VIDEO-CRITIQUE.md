# Critique of `xorr-metropolis.mp4` (2:13, 13 Oct), as a Metropolis judge

I watched it with the `watch` skill: 14 keyframes plus its own captions. Below is the verdict, then what was wrong.

**Verdict: weak.** The video is honest and good-looking, but it doesn't show the product doing its job.

## What is missing from the flow

The core journey is never shown. There is no sign-up and no signed permission, nobody convenes the council, and there is
no buy, no Perpl desk opened by a user, and no hold-to-stop.

The take was recorded signed out, so the app appears only as read-only pages:

- Welcome;
- Built on Monad;
- the replay of a round a script convened;
- the gauntlet.

Instead of being shown in the app, two moments became cards:

- the "trade" is a receipt card;
- the "stop" is a receipt from an earlier run.

## Slides versus live operation

About 35 s of the 2:13 is a motion-graphics intro: about a quarter of the video before any product. The rules ask for
the product in actual operation, not slides.

The two receipt cards are honest, but they are cards. A judge sees ~18 s of static boxes where the app should be acting.

## Dead air and pacing

- The cursor hovers more than it acts. In Welcome it drifts over buttons it never presses.
- The gauntlet scene is a still page with one scroll.
- The outro holds for ~6 s.
- No scene has a wait to cut, because nothing waits: no transactions happen on screen.

## Problem and intended user

The problem is stated, "bots want your keys, and there's no brake", but only in the graphic intro. The intended user is
never named: someone who wants an agent to trade crypto and perps for them, inside a limit they control. The README
says it; the video doesn't.

## Monad proof

**Strong:**

- The commit-state strip, live from mainnet, with voted ~0.3 s and final ~0.5 s.
- Round 11's real testnet fill.

**Weak or missing:**

- No transaction is *sent* on camera, so the "two timers" never appear. That is the speed receipt: executed-in ms, with
  the receipt returned from `eth_sendRawTransactionSync`.
- No gas figure.
- No txpool status moment.
- Monad's speed is asserted rather than felt in a flow.

## Sponsors

| Sponsor | Shown? |
|---|---|
| Perpl | Only as a replay row and a receipt. Opening a desk, a long, and its exits are never shown. |
| Kuru and Uniswap | Absent. The route comparison ("Kuru's book vs Uniswap v3, filled on the better") is one of the strongest features. |
| Chainlink | One line in the replay; the price gate is never shown refusing or passing a live order. |
| Kimi | Present, as a vote in the replay. |
| AUSD | Not named. |
| Envio | History indexed by Envio is absent. |
| Mera / passkey | Absent: the "one passkey, no seed phrase" moment isn't there. |

## What the rebuild does

**Real app footage from the first seconds.** The product is shown signed in, doing the whole journey with the cursor:

1. passkey;
2. test funds;
3. signed permission;
4. the council convened and voting;
5. a buy routed Kuru vs Uniswap, with the speed receipt;
6. the Perpl desk, long and exits;
7. History from Envio;
8. hold to stop.

**Waits are sped up and tagged, never faked.** The signed-in journey is recorded on the local fork of Monad mainnet
(tagged as a fork) because:

- the recording agent won't create an account on the public site;
- Kuru and Uniswap only exist on mainnet.

The live-testnet proof is then shown alongside:

- the hosted app's Built on Monad page;
- round 11;
- the testnet receipts.
