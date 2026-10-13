# How xorr extends the MetaMask Agent Wallet

xorr is a council of AI agents that trades for you on Monad, inside a limit you sign and the chain enforces. For the
MetaMask Agent Wallet (`mm`, `@metamask/agent-wallet` 7.x), xorr ships a plugin, **`mm-plugin-perpl`**. It gives an
agent wallet a trading capability it doesn't have yet: **perpetuals on Perpl, Monad's on-chain order book**. The
built-in `mm perps` trades Hyperliquid. This plugin trades Perpl, on Monad testnet (chain 10143, the default) or
mainnet (143).

**Status up front:** the plugin builds, its 16 unit tests pass, and its two read-only commands have run inside `mm`
7.0.0. The four wallet commands have **not** been run in a signed-in agent wallet. They need the owner's `mm login`,
which hasn't happened yet.

## What it does

| Command | `mm` capabilities | What it does |
|---|---|---|
| `mm perpl markets [--network]` | none | Open markets: mark, funding per hour (and who pays), open interest in $, max leverage |
| `mm perpl risk [--hours 1–168]` | none | Per market: funding longs paid over the window and its yearly pace, price move, trades; alerts for crowded funding, big moves, wide books, stale marks |
| `mm perpl account` | wallet-read | The wallet's Perpl account: AUSD balance, each position's PnL, liquidation price and distance, funding $/h |
| `mm perpl deposit --amount` | wallet-read, wallet-submit | Approves the Exchange if needed, then opens the account (first time) or adds margin |
| `mm perpl open MON --side long --usd 50 [--leverage 2]` | wallet-read, wallet-submit | An IOC order through the book top (±1%), with leverage capped by the market and margin checked |
| `mm perpl close MON` | wallet-read, wallet-submit | Closes exactly the lots held |

Every command defaults to testnet, so a first order isn't real money. `--network mainnet` switches to mainnet, and
`--json` gives machine output. The capabilities are declared per command in the `mm` block of `package.json`. That way
`markets` and `risk` ask for nothing, and only the three trading commands ask for `wallet-submit`.

## How it works

**Code:** `mm-plugin-perpl/src/`. There are six oclif commands in `commands/perpl/`, each a `PluginCommand` from
`@metamask/agent-wallet/plugin`. The logic is in `lib/`:

- **`perpl.ts`:** networks, Exchange ABI, order sizing, `execOrder` encoding, liquidation math;
- **`host.ts`:** wallet selection and sending;
- **`preflight.ts`:** simulation;
- **`account.ts`:** position reads;
- **`risk.ts`:** funding and candle analysis.

**Market data comes from Perpl's public API, with no key.** `readContext` fetches `${net.api}/v1/pub/context`, where
`api` is `https://testnet.perpl.xyz/api` or `https://app.perpl.xyz/api`. `risk` adds
`/v1/market-data/:id/funding/...` and `/candles/3600/...`. On 2026-10-14 the testnet context endpoint answered with 8
open markets (BTC, ETH, SOL, MON, ZEC, LIT, PUMP, NEAR).

**Chain reads and writes go to Perpl's Exchange contract:** testnet `0x1964C32f0bE608E7D29302AFF5E61268E72080cc`,
mainnet `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F`. Reads use the host's `ctx.publicClient(chainId)`.

**The plugin never sees a key.** Every transaction goes through MetaMask's executor (`lib/host.ts`):

```ts
const execute = await ctx.walletExecutor(io, commandId);
const result = await execute(
  { kind: 'transaction', chainId: net.chainId, transaction: { to: tx.to, data: tx.data }, intent },
  { waitForReceipt: true });
```

Each send carries an `intent` (`perps.open`, `perps.close` or `perps.deposit`) with a human summary and details, so the
owner sees what they are approving. For an open, that's the size, the IOC limit, the margin and the expected liquidation
price. The wallet's own policy layer then decides whether it is sent.

**Every transaction is simulated first** (`lib/preflight.ts`). It is `eth_call`ed from the wallet's own address before
the wallet is asked to sign. A revert is decoded into Perpl's named errors (`TakerOrderSettlementFailed`,
`ExceedsLastExecutionBlock`, `AccountNotCreated`) and raised as `PERPL_REFUSED`, with "Nothing was sent."

**An order** (`planOrder` → `execOrderData`) works like this:

- It is sized in dollars against the book top.
- A buy may reach `ask × 1.01` and a sell `bid × 0.99`.
- A size under one lot is refused rather than sent.
- It is encoded as `execOrder` with `immediateOrCancel: true`, leverage in hundredths, and `maxNegPnlCollatBPS: 300`.
- `lastExecutionBlock` is the head plus 150 blocks (~45 s at Monad's 300 ms blocks), so the order can't execute late if
  the owner is slow to approve.

**Before signing, `open` refuses:**

- an unknown market;
- leverage above the market's maximum;
- a wallet with no Perpl account;
- margin above the free balance.

`deposit` checks the AUSD balance, the allowance and Perpl's minimum to open an account. On testnet, it points to
Agora's AUSD faucet.

## Engineering notes

- **The encoding is ported, not invented.** The `execOrder` tuple and order types match xorr's executor
  (`server/src/monad/perpl-chain.ts`), which filled orders on Perpl testnet. One example is the $100 MON long in
  `docs/evidence/prove-perpl-desk-testnet-2026-09-24.txt`.
- **One path differs and is unproven.** The executor trades through a Perpl delegated-account "desk" as an operator.
  The plugin has the wallet own its account directly (`approve` → `createAccount`/`depositCollateral` → `execOrder`).
  That direct-from-wallet path hasn't been sent on chain yet.
- **Close sends exactly the lots held.** A dollar-sized plan rounds, so `close` overwrites `lotLNS` with the
  position's own lot count.
- **After each trade, the account is read back.** `open` and `close` report whether a position actually exists (or
  remains) afterward. An IOC that didn't fill is reported as such, not as success.

## The value

- **The agent wallet gets a Monad venue.** It can trade perps on Monad's on-chain book, with funding, liquidation
  distance and risk alerts read before any order.
- **MetaMask's guardrails still apply.** Because it sends through `ctx.walletExecutor` with typed intents, the wallet's
  policy and approval flow apply to a Perpl order as they do to its other transactions. The plugin only adds checks;
  it never bypasses them.
- **It's the same reading xorr's council uses.** `risk` mirrors xorr's Perpl risk screen
  (`server/src/monad/perpl-risk.ts`), so an agent wallet and xorr's Perps Desk look at the same numbers.

## Proof

**Unit tests:** `cd mm-plugin-perpl && npm test`, run 2026-10-14:

```
 ✓ test/lib.test.ts (16 tests) 8ms
 Test Files  1 passed (1)
      Tests  16 passed (16)
```

They cover:

- context parsing in the market's own decimals;
- market lookup;
- dollar sizing and the 1% IOC limit;
- `execOrder` encoded, then decoded back;
- refusals for sub-lot and quote-less orders;
- liquidation price against the desk proof ($0.014975 for 4166 MON at $0.024 on 50.07532 margin);
- funding and PnL signs;
- the funding window and APR;
- risk-alert wording;
- wallet selection.

`tsc --noEmit` is clean.

**Inside `mm` 7.0.0** (`docs/evidence/mm-perpl-2026-10-05.txt`, installed with
`mm plugins install "file:$PWD"`, experimental plugins on):

- `mm perpl markets` returned live data on testnet (8 markets) and mainnet (11);
- `mm perpl risk --hours 24` returned funding, price moves and alerts;
- `mm perpl account` was refused by the host with `AUTH_FAILED … run mm login`, as it should be without a sign-in.

**Not yet verified:**

- `account`, `deposit`, `open` and `close` in a signed-in agent wallet. These need the owner's `mm login`, plus test
  MON for gas and test AUSD.
- How MetaMask's approval screen renders the intents.
- Any on-chain transaction sent by the plugin. No transaction has been sent by it.

**Install (local):**

```bash
cd mm-plugin-perpl && npm install && npm run build
mm config set experimentalPlugins true
mm config set experimentalAllowUnverifiedInstalls true
mm plugins install "file:$PWD" --accept-permissions
mm perpl markets
```
