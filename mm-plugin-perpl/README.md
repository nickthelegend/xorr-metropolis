# mm-plugin-perpl — Perpl perps on Monad for the MetaMask Agent Wallet

A plugin for the MetaMask Agent Wallet CLI (`mm`, `@metamask/agent-wallet` 7.x) that gives an agent wallet a new trading
power: **perpetuals on Perpl, Monad's on-chain order book**. The built-in `mm perps` trades Hyperliquid; this trades
Perpl, on Monad testnet (chain 10143, the default) or mainnet (143).

The wallet owns its Perpl account directly. Every transaction is built here, **simulated from the wallet's own address
first** (a refusal is named before anything is signed), and sent through `ctx.walletExecutor`, so MetaMask's Guard mode,
Blockaid screening and 2FA apply to a Perpl order exactly as they do to a swap. The plugin never sees a key.

| Command | Capabilities | What it does |
|---|---|---|
| `mm perpl markets [--network]` | none | Open markets: mark, funding per hour (who pays), open interest in $, max leverage |
| `mm perpl risk [--hours 1–168]` | none | Per market: what longs paid over the window and its yearly pace, the price move, trades; alerts for crowded funding, big moves, wide books, stale marks |
| `mm perpl account` | wallet-read | The wallet's Perpl account: AUSD on Perpl, each position's PnL, liquidation price and distance, funding $/h |
| `mm perpl deposit --amount` | wallet-read, wallet-submit | Approve the Exchange if needed, then open the account (first time, ≥ 100 AUSD) or add margin |
| `mm perpl open MON --side long --usd 50 [--leverage 2]` | wallet-read, wallet-submit | An IOC order through the book top (±1%), leverage capped by the market, margin checked, expected liquidation shown in the approval |
| `mm perpl close MON` | wallet-read, wallet-submit | Close exactly the lots held |

`--network mainnet` switches every command to Perpl on Monad mainnet; without it they use testnet, so a first order is not
real money. Add `--json` for machine output.

## Install (local)

```bash
npm install && npm run build
mm config set experimentalPlugins true
mm config set experimentalAllowUnverifiedInstalls true
mm plugins install "file:$PWD" --accept-permissions
mm perpl markets
```

## Status (2026-10-05)

- **Run inside `mm` 7.0.0:** `markets` (both networks) and `risk` returned live data; `account` was refused by the host for
  want of `mm login`, as it should be (`docs/evidence/mm-perpl-2026-10-05.txt`).
- **Not yet run live:** `account`, `deposit`, `open` and `close` need a signed-in agent wallet (`mm login`) holding test MON
  for gas and AUSD (Agora's testnet faucet: `requestFunds(address)` at `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`).
  Their encoding is the one xorr's executor filled six orders with on Perpl testnet
  (`server/src/monad/perpl-chain.ts`); here it is unit-tested (`npm test`, 16 tests: sizing, the `execOrder` encoding
  decoded back, liquidation against the desk proof, risk alerts, wallet selection).

Part of [xorr](../README.md), built for Monad Metropolis. MIT.
