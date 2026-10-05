# End-to-end flows — PLAN.md 13.10

Maestro flows for the five journeys that matter. Run against a simulator with the app installed:

```bash
brew install maestro
npx expo run:ios          # or run:android
maestro test e2e/
```

These are the flows where a bug costs money, so each one asserts an OUTCOME, not just that a
screen rendered:

| Flow | What it proves |
|---|---|
| `01-onboarding.yaml` | install -> wallet -> funded -> delegation granted |
| `02-dca.yaml` | a recurring buy is created, appears under Strategies, and lands in Activity |
| `03-proposal.yaml` | approve -> the buttons are replaced by a fill bubble -> an audit row exists |
| `04-kill-switch.yaml` | stop -> the Bot tab dot goes dark, and the state survives a relaunch |
| `05-expiry.yaml` | an untouched proposal expires and posts a system line rather than filling |

The server-side halves of these — that a revoked delegation actually blocks a run, that a retry
cannot double-fill — are proven directly against Postgres and a real Solana runtime in
`server/src/executor/executor.chain.test.ts`, because those assertions are about state the UI
cannot see.

## Web, on a local fork of Monad mainnet (`e2e/web/`)

`fork-journey.mjs` drives the whole product in Chromium with a WebAuthn virtual authenticator that has PRF (the stand-in
for iCloud Keychain or Google Password Manager): a Mera passkey account, the fork faucet, the trading permission signed by
Mera's signing session, a WMON buy and the run that says which venue filled it and what the other would have delivered,
an AUSD balance and a Perpl desk, a long and its close, and the hold-to-stop — read back from the chain at the end. It
fails on any console error.

```bash
FORK_DATA_DIR=… PORT=8561 sh infra/monad-fork/entrypoint.sh                              # the fork
cd server && set -a && . ./.env.local-monad && set +a && FORK_RPC=http://127.0.0.1:8561 OWNER_ADDRESS=0x… npm run rebuild:fork
FORK_RPC=http://127.0.0.1:8561 npx tsx src/fork/perpl-keeper.ts                         # Perpl's marks, every 5 s
set -a && . ./.env.local-monad && . ./.env.fork && set +a && PORT=8790 npx tsx src/index.ts
cd .. && set -a && . server/.env.fork && set +a && EXPO_PUBLIC_API_URL=http://localhost:8790 npx expo start --web --port 8092
WEB=http://localhost:8092 API=http://localhost:8790 npm run e2e:fork
```
