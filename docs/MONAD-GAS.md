# Gas on Monad: what xorr does about it (7 Oct 2026)

Monad charges a transaction its **gas limit × price**, not the gas it used, and keeps a **10 MON reserve** per account
because consensus runs three blocks ahead of execution. Both change what an executor that sends every fill should do.
This is what xorr does, with the measurements behind it. (MONAD-TECH item 6; coverage in `docs/ROADMAP-WIN.md`.)

## 1. Tight, explicit limits

Every fill is simulated first (`simulateContract`, so a policy breach or a bad route surfaces as the contract's named
error and nothing is signed), then sent with an explicit limit: the estimate plus head-room
([`server/src/evm/gas-limit.ts`](../server/src/evm/gas-limit.ts)).

| | Head-room | Why |
|---|---|---|
| Ethereum and L2s | 30% | Unused gas is refunded; head-room only raises the balance a sender holds. A 3% estimate shortfall was measured (Aave withdraw on Base: 172,488 estimated, 177,503 used). |
| **Monad** | **10%** | Every point is paid on every fill. Still three times that shortfall; the estimate already sits above use, and the gap between estimate and execution is one 300 ms block. |

Measured on the local fork of Monad mainnet, the same $20 MON buy routed through Kuru:

| | Gas used | Gas declared (billed on Monad) | Declared ÷ used |
|---|---|---|---|
| Before (30%) | 309,084 | 502,260 | 1.63 |
| After (10%) | 309,084 | 424,989 | 1.38 |

That is 15% less gas billed per fill, read from the fills' own receipts (`strategy_runs.tx_gas_used`, `tx_gas_limit`).

## 2. The fee a person sees is Monad's

The order and swap screens' "Network fee" was the router's estimate for the swap alone, at the chain's gas price, in
**ETH's** dollar price. On Monad all three were wrong: gas is paid in MON (~100,000× cheaper than ETH), the fill runs the
delegation contract around the swap (~81k estimated against 199k–309k used), and the limit is what is billed. Now, on
Monad ([`server/src/evm/gas-price.ts`](../server/src/evm/gas-price.ts), [`server/src/routes/extra.ts`](../server/src/routes/extra.ts)):

- the size is the median gas the last twenty fills here used (the router's estimate only when there are none), plus 10%;
- the price is Monad's (on the local fork, Monad mainnet's, not anvil's);
- the dollar figure is at Chainlink's MON/USD on Monad;
- the screen says so: "Monad bills the gas a fill declares, used or not: ~219,381 at 102 gwei (mainnet's price) — what
  the last 11 fills here used, plus 10%." (`docs/screens/wave/m6-order-fee-*`). The Send screen prices gas in MON too.

## 3. The reserve balance

[`server/src/monad/reserve.ts`](../server/src/monad/reserve.ts), unit-tested against the rules in the docs:

- **Value transfers.** The only MON the executor moves with value is an agent's gas top-up on a test network. On Monad it
  is checked first: a transfer that would leave the desk under min(10 MON, its balance) reverts and still pays gas, unless
  it is the first transaction in three blocks from an account that is not 7702-delegated. Such a top-up is refused with
  the reason instead of sent.
- **Fees in flight.** At consensus an account's in-flight fees must fit within min(10 MON, its balance three blocks ago).
  Agents hold ~0.05 MON, and one Kuru fill declares ~0.043 MON of gas at 102 gwei, so two fills from one agent inside
  three blocks would not both be included. `broadcast` keeps a per-sender ledger of fees sent in the window and, when a
  send would not fit, waits the window out once rather than having it dropped.
- `0x1001` (`dippedIntoReserve()`) is for contracts that pay MON out. xorr's contracts never hold or pay MON, so none
  calls it; anvil has no code there either.

## 4. Contract size and storage

| Contract | Runtime | Initcode | Monad's limit |
|---|---|---|---|
| XorrDelegation | 6,851 B | 7,064 B | 128 KB / 256 KB |
| XorrPriceReceiver | 4,740 B | 5,030 B | |
| KuruVenue | 3,018 B | 3,160 B | |
| XorrAuditAnchor | 1,522 B | 1,548 B | |

All fit Ethereum's 24 KB too; nothing here needed Monad's larger limit.

**Parallel execution.** A spend writes exactly one persistent slot, `_spentOnDay[owner][agent][day]`, plus a transient
(EIP-1153) one for the owner whose venue call is running. There is no global counter or shared accumulator: two owners'
fills never touch the same slot, nor do one owner's two agents, so Monad's optimistic parallel execution has nothing to
re-execute between them.

**MIP-8 pages.** A spend reads `_stopped[owner]`, the `Policy` struct (`dailyCap`; `expiresAt` and `revoked` packed),
`_venueAllowed[owner][venue]` twice and `_spentOnDay`, each keyed separately, so about five cold 128-slot pages at 8,100
each. Moving the day's tally into the `Policy` struct (one page with the cap it is checked against) would save one cold
page per spend (~8,100 gas, ~3–4% of a fill), and make the tally's write land on an already-warm page. It changes the
deployed contract's layout, so it waits for the testnet redeploy rather than being made on the fork alone.
