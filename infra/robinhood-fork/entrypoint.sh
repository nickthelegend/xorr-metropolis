#!/bin/sh
#
# The Robinhood Chain node behind the Robinhood executor, kept across restarts.
#
# Robinhood Chain's public RPC is not an archive node: it keeps state for about 10 minutes (~6,100 blocks, measured
# 2026-09-23). A fork pinned to a block can load an account it has not touched only inside that window, so a long-lived
# fork of the public RPC breaks for every new address after ten minutes. Two modes, therefore:
#
#   SNAPSHOT (default) — `snapshot.json` is Robinhood Chain's real state from block 70254193 (2026-09-23T05:12Z), captured by
#     `server/src/fork/warm-robinhood.ts` inside the window: USDG, WETH, Uniswap v3 factory/quoter/router, the NVDA, TSLA,
#     AAPL and SPY Stock Tokens with their ERC-8056 multipliers, their Chainlink feeds, every funded Stock Token/USDG pool
#     (quoted to $50,000 each way so every tick a demo trade crosses is loaded), plus xorr's contracts — re-dumped from
#     the hosted node at block 70262696 with the individual-agents XorrDelegation(USDG) at
#     0x67c5457d013afa27f375c07edb94f950b2e40f4f and its anchor at 0x7471e022b3167da11d6ff47f73800b6e9860b67a (the first
#     deployment, 0x60b0…78cb, is there too). anvil serves it
#     with no upstream at all; a slot the snapshot never loaded reads as zero, which is right for every new wallet.
#   FORK — with ROBINHOOD_ARCHIVE_RPC set (an archive endpoint, e.g. Alchemy's), anvil forks live and pins the block, as
#     the Arbitrum node does.
#
# Either way anvil saves the chain to the volume and a restart resumes it. A new REFORKED_AT drops the saved chain.
set -eu

DATA="${FORK_DATA_DIR:-/data}"
STATE="$DATA/fork-state.json"
BLOCK_FILE="$DATA/fork-block"
MARK="$DATA/reforked-at"
mkdir -p "$DATA"

if [ "$(cat "$MARK" 2>/dev/null || true)" != "${REFORKED_AT:-}" ]; then
  [ -e "$STATE" ] && echo "node: REFORKED_AT changed, dropping the saved chain"
  rm -f "$STATE" "$BLOCK_FILE"
fi
printf '%s' "${REFORKED_AT:-}" > "$MARK"

if [ -n "${ROBINHOOD_ARCHIVE_RPC:-}" ]; then
  if [ ! -s "$BLOCK_FILE" ]; then
    cast block-number --rpc-url "$ROBINHOOD_ARCHIVE_RPC" > "$BLOCK_FILE.tmp"
    mv "$BLOCK_FILE.tmp" "$BLOCK_FILE"
  fi
  echo "node: forking Robinhood Chain at block $(cat "$BLOCK_FILE") from the archive RPC"
  set -- --fork-url "$ROBINHOOD_ARCHIVE_RPC" --fork-block-number "$(cat "$BLOCK_FILE")" --no-rate-limit
else
  if [ ! -s "$STATE" ]; then
    cp /opt/robinhood/snapshot.json "$STATE"
    echo "node: starting from the Robinhood Chain snapshot (block 70262696)"
  else
    echo "node: resuming the saved chain"
  fi
fi

anvil \
  --host 0.0.0.0 --port "${PORT:-8545}" \
  --chain-id 4663 --accounts 10 --balance 10000 --silent \
  --block-time "${BLOCK_TIME_SEC:-12}" \
  --state "$STATE" --state-interval "${STATE_INTERVAL_SEC:-30}" "$@" &
ANVIL=$!

trap 'kill -TERM "$ANVIL" 2>/dev/null; wait "$ANVIL"; exit 0' TERM INT

# Keep the chain's clock on the wall clock (see infra/arbitrum-fork/entrypoint.sh for why): forwards only.
RPC="http://127.0.0.1:${PORT:-8545}"
align() {
  CHAIN_NOW="$(cast block latest -f timestamp --rpc-url "$RPC" 2>/dev/null)" || return 0
  WALL_NOW="$(date +%s)"
  if [ "$((WALL_NOW - CHAIN_NOW))" -gt "${CLOCK_SLACK_SEC:-15}" ]; then
    cast rpc evm_setNextBlockTimestamp "$WALL_NOW" --rpc-url "$RPC" >/dev/null 2>&1 &&
      echo "node: clock was $((WALL_NOW - CHAIN_NOW))s behind, set the next block to $WALL_NOW"
  fi
}
until cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; do
  kill -0 "$ANVIL" 2>/dev/null || { wait "$ANVIL"; exit $?; }
  sleep 1
done
align
while kill -0 "$ANVIL" 2>/dev/null; do
  sleep "${CLOCK_CHECK_SEC:-60}" & wait $!
  align
done
wait "$ANVIL"
