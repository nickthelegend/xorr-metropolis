# Deploy later — from the owner's "go" to live in under an hour

The ordered runbook for when the owner funds the testnet keys and says go. **Nothing here has been run for this build
yet**; each step names the command that already ran in an earlier step of this project where there is one. Until "go":
no Monad testnet or mainnet transactions and no hosting (coordinator, 6 Oct).

**What goes live.** The executor on Monad testnet (real Monad transactions — Perpl, AUSD, Mera, the council), the web app
pointed at it, the Envio index of testnet, the CRE receiver with one broadcast report, and the demo video. A hosted fork
of Monad mainnet (for spot fills on Kuru and Uniswap, which testnet does not have) is optional, after the hour (§9).

**Secrets.** The owner sets every secret. Commands below read them from the gitignored env files into the shell and hand
them to the host; nobody prints them, pastes them into chat, or commits them.

| T+ | Step | Who |
|---|---|---|
| 0 | §1 Fund the keys, check balances | owner |
| 5 | §2 Preflight: pull, suites, contracts unchanged | agent |
| 10 | §3 CRE receiver deployed (the only new contract) | agent |
| 15 | §4 Railway: project, Postgres, executor | owner sets secrets, agent deploys |
| 30 | §5 Envio indexer on testnet | agent |
| 35 | §6 Web app on Vercel | agent |
| 40 | §7 CRE report broadcast | agent (after the owner's `cre login`) |
| 45 | §8 Smoke test | agent |
| 50 | §10 Video | owner records, agent edits |

## 1. Addresses and the MON each needs (owner, T+0)

Test MON from [faucet.monad.xyz](https://faucet.monad.xyz). Monad bills the gas **limit** a transaction declares, at
~102 gwei on testnet, so amounts below are padded accordingly.

| Address | Role | Key lives in | MON | What spends it |
|---|---|---|---|---|
| `0x5C1948d90570BA8547956B2Be2d3179454D22938` | deployer **and** faucet | `server/.env.deployer-monad` (`DEPLOYER_PRIVATE_KEY`), `server/.env.testnet-monad` (`FAUCET_PRIVATE_KEY`) | **2.5** | the CRE receiver (~0.12); 0.05 to each new wallet on first sign-in (`evm/gasDrip.ts`) and 0.08 more from "Get test funds" on Perps (`perpl-routes.ts`): ~0.13 a wallet, so ~15 test wallets |
| `0xEe7dc06Df9f96199D0B313E114286cD6477bc49f` | executor delegate | `server/.env.testnet-monad` (`DELEGATE_PRIVATE_KEY`) | **1.5** | Perpl desk creation (`createWithSignature`), topping each owner's Perpl operator up to 0.06 MON (`evm/agents.ts`), the hourly audit anchor |
| per-owner Perpl operators, e.g. `0x0b21B4DdcC9753878F3d8A99A2f65b964fba453f` (the 24 Sep proof desk) | xorr's operator on one owner's desk | derived from the delegate key, never stored | **0** | topped up automatically by the delegate when below 0.045 MON |
| the CRE broadcast key (`CRE_ETH_PRIVATE_KEY`) | sends the simulated `writeReport` | `cre/.env` (gitignored) | **0.05** | one report; the deployer key may be reused |

**AUSD.** "Get test funds" gives 500 AUSD from Agora's faucet, which rate-limits everyone at once; otherwise from the
faucet key's own AUSD. Claim a few thousand AUSD to `0x5C19…2938` from Agora's testnet faucet so the reserve can cover it.

**Check** (one read each, after funding — no watch loops):

```bash
for a in 0x5C1948d90570BA8547956B2Be2d3179454D22938 0xEe7dc06Df9f96199D0B313E114286cD6477bc49f; do cast balance $a --ether --rpc-url https://testnet-rpc.monad.xyz; done
```

## 2. Preflight (agent, T+5)

```bash
git pull && npm ci && (cd server && npm ci)
npx tsc --noEmit && (cd server && npx tsc --noEmit && npx vitest run) && npx vitest run
(cd contracts && forge test)
git diff --stat 5681467 -- contracts/src/XorrDelegation.sol contracts/src/XorrAuditAnchor.sol   # must be empty
```

The last line is why nothing is redeployed: `XorrDelegation` (`0x5995925de0169574365cc7f6b65f765275b0bd4b`, AUSD,
Sourcify-verified) and `XorrAuditAnchor` (`0x5a717b204c77bfba8805ffe1f382b074a3d26203`) on testnet are this source,
unchanged since the root commit (`contracts/deployments/monad-testnet.json`). If either ever changes:
`cd contracts && ./deploy-testnet.sh monad-testnet` (ran 23 Sep; deploys both, verifies on MonadVision's Sourcify,
writes the deployment record) and update `DELEGATION_ADDRESS`, `EXPO_PUBLIC_DELEGATION_ADDRESS`, `ANCHOR_ADDRESS`.

## 3. The CRE receiver (agent, T+10, ~0.12 MON)

```bash
cd contracts
set -a && . ../server/.env.deployer-monad && set +a
forge create src/XorrPriceReceiver.sol:XorrPriceReceiver \
  --constructor-args 0xB9F79d863261869B234c481D1f9A7af84AeAd192 \
  --rpc-url https://testnet-rpc.monad.xyz --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast
forge verify-contract <receiver> src/XorrPriceReceiver.sol:XorrPriceReceiver --chain 10143 --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org \
  --constructor-args "$(cast abi-encode 'constructor(address)' 0xB9F79d863261869B234c481D1f9A7af84AeAd192)"
```

`0xB9F7…D192` is CRE's simulation forwarder on testnet (`MockKeystoneForwarder`). Put the address in
`cre/mon-price/config.staging.json` → `receiver`, in `contracts/deployments/monad-testnet.json`, and in the executor's
`CRE_MON_USD_RECEIVER` (§4). A deployed workflow later writes through the production forwarder
(`0xF8344CFd5c43616a4366C34E3EEE75af79a74482`): `setForwarderAddress` on the receiver.

## 4. The executor on Railway (T+15)

**Host options.**

| Host | Fits | Against |
|---|---|---|
| **Railway** (recommended) | the repo is already shaped for it: `server/railway.json` (Railpack, `npm run migrate` before each deploy, `/health` check), `scripts/deploy-executor.mjs` (stamps the commit, uploads, waits until `/health` reports that commit); Postgres in the same project; a long-running process, which the scheduler and the 30 s Perpl exit guard need; the owner's other xorr executors run there | usage billing (Hobby, ~$5/month at this load) |
| Fly.io | long-running, close to users | no Dockerfile for `server/` yet; Postgres separate; more setup inside the hour |
| Render | simple web service + Postgres | the free tier sleeps after 15 idle minutes, which stops the scheduler and the exit guard; paid tier needed |
| Vercel / serverless | — | not possible: the executor runs a scheduler loop and the exit guard between requests |
| A VPS (Hetzner, docker compose) | cheapest | ops (TLS, restarts, backups) inside the hour |

**Recommendation: Railway**, in a **new** project `xorr-metropolis`. None exists today (checked 6 Oct). Never reuse or
touch the other xorr projects (`xorr-arbitrum`, `xorr-xlayer`, `xorr-solana`, and the production `api.xorr.finance` one).

```bash
railway init --name xorr-metropolis                         # prints the project id → XORR_RAILWAY_PROJECT
railway add --database postgres
railway add --service executor-monad-testnet
railway domain --service executor-monad-testnet             # → XORR_EXECUTOR_URL=https://…up.railway.app
```

Variables — the owner runs this block; values come from the gitignored file and are never echoed:

```bash
P="--project $XORR_RAILWAY_PROJECT --environment production --service executor-monad-testnet --skip-deploys"
set -a && . server/.env.testnet-monad && set +a
for kv in "XORR_CHAIN=monad-testnet" "PRIVY_APP_ID=$PRIVY_APP_ID" "PRIVY_APP_SECRET=$PRIVY_APP_SECRET" \
          "DELEGATE_PRIVATE_KEY=$DELEGATE_PRIVATE_KEY" "FAUCET_PRIVATE_KEY=$FAUCET_PRIVATE_KEY" \
          "DELEGATION_ADDRESS=$DELEGATION_ADDRESS" "ANCHOR_ADDRESS=$ANCHOR_ADDRESS" \
          'DATABASE_URL=${{Postgres.DATABASE_URL}}' "XORR_SESSION_SECRET=$(openssl rand -hex 32)"; do
  railway variable set "$kv" $P
done
railway variable set "CRE_MON_USD_RECEIVER=<§3 address>" $P
railway variable set "ALLOWED_ORIGINS=<the web origin from §6>" $P          # after §6; CORS is open until set
railway variable set "MOONSHOT_API_KEY=…" $P                                 # optional: seats Kimi as the Strategist
```

| Variable | Required | Where it comes from |
|---|---|---|
| `XORR_CHAIN` | yes | `monad-testnet` |
| `DATABASE_URL` | yes | Railway's Postgres reference |
| `DELEGATE_PRIVATE_KEY`, `FAUCET_PRIVATE_KEY` | yes | `server/.env.testnet-monad` |
| `DELEGATION_ADDRESS`, `ANCHOR_ADDRESS` | yes | `server/.env.testnet-monad` (the testnet deployment) |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | yes | `server/.env.testnet-monad` (email sign-in beside the passkey) |
| `XORR_SESSION_SECRET` | recommended | random; without it the session MAC derives from the delegate key |
| `ALLOWED_ORIGINS` | recommended | the web app's origin |
| `CRE_MON_USD_RECEIVER` | for the CRE price | §3 |
| `MOONSHOT_API_KEY` | optional | the owner's Moonshot key; without it the Council says "not configured" |

Deploy and wait for the commit to be live (ran for the earlier xorr executors):

```bash
XORR_RAILWAY_PROJECT=<id> XORR_EXECUTOR_URL=https://<domain> node scripts/deploy-executor.mjs executor-monad-testnet
```

## 5. The Envio indexer (agent, T+30)

A second Railway service in the same project, writing into the same Postgres (schema `envio`); `GET /indexed` on the
executor reads it. Node 22 (Envio 3).

```bash
railway add --service envio-monad-testnet            # root directory: indexer/, start command: npx envio start
```

| Variable | Value |
|---|---|
| `ENVIO_CHAIN_ID` | `10143` |
| `ENVIO_RPC_URL` | `https://testnet-rpc.monad.xyz` |
| `ENVIO_START_BLOCK` | `65123156` (the delegation's deploy block) |
| `ENVIO_DELEGATION` / `ENVIO_ANCHOR` | `0x5995925de0169574365cc7f6b65f765275b0bd4b` / `0x5a717b204c77bfba8805ffe1f382b074a3d26203` |
| `ENVIO_PERPL_FACTORY` | `0xf42548Ccb3300Bc76c35dc2D347416db2E8d7209` (Perpl testnet) |
| `ENVIO_PG_HOST/PORT/USER/PASSWORD/DATABASE` | Railway Postgres references (`${{Postgres.PGHOST}}` …) |
| `ENVIO_PG_SCHEMA`, `ENVIO_HASURA`, `ENVIO_TUI` | `envio`, `false`, `false` |
| `ENVIO_API_TOKEN` | optional, see below |

**Sync speed is unmeasured on testnet.** RPC sync from block 65,123,156 covers ~3M blocks by mid-October. With the owner's
Envio API token, change `for: sync` to `for: fallback` in `indexer/config.yaml` so HyperSync carries the sync and the RPC
only backs it up. Envio Cloud instead of Railway is a hosting deploy of its own; the owner decides.

## 6. The web app on Vercel (agent, T+35)

```bash
XORR_WEB_API=https://<executor domain> node scripts/build-web.mjs     # refuses unless the executor answers; pins the delegation; names the commit
cd dist-web && vercel link --project xorr-metropolis && vercel deploy --prod
```

The build reads the chain from the executor's `/health` and takes Monad testnet's public RPC. Then set
`ALLOWED_ORIGINS` (§4) to the deployed origin.

**Passkeys follow the domain.** On the web a passkey belongs to the page's host, so the passkeys made on the hosted app
are separate from any made on localhost. For Mera on the phone the same domain must serve
`docs/passkey-domain/.well-known/*` (Apple team id and Android signing fingerprint filled in) — `xorr.finance` is served
by the Vercel project `xorr-landing` from the xorr-eth repo, so that is the owner's call; a custom domain on this Vercel
project works as well (`EXPO_PUBLIC_MERA_RP_ID` = that domain in the development build).

## 7. The CRE report (agent, T+40; needs the owner's `cre login` once)

```bash
cd cre/mon-price && bun install && bun test
cd .. && cre workflow simulate ./mon-price --target staging-settings --trigger-index 0              # dry run
cre workflow simulate ./mon-price --target staging-settings --trigger-index 0 --broadcast           # writes the report on testnet
cast call <receiver> 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' --rpc-url https://testnet-rpc.monad.xyz
cast call <receiver> 'halted()(bool)' --rpc-url https://testnet-rpc.monad.xyz
```

Then the next council round's price desk names the CRE price as MON's reference (`council/monad-inputs.ts`).

## 8. Post-deploy smoke test (T+45, ~10 minutes)

```bash
API=https://<executor domain>
curl -s $API/health                    # chain monad-testnet, the commit just deployed, database ok
curl -s $API/monad/crosscheck          # MON from Uniswap, Kuru and Chainlink on mainnet, 3 sources agreeing
curl -s $API/monad/perpl | head -c 400 # Perpl testnet markets
curl -s $API/council/seats             # strategist: configured true/false
psql "$RAILWAY_DATABASE_URL" -c 'SELECT latest_processed_block, block_height FROM envio.chain_metadata'   # Envio caught up
cd server && set -a && . ./.env.testnet-monad && set +a && npx tsx src/prove-perpl-desk.ts   # ran 24 Sep: desk, long, close, operator removed, withdraw
```

Then in a browser at 375 px on the hosted app, console open: create a passkey account → "Get test funds" on Perps →
grant → create the Perpl desk → long MON → close → a council round (the price desk names the CRE price) → History shows
the indexed record → hold to stop. Every step must show
its result with no console error and no response ≥ 400. (The e2e specs in `e2e/web/` drive the fork's faucet and its
WMON market, so on testnet this pass is by hand; on a hosted fork, §9, they run as they are.)

## 9. Optional: a hosted fork of Monad mainnet (after the hour)

The full spot product — Kuru against Uniswap per order — needs mainnet state. Three more services in the same project:
`monad-fork` (`infra/monad-fork/Dockerfile`, a volume at `/data`, `REFORKED_AT` to take a new fork), `executor-monad-fork`
(`XORR_CHAIN=monad-fork`, `FORK_RPC` = the fork's private URL, `PERPL_FORK_KEEPER=1`), and a `perpl-keeper` worker
(`npx tsx src/fork/perpl-keeper.ts` in `server/`). Bootstrap once: `cd server && FORK_RPC=<public fork URL> npm run
rebuild:fork`. A second web build with `XORR_WEB_API=<fork executor>` and `EXPO_PUBLIC_PERPL_FORK=1`. Then
`WEB=… API=… npm run e2e:fork` and `npm run e2e:crawl` run against it unchanged. No MON: a fork is test money.

## 10. Video shot list (≤ 3:00, real Monad)

`npm run demo:record` (`e2e/web/record-demo.mjs`) already records beats 1–9 and 11 from the fork, captioned, with the
waits cut (`docs/demo/xorr-monad-fork-demo.mp4`, 1:39); pointed at the hosted testnet build it records the same there.
Recorded on the hosted testnet app (and the local or hosted fork for the Kuru beat), 1080 × 1920 phone frame or
1280 × 800 browser, captions in the frame, no music needed. The script with words is in `SUBMISSION.md`.

| # | Time | Shot | Proves |
|---|---|---|---|
| 1 | 0:00 | Home, the one-line pitch | the product |
| 2 | 0:12 | Create a passkey account; the address appears | Mera account layer |
| 3 | 0:30 | Test funds, the permission screen ($/day, end date, venues), signed with no popup; the timer | Mera TTFT, session design |
| 4 | 0:50 | Storage cleared → "Sign in with a passkey" → the same address | Mera stateless test |
| 5 | 1:02 | (fork) Buy $20 of MON; the run: "Kuru measured … Uniswap would have delivered …" | Kuru routing |
| 6 | 1:22 | Council round: four desks' readings, the vote, "Executed"; Kimi's seat | the council, Kimi |
| 7 | 1:42 | Perps: AUSD balance, the Perpl desk (DelegatedAccount), long MON 1x, position with liquidation distance | Agora AUSD, Perpl |
| 8 | 2:02 | Exit rules on the desk; `/perpl` risk screen | Perpl API, Perpl risk |
| 9 | 2:20 | History: "Indexed by Envio" card | Envio |
| 10 | 2:30 | Terminal: `mm perpl markets`; the CRE report tx on MonadVision | MetaMask plugin, CRE |
| 11 | 2:42 | Hold to stop; the explorer shows the revoke and `removeOperator` | revocable on chain |
| 12 | 2:55 | Repo URL, "MIT, built with Claude Code" | rules |

Edit: cut waits for confirmations to a second each; keep every on-chain result on screen ≥ 2 s. Export H.264 MP4, upload
public (YouTube unlisted or Loom), put the link in the README and the portal.

## 11. After go-live

- `docs/SUBMISSION.md`: replace each "live step left" with the transaction hashes and links.
- `README.md` Deployments: the executor, web, indexer and receiver addresses.
- Register (by **Oct 6 23:59 UTC**) and submit on hackathon.monad.xyz before **Oct 13 23:59 ET**, one entry per bounty
  with the fields in `SUBMISSION.md`.
