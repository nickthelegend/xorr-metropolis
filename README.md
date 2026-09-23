<p align="center">
  <img src="assets/brand/xorr-banner.png" width="820" alt="XORR. — A bot that trades your capital while you get on with your life." />
</p>

# xorr — a council of AI agents that trades for you on Monad, inside a permission you can revoke

**Built for [Monad Metropolis](https://monad.xyz/developers/hackathons/metropolis) · track: Onchain Finance & Trading.**

Nobody can watch a market all night. xorr lets a council of AI agents do it for you — every trade voted on first, every
vote shown beside the transaction it produced, and none of it able to touch more than you allowed, because the chain
enforces the limit. On Monad a council can deliberate and still fill at the price it voted on: blocks land every 400 ms.

## What works today

Proven on a fork of Monad mainnet (chain 143, block ~107.4M), through the executor's own code, with Monad's real USDC,
real Uniswap v3 pools and the real router (`docs/evidence/prove-monad-fork-2026-09-24.txt`):

1. **A fresh wallet is funded** with Circle's USDC from the fork faucet.
2. **The owner grants a permission** — one transaction on `XorrDelegation`: $100 a day, an end date, and the one venue the
   agents may use (Uniswap's SwapRouter02 on Monad).
3. **An agent buys $50 of MON** — 2,065.82 WMON at $0.02416, delivered to the owner's wallet; the contract holds nothing.
4. **A $60 order is refused twice**: by the executor ("$50.00 is left"), and — sent raw, past every off-chain check — by
   the contract, mined as a revert: `DailyCapExceeded(60000000, 50000000)`.
5. **The position is closed** back to 49.70 USDC in the owner's wallet.
6. **The owner revokes.** The executor refuses the next order; a raw spend reverts with `PolicyRevoked()`.

**MON priced three independent ways**, live from Monad mainnet (`GET /monad/crosscheck`): Uniswap v3's pool, the mid of
Kuru's on-chain order book, and Chainlink's MON/USD feed — $0.024112, $0.024117 and $0.024118 when last read, 2.2 bps
apart. Perpl's perpetual markets (`GET /monad/perpl`): mark, book, open interest and funding for BTC, MON, ETH, SOL and more.

What is next, phase by phase — Kuru fills, Perpl orders from agents, Mera passkey accounts with an AUSD balance, Envio
indexing, a Chainlink CRE workflow — is in [`PLAN.md`](PLAN.md). The hackathon research and the bounties we build for are
in [`docs/METROPOLIS.md`](docs/METROPOLIS.md).

## Monad, and exactly how it is used

| | Used for | Where |
|---|---|---|
| **Monad** (143 / 10143) | the chain the permission lives on and every fill settles on; a fork of mainnet for real fills with test money | `server/src/evm/chains.ts`, `infra/monad-fork/` |
| **Uniswap v3 on Monad** | spot venue: QuoterV2 quotes, SwapRouter02 fills through `XorrDelegation.spend()` | `server/src/venues/uniswap.ts` |
| **Kuru** | MON/USDC and MON/AUSD order books read on-chain (`bestBidAsk`); the fill path is next | `server/src/monad/kuru.ts` |
| **Chainlink** | MON/USD, ETH/USD, USDC/USD, AUSD/USD feeds; staleness refused | `server/src/monad/chainlink.ts` |
| **Perpl** | perpetual markets for the council and the risk screens; agent orders are next | `server/src/monad/perpl.ts` |
| **Agora AUSD** | held and shown; Perpl's margin currency | `server/src/venues/tokens.ts` |
| **Sourcify (MonadVision)** | contract verification on deploy | `contracts/deploy-testnet.sh` |

## Deployments

| | Address |
|---|---|
| Monad testnet `XorrDelegation` | pending — `contracts/deploy-testnet.sh monad-testnet` is ready and waits on test MON for the deployer |
| Monad testnet `XorrAuditAnchor` | pending (same script) |
| Hosted Monad fork, executor, web | pending (`PLAN.md` P0.6) |

## Run it

```bash
npm ci && (cd server && npm ci)
cd contracts && forge build && forge test && cd ..

# A fork of Monad mainnet, and our contracts on it
anvil --fork-url https://rpc.monad.xyz --chain-id 143            # or: sh infra/monad-fork/entrypoint.sh
cd server
export DELEGATE_PRIVATE_KEY=0x…                                   # the executor's key (never commit it)
XORR_CHAIN=monad-fork npx tsx src/fork-bootstrap-evm.ts <your wallet>   # writes .env.fork

# The proof above
set -a && . ./.env.fork && set +a
createdb xorr_metropolis && DATABASE_URL=postgres://localhost:5432/xorr_metropolis npx tsx src/db/migrate.ts
PRIVY_APP_ID=… PRIVY_APP_SECRET=… DATABASE_URL=postgres://localhost:5432/xorr_metropolis npx tsx src/prove-monad.ts

# The executor, and the app against it
PRIVY_APP_ID=… PRIVY_APP_SECRET=… DATABASE_URL=… npx tsx src/index.ts   # :8787, /health, /monad/crosscheck
cd .. && npm run start:fork

# Live reads against Monad mainnet
cd server && LIVE=1 npx vitest run src/monad/monad.live.test.ts
```

Deploy to Monad testnet (needs test MON in the deployer named in `server/.env.deployer-monad`):
`cd contracts && ./deploy-testnet.sh monad-testnet`.

## Honest limits

- **Fills are on a fork.** Trades fill against Monad mainnet's real state on an anvil fork; nothing here spends real funds.
  Reference prices (Chainlink, Kuru, Perpl) are read from mainnet live, because a fork's feeds stop at the fork block.
- **Monad has no tokenized stocks** (official token list, 2026-09-24), so the Stock Token screens of the Arbitrum build
  are hidden here, and the agents trade MON and the majors.
- **Sign-in is still Privy** until Mera replaces it (`PLAN.md` P4).
- The testnet deployment waits on test MON.

## Disclosures (Metropolis rules)

**Foundation.** This repository starts from the earlier xorr builds — Base, then Solana, X Layer and Arbitrum, all made in
September 2026 by the same author. The root commit (`5681467`, "Initial commit") is that code exactly as the Arbitrum build
left it: the `XorrDelegation` and `XorrAuditAnchor` contracts, the Node executor, the agent council and the Expo app.
Everything after the root commit is the Monad work: the Monad chains, the Monad fork, the testnet deploy, Uniswap v3 on
Monad, the Kuru, Chainlink and Perpl readers, the Monad app build, and the phases in `PLAN.md`. The previous README is
`docs/archive/README-arbitrum.md`.

**AI tools.** This project is built with AI coding assistance: Claude Code (Anthropic) wrote and ran much of the code,
the tests and the on-chain proofs under the author's direction, and is credited as co-author on those commits.

## Licence

MIT — see [`LICENSE`](LICENSE).
