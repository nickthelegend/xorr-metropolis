# Kimi in the council: build notes from xorr

*xorr, Monad Metropolis, 14 October 2026*

xorr is a council of AI agents that trades for you on Monad, inside a limit you sign and the chain enforces. Before
anything is sent, every trade goes to five seats. Four are rules over live readings. The fifth is Kimi. These are our
notes on why Kimi has that seat, how it is called, what it costs, and where it falls short.

## The job: deciding the rounds rules can't

The four desks are deliberately simple:

| Desk | Checks |
|---|---|
| Price | Chainlink on Monad against the fill's quote |
| Risk | the owner's on-chain limit |
| Trend | Chainlink's recent rounds |
| Perps | Perpl funding and open interest |

Rules are good at hard stops and bad at judgement. When the desks disagree (a 2–1 with an abstention, a 2–2), something
has to weigh "prices agree within 0.7 bps" against "longs are paying 0.0042% an hour".

That's the Strategist seat. Kimi is sent the proposal, every reading the desks voted on, and each desk's ballot and
reason. It answers with a vote, a confidence and a reason of at most two sentences. The tally treats its vote like any
other seat's: a round needs at least two yes votes, more yes than no, and no veto. So when the desks split, Kimi's vote
settles the round, and its reason is the sentence the owner reads to understand why their money moved.

## The call

It is one request to Moonshot's OpenAI-compatible API (`server/src/council/strategist.ts`):

```json
{ "model": "kimi-k2.6",
  "thinking": { "type": "disabled" }, "temperature": 0.6, "max_tokens": 400,
  "response_format": { "type": "json_object" },
  "messages": [ { "role": "system", "content": "…the seat's rules…" },
                { "role": "user", "content": "{proposal, readings, ballots}" } ] }
```

The system prompt sets the rules:

- weigh the desks and decide the close calls;
- answer with one JSON object, `{vote, confidence, reason}`;
- never veto;
- name the readings that carried the decision;
- use only numbers that appear in the readings or ballots;
- if the readings don't support a view, abstain and say what's missing.

There are no tools and no browsing: everything Kimi needs is in the message, and that's the point. Its view of the market
is exactly the desks' view, recorded with the round.

## Why Kimi

We needed four things:

1. **Strict JSON.** The answer must parse on the first try.
2. **Honest arithmetic.** It must quote numbers rather than make them up.
3. **Speed.** A council on Monad can deliberate and still fill at the price it voted on, but only if the seat answers
   fast.
4. **Low cost.** The hosted app is public, and the whole budget was $10 of credit.

`kimi-k2.6` with thinking disabled met all four.

## Measured

On 14 October we sent it a split round: Price yes at 0.95, Risk yes at 0.83, Trend abstaining, and Perps no on BTC
funding. We sent it twice.

| Call | Time to answer | Prompt tokens | Completion tokens |
|---|---|---|---|
| 1 | 1.88 s | 292 | 87 |
| 2 | 1.37 s | 292 (256 served from Moonshot's cache) | 89 |

Both answers were valid JSON and voted yes at 0.78 and 0.79. The first reason read:

> "Session-desk's 0.7 bps price agreement (limit 150) and risk-keeper's $50.00/$300.00 fit outweigh macro-desk's
> 0.0042%/h funding concern; trend-reader's abstention on +0.22% over 8 rounds is neutral."

Every number in that sentence came from a desk. That test prompt was smaller than a real round's, which also carries the
full readings object. So real calls use more prompt tokens, and we haven't measured those as precisely.

On Monad testnet, in team-seeded round 11 (a wallet we created ourselves, labelled in the app), Kimi voted yes at 0.75.
It weighed Price, Risk and Perps against Trend's abstention, and cited the 0.7 bps gap and the $50-within-$300 cap. The
round filled on Perpl: transaction `0x47e37f0c…a21e`. In that round the desks already agreed, so Kimi confirmed rather
than decided.

## Engineering notes

**Thinking off.** With thinking on, `kimi-k2.6` spent its token budget reasoning and sometimes returned an empty answer,
or timed out. A council seat needs a vote, not a chain of thought. With thinking disabled, the only temperature the
model accepts is 0.6.

**Validation.** `parseStrategist` refuses an answer, and the seat abstains with the reason on screen, if:

- it isn't JSON (a JSON object wrapped in prose is extracted);
- it tries to veto;
- it gives no confidence;
- its reason is empty or over 500 characters;
- its reason contains any number no desk reported.

**A $10 budget on a public app:**

- a ballot is cached for 30 minutes, keyed by the proposal and the desks' votes;
- a round a desk vetoed never calls Kimi;
- at most 30 calls a day, counted in Postgres with one atomic upsert, so a restart can't reset it;
- if the count can't be read, the call is not made. We saw this fail-closed path ourselves while writing this article:
  run without its database, the seat abstained with "daily capacity reached" instead of calling Kimi.

## Limits, honestly

- **Rate limits.** In team-seeded round 10, Kimi returned HTTP 429. The seat abstained, said so, and the desks decided
  the round, which filled 2–1.
- **Not every vote is decisive.** In unanimous rounds Kimi adds a fifth voice but doesn't change the outcome. Its value
  is concentrated in split rounds and in the explanation.
- **Cost.** We haven't measured cost per round in dollars; the daily cap is how we bound it.
- **It never has the last word on safety.** Vetoes stay with the rules.

## What it brought

Kimi turns a set of rules into a council. It makes the judgement calls the rules can't, and writes the one sentence an
owner actually reads. The sentence is held to the desks' own numbers, so the explanation can be checked against the
readings shown beside it.

Kimi is bounded like the rest of xorr: real authority, inside limits you can see.

*Code: `server/src/council/strategist.ts`, with tests in `strategist.test.ts` and `strategist.live.test.ts`. Live app:
https://xorr-metropolis.vercel.app. A team-seeded round with Kimi's vote, no sign-in needed:
https://xorr-metropolis.vercel.app/council/sample.*
