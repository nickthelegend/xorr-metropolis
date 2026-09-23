<p align="center">
  <img src="assets/brand/xorr-banner.png" width="820" alt="XORR. — A bot that trades your capital while you get on with your life." />
</p>

# xorr — a council of AI agents that trades Robinhood Chain Stock Tokens inside a permission you can revoke

**Built for the [Arbitrum Open House Singapore Buildathon](https://www.hackquest.io/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon).**
Tokenized US stocks trade around the clock on Robinhood Chain; nobody can watch a market all night. xorr lets a council of
agents do it for you — every trade voted on first, every vote shown beside the transaction it produced, and none of it
able to touch more than you allowed, because the chain enforces the limit.

| | |
|---|---|
| Web app | https://xorr-arbitrum.vercel.app |
| Robinhood Chain node | https://robinhood-fork-production.up.railway.app (chain 4663; real state at block 70,254,193) |
| Arbitrum One fork | https://arbitrum-fork-production.up.railway.app (chain 42161) |
| Arbitrum executor | https://executor-fork-production-ba80.up.railway.app/health |

## What it does

1. **Sign in** with email. Privy creates an EVM wallet that is yours; xorr never sees its key.
2. **Fund it** with USDG — Paxos' dollar, the currency every Stock Token pool on Robinhood Chain is quoted in.
3. **Grant a permission** — one transaction you sign on `XorrDelegation`: a daily cap, an end date, and the one venue the
   agents may use (Uniswap v3's router). The contract refuses anything past the cap, after the end date, to any other
   venue, or that does not pay you at least the quoted minimum.
4. **The council votes.** Before any trade, four seats read the same live inputs and vote, each with its reason:
   - **Session Desk** — Robinhood's own trading session and halt flag for the stock, its Chainlink feed, the pool's quote,
     and how far apart those prices are. Can veto.
   - **Risk Keeper** — your grant read from the chain: what is left today, the end date, a quarter-of-the-grant position
     limit, your ERC-8056 holdings. Can veto.
   - **Trend Reader** — the stock's last Chainlink rounds and where the ask sits in today's range.
   - **Macro Desk** — crypto's risk appetite from GMX V2: who pays funding on ETH and BTC and how one-sided open interest is.
5. **Approved trades execute** through the delegation on Uniswap v3; the round records the transaction hash. The Council
   screen shows every round: the proposal, each vote and its numbers, and the hash.
6. **Hedge on GMX.** The agent is a GMX V2 *subaccount* of your own GMX account — positions are yours, and GMX itself caps
   how many actions the agent may take and until when. Orders are tracked from creation to the keeper's execution.
7. **See it straight.** Holdings use each token's ERC-8056 `uiMultiplier`, so dividends and splits move the numbers the way
   the issuer meant; corporate actions come from Robinhood's API.
8. **Stop everything in one tap.** Revoke is one transaction you sign; the next council round is vetoed "revoked", and no
   trade can fill from that block on.

Robinhood Stock Tokens are not available to US persons and are restricted in Canada, the UK and Switzerland.

## Sponsor tech, and exactly how it is used

| Tech | Used for | Where |
|---|---|---|
| **Robinhood Chain** | Stock Tokens (ERC-20 + ERC-8056), Uniswap v3 pools vs USDG, Chainlink per-token feeds; `/rhj/assets` sessions and multipliers, `/rhj/prices` halts, `/rhj/corporate-actions` | `server/src/robinhood/`, `infra/robinhood-fork/` |
| **Paxos USDG** | the settlement token of the delegation on Robinhood Chain; GMX USDG markets | `server/src/evm/chains.ts` |
| **Arbitrum One** | GMX V2 perps, the Arbitrum executor and fork | `server/src/venues/gmx/`, `infra/arbitrum-fork/` |
| **GMX V2** | SubaccountRouter agent orders, pending-order tracker, `/markets/info` funding/OI in the council | `server/src/venues/gmx/`, `server/src/prove-gmx.ts` |
| **ZeroDev** | Kernel v3 accounts with the agent's session key limited by CallPolicy, RateLimit and Timestamp policies | `server/src/aa/`, `server/src/prove-zerodev.ts` |
| **Chainlink** | per-stock price feeds on Robinhood Chain: deviation guard and trend | `server/src/robinhood/chain.ts` |
| **Uniswap v3** | the stock and crypto venue on both chains | `server/src/venues/` |

A full audit of what is real versus missing, and 50 ranked sponsor features, is in `docs/SPONSOR-AUDIT.md`.

## How to verify it

```bash
cd contracts && forge test                                        # the delegation and anchor
cd server && npm ci
set -a; . ./.env.robinhood-fork; set +a                             # FORK_RPC = the hosted Robinhood node
npx tsx src/fork/swap-check-robinhood.ts                           # buy + sell $50 of NVDA, TSLA, AAPL, SPY
npx tsx src/robinhood/print-catalog.ts                             # live catalog, session, Chainlink vs pool
FORK_RPC=https://arbitrum-fork-production.up.railway.app npx tsx src/prove-gmx.ts
FORK_RPC=https://arbitrum-fork-production.up.railway.app npx tsx src/prove-zerodev.ts
```

`docs/TESTPLAN-ARBITRUM.md` lists every item checked and its result.

## Honest limits

- **Forks, not mainnet money.** Trades fill on hosted forks of the real chains; nothing here spends real funds.
- **The Robinhood node is a snapshot.** Robinhood Chain's public RPC keeps about ten minutes of state, so a long-lived fork
  of it breaks. The node serves Robinhood Chain's real state at block 70,254,193 (2026-09-23 05:12 UTC) — pools, tokens,
  feeds — so fills there use that moment's prices, while the council's live inputs (Robinhood's API, the live Chainlink
  feed, GMX) keep moving. With an archive RPC the same node forks live (`ROBINHOOD_ARCHIVE_RPC`).
- **GMX keepers do not run on a fork**; there, orders are executed by our fork keeper at GMX's own live signed prices, and
  labelled so.
- **Testnet deployments** (Arbitrum Sepolia, Robinhood Chain testnet) are scripted (`contracts/deploy-testnet.sh`) and wait
  on test ETH for the deployer.

## History

xorr began on Base, moved to Solana for STOCKLANA, and was restarted from that code for Arbitrum on 2026-09-23. The Solana
README is `docs/archive/README-solana.md`.
