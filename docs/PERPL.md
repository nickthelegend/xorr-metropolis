# How xorr uses Perpl

xorr is a council of AI agents that trades for you on Monad, inside a limit you sign and the chain enforces. Perpl is
where its perps trade. xorr enters two Perpl bounties:

- **Best use of the API:** a trading bot on Perpl. The council and the exit guard trade each owner's own Perpl account,
  held by Perpl's `DelegatedAccount`.
- **Best Analytics / Risk Tool:** the `/perpl` screen. It shows funding, price, crowding and liquidation distance per
  market, from Perpl's public API.

## What Perpl does in the product

**The desk.** Each owner gets a Perpl account owned by Perpl's own `DelegatedAccount` contract (the "desk"). The owner
is its owner. xorr's key, one per owner, is its operator.

- **Perpl's contract guarantees:**
  - the operator can trade;
  - the operator can never withdraw;
  - a withdrawal always pays the owner;
  - after `removeOperator`, the operator can do nothing.
- **xorr enforces, before signing:** the owner's caps (per order, per day, leverage). Defaults are $250, $1,000 and 2x.
- **Who trades the desk:**
  - the council: an approved round opens a 1x long on testnet (`executeOnDesk` in `server/src/executor/council-executor.ts`);
  - agents;
  - the owner, from the Perps screen;
  - the exit guard, which closes positions on its own.
- **The stop** is one hold on the Perps screen ("Hold to stop the agent", `perps-stop`). The owner sends
  `removeOperator` from their own wallet. Resuming is also theirs: `addOperator` with xorr's signed consent.

**The risk screen (`/perpl`).** For every open market:

- who pays funding now, and what a long paid over 24h or 7 days (each payment drawn, plus the yearly pace);
- the price move;
- open interest in dollars at the mark;
- the spread;
- how old the mark is.

Above the markets is a short list of what deserves a look:

| Alert | Threshold | Level |
|---|---|---|
| Crowded funding | 25% a year or more | watch |
| Big move | 5% or more | watch |
| Wide book | over 25 bps | watch |
| Stale mark | over 60 s old | high |
| Your own position near liquidation | under 15% away (testnet build, with a desk) | high |

Perpl's geo-block list is shown too. **Perpl also feeds the council:** the Perps Desk seat votes on whether Perpl longs
are crowded, from who pays funding.

## How it works

**Code:**

- `server/src/monad/perpl-chain.ts`: Perpl's addresses, ABIs and order arithmetic.
- `server/src/monad/perpl-desk.ts`: the desk.
- `server/src/monad/perpl-exits.ts`: the exit guard.
- `server/src/monad/perpl-risk.ts`: the risk data.
- `app/perps.tsx`: the Perps screen.
- `app/perpl.tsx` and `src/data/perplRisk.ts`: the risk screen.

**1. The owner signs a message, not a transaction.** `createTypedData(owner)` builds Perpl's EIP-712
`Create(owner, operator, nonce, deadline)` for the factory, where `operator = operatorFor(owner)`. Then
`createDesk(...)`:

1. checks that the signature recovers to the owner;
2. has the operator sign Perpl's `AssignOperator` consent;
3. submits `createWithSignature`, with the executor paying the gas;
4. reads the new desk from `DelegatedAccountCreated`.

```ts
export function operatorFor(owner: Address) {
  return agentActor(`perpl:${owner.toLowerCase()}`);
}
```

Since each owner has their own key, stopping one user's agent touches nobody else's.

**2. Orders are planned off the chain's own book.** `withChainBook` reads `getPerpetualInfo` from Perpl's Exchange for
the bid, ask and mark, rather than trusting the API's copy. `planOrder` then:

- sizes the order in USD;
- prices it as an IOC limit, 1% through the book top (`IOC_TOLERANCE = 0.01`);
- refuses a size that rounds to zero lots.

`orderDesc` sets `immediateOrCancel: true` and `lastExecutionBlock: head + 18n` (about 5.4 s at Monad's 300 ms blocks),
and allows 300 bps of initial underwater collateral (`MAX_NEG_PNL_BPS`).

**3. Refusals are named before anything is paid for.** `placePerpOrder` refuses an order, each with its own code, when:

| Code | Reason |
|---|---|
| `operator_removed` | the owner removed xorr's operator |
| `account_not_opened` | the desk's Perpl account isn't open |
| `allowlist_stale` | the desk doesn't allow the current `execOrder` selector |
| `order_cap` / `daily_cap` / `leverage_cap` | over the owner's limits |
| `leverage_market` | over the market's maximum leverage |

Then it simulates the exact transaction:

```ts
// The exact transaction, simulated first: a refusal is named here instead of being paid for on chain.
try {
  gas = await publicClient.estimateGas({ account: op.account, to: desk, data });
} catch (e) {
  const name = revertName(e);
```

Perpl's own errors are decoded by name: `TakerOrderSettlementFailed`, `OnlyOwnerOrOperator`, `SelectorNotAllowed`, and
others. A close is sized to the position's own lots, and it is never held to a cap: getting out is never blocked.

**4. Standing exits, every tick.** `perplExitSweep()` runs on each scheduler tick (`TICK_MS`, 30 s by default), before the
agents' turn. `exitFor` checks the rules most urgent first:

| Rule | Closes when | Default |
|---|---|---|
| Liquidation buffer | the mark is within N% of liquidation | 10% |
| Stop-loss | the position is down N% of its margin | 50% |
| Take-profit | the position is up N% of its margin | off |
| Funding | the position is losing and paying funding at N% a year or more | 50% |

Profit and loss are worked out from the mark, the entry and the size, not from Perpl's stored PnL. A close goes through
`placePerpOrder` with `placedBy: 'Exit guard'`, and the reason is written to Activity in plain words. The guard does
nothing for:

- a wallet whose agents are stopped;
- a desk that no longer has xorr as operator.

**5. Risk from Perpl's public API, no key.** `perplRisk(hours)` reads:

- `GET /v1/pub/context`;
- `/v1/market-data/:id/funding/:from-:to`;
- `/v1/market-data/:id/candles/3600/:from-:to`.

It is served at `GET /monad/perpl/risk?hours=1–168` with no login. `fundingSeries` turns Perpl's rate (in millionths per
interval) into %/hour, what longs paid over the window, and an APR. Markets are sorted by how much funding they pay right
now.

## Engineering notes

- **The desk allowlist goes stale.** A new desk's operator allowlist is written from the selectors its implementation
  was compiled against. On testnet (24 Sep), the current `execOrder` (`0x4d8dc985`) was not allowed. `deskState` reads
  the missing selectors, and the owner enables them with `setOperatorAllowlist`. The three seeded owners each did this.
- **`maxNegPnlCollatBPS = 0` refuses every taker buy.** The first attempt failed with
  `TakerOrderSettlementFailed(…, 14)`. Hence the 300 bps allowance.
- **Gas for a fresh agent key.** Monad keeps freshly received MON unspendable for a few blocks. `sendWhenSpendable`
  retries for up to about 90 s. If it still can't send, the order is refused as `agent_gas_pending`, never sent blind.
  The operator is topped up after every order, so the next one doesn't wait.
- **Cheap idle sweeps.** `mayHavePositions` checks two values (`isOperator`, then the account's position banks) before
  reading a full desk. Most desks, most ticks, have nothing to close (commit `b247aaa`).
- **Cached history.** Risk windows end on a 5-minute mark, so a revisit is answered from the cache. The live context
  has its own 30 s cache.
- **Fork-only:** a fork of Monad mainnet has Perpl's contracts but not its keepers. There, the desk trades only while
  xorr's local keeper posts marks (`PERPL_FORK_KEEPER=1`, `server/src/fork/perpl-keeper.ts`). The signed-in demo
  journey is recorded on that fork and tagged so on screen. The proof below is testnet.

**Tests:** `server/src/monad/perpl-exits.test.ts` and `server/src/monad/perpl-risk.test.ts`.

**History:**

| Commit | Change |
|---|---|
| `2c5fde5` | Agents trade Perpl through Perpl's own DelegatedAccount |
| `9b84ce2` | Perps screen: open, fund, trade, stop, resume, withdraw |
| `5815019` | Perpl risk: funding history, alerts, liquidation distance |
| `27f513a` | Desks close their own positions |
| `38a2d05` | Perpl on the local fork |

## The value Perpl brought

**A bot people can trust with leverage.** Perpl's `DelegatedAccount` means xorr's agent can trade but never withdraw,
and the owner's one transaction ends it. That is the guarantee the product is built around, and Perpl ships it as a
contract, not a promise.

**A fully on-chain book xorr can check before it pays.** Because Perpl's book and positions live on the Exchange, xorr:

- reads the real top of book;
- simulates the exact order;
- reads liquidation distance straight from the position.

Refusals have names, and the exit guard works from chain state, not a feed.

**Funding as a signal.** Perpl's public funding history drives three things: the risk screen, the Perps Desk's council
vote, and the guard's "paying to hold a loser" exit.

## Live proof (Monad testnet)

**Proof run, 13 Oct.** `server/src/prove-perpl-desk.ts`, output in
`docs/evidence/prove-perpl-desk-testnet-2026-10-13.txt`.

- **Owner:** a team test wallet, not a user: `0x2ea15b8B0E0864122704FF4BA3dc5EAbbf46B32e`.
- **Desk:** `0xa21Fa8708008890565817c9d73538Cabc3d098b5`, Perpl account #692.

**Steps:**

1. **The agent opens a long.** A $100 MON long at 2x: entry $0.02421, liquidation $0.015106 (37.6% away).
   https://testnet.monadvision.com/tx/0x2db7fc2922467c6d14f6cb7da5d768f0ac70430c7550a7fc6eaecc94656d9c88
2. **A $300 order is refused before signing:** "$300 is over your $250 per-order limit for agents on Perpl."
3. **CloseLong through the desk:**
   https://testnet.monadvision.com/tx/0x1d530ae29ffc2b64798851d832826ba017ffb280852a6b254a5456f3e50e6e4f
4. **The exit guard closes a reopened long on its own.** The owner's buffer was set to 39%, and the position was 37.6%
   from liquidation. Activity reads: "The MON long was 37.6% from liquidation (your buffer: 39%), so it was closed before
   Perpl liquidated it."
   https://testnet.monadvision.com/tx/0x54a880a1620e74216b3f782b57426988ce48b53b1e3d0cfcc284fd28c53e3ee4
5. **The owner sends `removeOperator`:**
   https://testnet.monadvision.com/tx/0x6babda2cd2223fff91024027e3bc60c8fd72962185a87f8c7e90e9bf1bfd367e
   - The executor then refuses with `operator_removed`.
   - A raw operator order sent anyway is mined and reverted by Perpl's contract (`OnlyOwnerOrOperator`):
     https://testnet.monadvision.com/tx/0xd9e94a3d06845f125326ae206bc63720b067d866767dd6067925c7286365aaac
6. **`withdrawCollateral` pays the owner**, +148.427218 AUSD:
   https://testnet.monadvision.com/tx/0xec19b9ee5bfc70ccce4e3dd969cfb8c6b34841ead1d686a7dc438555d499bc3c

**Council fills, team-seeded (13 Oct).** These four wallets were created by the team, not by users, and the app labels
them "team-seeded". Each owner:

- signed a desk into being (`createWithSignature`);
- funded it;
- set limits of $100 an order, $300 a day and 2x.

Each round proposed "buy $50 of BTC", and each approved round opened a 1x BTC long through the owner's desk:

| Round | Vote | Fill |
|---|---|---|
| 8 | Approved 4–1 | https://testnet.monadvision.com/tx/0x3801226dad6e0b03b059874dcc5bd39392a233133b1b20bf043f3b21728aad5f |
| 9 | Approved 2–1 | https://testnet.monadvision.com/tx/0x58b91c83217ddcd94ccda5e4543adb012b5c36f8f17b0128a241ea520520dd48 |
| 10 | Approved 2–1 | https://testnet.monadvision.com/tx/0x312d9dba3d69fc9f225897e327cf4d6eaa3bd05ecef1c0d238825b3602f820a3 |
| 11 | Approved 4–0 | https://testnet.monadvision.com/tx/0x47e37f0c1702d8d5ca5351a61a3814966bd636b225cd7e09e80f23b43baea21e |

The desk creations:

- wallet 1: https://testnet.monadvision.com/tx/0x2d00f1eb9be31fa4915e22b93bacb626668bc122cf3f207c599a26c5d2e24479
- wallet 2: https://testnet.monadvision.com/tx/0x5cfde0658b66c68b54c4d90eb4a456ffb1446460dda21fd8681ea88e33bd9b86
- wallet 3: https://testnet.monadvision.com/tx/0x4468bb548ca8e4d67bd293489f2bec449d20c1744060ee8fa0b150e0cf2b65bd
- round 11's wallet: https://testnet.monadvision.com/tx/0xfac4cc039bd37dc5aa231b896982c69c8292578ab47cd1daa0c0896bc9456d8c

Rounds 1–7 on the same wallets were vetoed, and they stay in the record. Everything is in `docs/evidence/seed-13oct.md`.
The newest seeded round can be replayed without logging in: https://xorr-metropolis.vercel.app/council/sample
