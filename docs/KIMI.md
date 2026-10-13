# How xorr uses Kimi

xorr is a council of AI agents that trades for you on Monad, inside a limit you sign and the chain enforces. Kimi
(Moonshot AI, `kimi-k2.6`) holds the council's fifth seat: **the Strategist**.

## What Kimi does in the product

Every trade is put to five seats before anything is sent. Four of them are **desks**, rules over live readings:

| Seat | Reads |
|---|---|
| Price Desk | Chainlink on Monad against the fill's quote (Kuru's book or Perpl's) |
| Risk Keeper | the owner's on-chain limit and position size |
| Trend Reader | Chainlink's recent rounds |
| Perps Desk | Perpl funding and open interest |

Rules are good at hard stops and bad at weighing each other. Rounds split: 2–1 with an abstention, or 2–2. **Kimi is the
only seat that weighs the desks against each other.**

- **What it is sent:** the proposal, every reading the desks voted on, and each desk's ballot and reason.
- **What it does:** casts a real vote (yes, no or abstain), with a confidence and a short reason the owner can read.
- **How it counts:** the tally treats its vote like any other seat's. A round needs at least two yes votes and more yes
  than no, and no veto. So when the desks split, Kimi's vote settles the round.

**What it cannot do, by design:**

- **Veto.** Vetoes are safety stops (a stale feed, a fill far from Chainlink, a cap) and stay with the rules. A round a
  desk vetoed is not sent to Kimi at all.
- **Invent a number.** Every number in its reason must appear in what it was shown, or the answer is refused and the
  seat abstains, saying why.
- **Reach the screen unparsed.** The answer must be JSON and is validated field by field.

**Where you see it.** Kimi's vote and reason appear:

- in the council card;
- in the round's seat-by-seat replay ("Strategist (Kimi)");
- beside the transaction the round produced.

## The actual call

**Code:** `server/src/council/strategist.ts`. It is called from `convene()` in `server/src/council/convene.ts`, after
the four desks vote and before the tally.

**Request:** `POST https://api.moonshot.ai/v1/chat/completions`. Moonshot's API is OpenAI-compatible and the key is
`MOONSHOT_API_KEY`. The body:

```json
{
  "model": "kimi-k2.6",
  "messages": [{ "role": "system", "content": "<the seat's rules>" },
               { "role": "user", "content": "<{proposal, readings, ballots} as JSON>" }],
  "thinking": { "type": "disabled" },
  "temperature": 0.6,
  "max_tokens": 400,
  "response_format": { "type": "json_object" }
}
```

**The system prompt** gives the seat its job:

- weigh the four desks and decide the close calls;
- answer `{"vote": "yes"|"no"|"abstain", "confidence": 0–1, "reason": string}` with at most two sentences, naming which
  desk readings carried the decision;
- use only numbers that appear in the readings;
- never veto;
- abstain, and say what is missing, if the readings don't support a view.

**Parsing** (`parseStrategist`). The answer is refused, and the seat abstains with the reason shown, if:

- it is not JSON (an outer `{…}` is extracted if the model wraps it);
- it votes "veto";
- it gives no confidence;
- its reason is empty or over 500 characters;
- its reason contains any number that no desk reported.

**Without a key**, the seat is shown as not configured: it does not sit, and `/council/seats` says which key it needs.
There is no stand-in answer.

## Engineering notes

**Thinking off, temperature 0.6.** With thinking on, `kimi-k2.6` spent its token budget reasoning and returned an
empty answer, or timed out. A council seat needs a vote, not a chain of thought. With thinking disabled, the only
temperature the model accepts is 0.6 (other values return HTTP 400).

**A $10 budget on a public app.** Anyone with free testnet funds can convene rounds on the hosted app, so:

- **Cache:** a ballot is cached for 30 minutes, keyed by what it weighs (the proposal and the desks' votes). It is not
  keyed by the exact readings, which change every second.
- **Veto skip:** vetoed rounds never call Kimi.
- **Daily cap:** at most `KIMI_DAILY_CALLS` calls a day (default 30). The count is persisted in Postgres
  (`app_config`, key `kimi_calls:<UTC day>`, one atomic upsert), so a restart or a second executor can't reset it.
- **Fail closed:** if the count can't be read, the call isn't made.
- **When capped:** the seat abstains with "Kimi's daily capacity is reached", and the four desks decide.

**Failures are visible.** A timeout (25 s), an HTTP error or a refused answer becomes an abstention whose reason says
exactly what happened. In team-seeded round 10 on testnet, Kimi returned HTTP 429. The replay shows "Kimi did not
answer (HTTP 429), so the Strategist abstains", and the round was still decided by the desks.

**Tests:**

- `server/src/council/strategist.test.ts`: parsing, refusals, invented numbers, cache, cap and veto skip.
- `server/src/council/strategist.live.test.ts`: one real call, run on demand.

**History:**

| Commit | Change |
|---|---|
| `6f5dc93` | The seat |
| `6d19112` | Sits only with a key |
| `bef5910` | Budget, cache, veto skip |
| `29461d3` | Persisted daily cap |
| `e682106` | Thinking off, wrapped JSON parsed |

## The value Kimi brought

**It decides the rounds rules can't.** Fixed rules either deadlock on a split or need an arbitrary tiebreak. Kimi
reads the same evidence the desks read and makes the judgement call: for example, whether "Trend abstained, funding is
mild" is enough to proceed. The tally treats it as a full seat, so it changes outcomes; it isn't decoration.

**It explains the round in plain English.** The desks each give a mechanical reason. Kimi's reason is the one sentence
an owner reads to understand why their money moved. Because it may only cite numbers the desks reported, that
explanation can be checked against the readings beside it.

**It is bounded like the rest of xorr.** It cannot veto, cannot invent, cannot run past its budget, and every failure
is on screen. That matches the product's whole idea: agents with real authority, inside limits you can see.

## Live proof (Monad testnet)

**Team-seeded round 11 (13 Oct)** came from a wallet the team created itself, and it is labelled "team-seeded" in the
app.

- **Proposal:** buy $50 of BTC.
- **Desks:** Price yes, Risk yes, Perps yes, Trend abstained.
- **Kimi** voted **yes** at 0.75 confidence: *"Price Desk and Risk Keeper both approve with strong confidence, and Perps
  Desk finds funding acceptable at 0.0042%/h. Trend Reader abstained with no clear direction at +0.22% over 21 hours,
  but that is not a negative signal. The 0.7 bps gap and $50 within $300 caps make this a safe execution."*
- **Result:** approved 4–0. Here the desks already agreed, so Kimi confirmed rather than decided. Every number in its
  reason comes from the desks' readings.
- **The round's fill on Perpl:**
  https://testnet.monadvision.com/tx/0x47e37f0c1702d8d5ca5351a61a3814966bd636b225cd7e09e80f23b43baea21e
- **The round, with Kimi's vote:**
  - replay, no login: https://xorr-metropolis.vercel.app/council/sample (the newest team-seeded round);
  - API: https://executor-monad-testnet-production.up.railway.app/council/public/11

**Round 10 (13 Oct):** Kimi returned HTTP 429 and the seat abstained, saying so. The trade was approved 2–1 by the desks
and filled: https://testnet.monadvision.com/tx/0x312d9dba3d69fc9f225897e327cf4d6eaa3bd05ecef1c0d238825b3602f820a3

**More evidence:**

- All team-seeded rounds and their transactions are in `docs/evidence/seed-13oct.md`.
- The demo video (`docs/demo/xorr-demo.mp4`) shows Kimi voting in the council on the local fork, and its reason in the
  testnet replay.
