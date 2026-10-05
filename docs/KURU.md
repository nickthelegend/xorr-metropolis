# xorr × Kuru — the consumer trading app submission

**Bounty:** Kuru, "Build the Next Consumer Trading App on Kuru" (T1, Onchain Finance & Trading). Its requirement, as
read on 5 Oct: a focused spot trading product **routing trades through Kuru's on-chain order book** on Monad, with
**target users, evidence of demand and a retention plan**, plus a continuation plan. This page answers each, with what is
proven and what is not.

## What it is, in one line

A phone app where you hire AI agents to trade MON for you inside a daily cap the chain enforces; every MON fill goes to
whichever of **Kuru's book** or Uniswap delivers more for that order, measured on chain at the moment it is placed.

## How trades reach Kuru's book

- `contracts/src/KuruVenue.sol` takes a market order on Kuru's MON/USDC book (`0x065C…C394`, native MON) —
  `placeAndExecuteMarketBuy` / `placeAndExecuteMarketSell` — and forwards the WMON or USDC to the owner. `XorrDelegation`
  then checks the order's floor on **the owner's own balance**, so a fill sent anywhere else reverts.
- For every spot order the executor simulates both candidates through the contract (`server/src/executor/settle.ts`,
  `deliveredOnChain`) and sends the one that delivers more. History, the run page and the route screen name the venue
  ("filled on Kuru").
- Tests: `contracts/test/KuruVenue.t.sol` (6 against a mock book, one against the forked mainnet book when
  `MONAD_FORK_RPC` is set).

**Proven on a fork of Monad mainnet, not yet on Monad itself.** On the fork, through the executor's own code: a WMON
sale filled on Kuru for 49.91 USDC, a $50 buy for 2,109.62 WMON, and the proof run's buy chose Kuru on its own
(`docs/evidence/prove-monad-fork-2026-09-24-final.txt`). A fill on a real network needs either `KuruVenue` deployed on
mainnet with a few dollars of real funds, or Kuru Spot v2 test tokens from Kuru (v2's testnet ERC-20s are admin-minted;
Kuru's v1 testnet book is dead). Both are the owner's to obtain; the code path does not change.

## Target users

1. **People who hold MON and USDC on Monad and want a rule run for them** — buy $50 of MON every morning, take profit at
   +8%, stop at −5% — without handing over a key or watching a chart. They set a daily cap and an end date once; the
   agents act inside it, and one tap revokes it on chain.
2. **Small-ticket traders: $10 to a few thousand dollars an order.** That is where Kuru's book beat Uniswap's best pool
   in our mainnet measurement (below): up to ~9 bps more at $10–$100, and +2–3 bps at $1k–$5k in one of two runs. For
   them, routing through Kuru is money they keep.
3. **People new to on-chain trading on a phone.** Passkey sign-in (Mera, no seed phrase), balances and prices that name
   their source, every agent vote shown beside the transaction it produced.

**Not for:** market makers, or single orders in the tens of thousands — at $20k Uniswap delivered ~1% more in both runs,
and xorr routes those to Uniswap, as it should.

## Evidence of demand

What is measured, and what is not:

- **The routing pays, at the sizes our users trade.** `server/src/kuru-vs-uniswap.ts` asks both venues what a MON sale
  would deliver right now (read-only `eth_call`s on chain 143). Two runs 33 seconds apart
  (`docs/evidence/kuru-vs-uniswap-mainnet-2026-10-05.txt`):

  | Size | Run 1 (Kuru vs Uniswap) | Run 2 |
  |---|---|---|
  | $10 | +2.2 bps | +8.7 bps |
  | $100 | +2.4 bps | +8.9 bps |
  | $1,000 | −4.0 bps | +2.3 bps |
  | $5,000 | −3.7 bps | +2.5 bps |
  | $20,000 | −106.1 bps | −101.3 bps |

  The better venue **changed within a minute** at $1k–$5k. A consumer app that hard-codes one venue loses some orders
  either way; one that measures each order does not.
- **No user evidence yet.** xorr has not launched, so there are no users, waitlist or volume of its own to cite, and this
  page does not invent any. The first real signals will be the retention metrics below, from the first mainnet fills.

## Retention plan

What brings a person back is the agent's work arriving without them asking for it:

- **Every fill reports itself** — what the agent did, why the council voted for it, and which venue filled it at what
  price (built). Next: the other venue's number beside it ("Kuru delivered $0.09 more than Uniswap on this sale") — the
  executor already measures both for every order; the run record does not keep the loser's yet.
- **The cap renews daily**, so the agent keeps working inside the same permission; the morning briefing says what
  happened overnight and what is queued.
- **Alerts that matter** — a fill, a refusal (the cap reached, a price 150 bps from Chainlink), a revoked permission —
  never marketing.
- **Leaving is one tap** (revoke on chain), which is why staying is a choice.

Measured from the first mainnet fills: share of wallets with an active agent after 7 and 30 days; fills per active wallet
per week; the share of fills Kuru wins and the dollars it saved; revokes and the reason given.

## Continuation plan

1. **First real fills:** deploy `KuruVenue` on mainnet and run the proof with small real funds; in parallel, Kuru
   Spot v2 on testnet once Kuru provides test tokens (SDK `@toxicflow-labs/ts-sdk`, gas through Kuru's relay).
2. **Agents as makers, not only takers:** resting limit orders on Kuru's book for DCA and take-profit rules, so an agent
   earns the spread instead of paying it — the thing a book can do that a pool cannot.
3. **More books:** MON/AUSD once it has resting liquidity (empty when read on 24 Sep), then KuruFlow for pairs without a
   direct book.
4. **The phone build:** the Expo app with Mera passkeys on device (needs a passkey domain and a development build).
