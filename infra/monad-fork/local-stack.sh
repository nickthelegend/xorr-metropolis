#!/bin/sh
#
# The whole local stack on a fork of Monad mainnet, one command (2026-10-06): the fork, our contracts and the owner's
# grant on it, the Perpl keeper, the executor, the Envio indexer and the web app. Only processes this script started are
# ever stopped (their PIDs are kept in $STATE/pids); other projects' anvils and indexers on this machine are left alone.
#
#   sh infra/monad-fork/local-stack.sh up        # start whatever is not running
#   sh infra/monad-fork/local-stack.sh down      # stop what this script started
#   sh infra/monad-fork/local-stack.sh refork    # down, then fork Monad again at the head and rebuild everything on it
#
# Re-fork when the live price has moved away from the fork's (MON moves a percent or two in an hour): the price gate
# compares fills on the fork's pools with Chainlink read live from mainnet, and refuses past 150 bps — correctly.
#
# Needs: server/.env.local-monad (DATABASE_URL, DELEGATE_PRIVATE_KEY, PRIVY_*), Postgres, Node 22 under nvm for Envio.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="${FORK_DATA_DIR:-$ROOT/../.monad-fork-data}"
PIDS="$STATE/pids"
LOGS="$STATE/logs"
FORK_PORT="${FORK_PORT:-8561}"
API_PORT="${API_PORT:-8790}"
WEB_PORT="${WEB_PORT:-8092}"
OWNER="${OWNER_ADDRESS:-0xB85A831a94150009Dc0F7AA24803370e1Bb0E897}"
NODE22="${NODE22:-$HOME/.nvm/versions/node/v22.22.2/bin}"
RPC="http://127.0.0.1:$FORK_PORT"
mkdir -p "$PIDS" "$LOGS"

running() { [ -s "$PIDS/$1" ] && kill -0 "$(cat "$PIDS/$1")" 2>/dev/null; }
start() { # name, command...
  name=$1; shift
  if running "$name"; then echo "$name: running ($(cat "$PIDS/$name"))"; return; fi
  # Detached from the caller entirely (stdin, stdout, stderr), so a pipe the script's output feeds is never held open.
  (cd "$ROOT" && nohup sh -c "$*" < /dev/null > "$LOGS/$name.log" 2>&1 & echo $! > "$PIDS/$name") < /dev/null > /dev/null 2>&1
  echo "$name: started ($(cat "$PIDS/$name")), log $LOGS/$name.log"
}
stop() {
  if running "$1"; then
    pid=$(cat "$PIDS/$1")
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    echo "$1: stopped"
  fi
  rm -f "$PIDS/$1"
}
wait_for() { # url, seconds
  i=0
  while [ $i -lt "$2" ]; do curl -s -o /dev/null "$1" && return 0; i=$((i + 1)); sleep 1; done
  echo "timed out waiting for $1" >&2; return 1
}

up() {
  start fork "FORK_DATA_DIR='$STATE' PORT=$FORK_PORT REFORKED_AT='${REFORKED_AT:-}' sh infra/monad-fork/entrypoint.sh"
  wait_for "$RPC" 120
  if [ "${REBUILD:-0}" = 1 ] || [ ! -s "$ROOT/server/.env.fork" ] || ! grep -q "FORK_RPC=$RPC" "$ROOT/server/.env.fork"; then
    (cd "$ROOT/server" && set -a && . ./.env.local-monad && set +a && FORK_RPC=$RPC XORR_CHAIN=monad-fork OWNER_ADDRESS=$OWNER FORK_GRANT_CAP_USD=1600 npm run rebuild:fork)
  fi
  start keeper "cd server && FORK_RPC=$RPC npx tsx src/fork/perpl-keeper.ts"
  start executor "cd server && set -a && . ./.env.local-monad && . ./.env.fork && set +a && FORK_RPC=$RPC PORT=$API_PORT npx tsx src/index.ts"
  wait_for "http://localhost:$API_PORT/health" 120
  # The indexer follows the fork's addresses; a new fork is a new chain history, so its schema starts over.
  . "$ROOT/server/.env.fork"
  start indexer "cd indexer && export PATH='$NODE22':\$PATH && set -a && . ./.env.example && set +a && ENVIO_RPC_URL=$RPC ENVIO_START_BLOCK=\$(cat '$STATE/fork-block') ENVIO_DELEGATION=$DELEGATION_ADDRESS ENVIO_ANCHOR=$ANCHOR_ADDRESS ENVIO_KURU_VENUE=${KURU_VENUE_ADDRESS:-} npx envio start"
  start web "set -a && . server/.env.fork && set +a && EXPO_PUBLIC_API_URL=http://localhost:$API_PORT EXPO_PUBLIC_CHAIN_RPC=$RPC CI=1 npx expo start --web --port $WEB_PORT --clear"
  wait_for "http://localhost:$WEB_PORT" 180
  echo "up: fork $RPC · executor http://localhost:$API_PORT · web http://localhost:$WEB_PORT"
}

down() {
  for s in web indexer executor keeper fork; do stop "$s"; done
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  refork)
    down
    sleep 2
    # A new fork is a new chain history: the old fork's index and its Perpl desks (contracts that no longer exist) go.
    psql "${DATABASE_URL:-postgres://localhost:5432/xorr_metropolis}" -qc 'DROP SCHEMA IF EXISTS envio CASCADE' || true
    psql "${DATABASE_URL:-postgres://localhost:5432/xorr_metropolis}" -qc "DELETE FROM perpl_desks WHERE chain = 'monad-fork'" || true
    REFORKED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" REBUILD=1 up
    ;;
  *) echo "usage: $0 up|down|refork" >&2; exit 2 ;;
esac
