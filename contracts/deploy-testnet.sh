#!/usr/bin/env bash
# Deploy XorrDelegation + XorrAuditAnchor to a real Arbitrum-family testnet (PLAN.md P5).
#
#   ./deploy-testnet.sh arbitrum-sepolia     # chain 421614, settlement = Circle's test USDC
#   ./deploy-testnet.sh robinhood-testnet    # chain 46630, settlement = xorr's TestUSDC, deployed first
#
# Robinhood Chain testnet has no canonical USDG (its explorer lists a dozen unofficial "USDG"/"USDC" tokens), so there the
# settlement token is xorr's own openly-mintable TestUSDC — deployed here, labelled test money everywhere it is shown, and
# handed to the executor as ROBINHOOD_TESTNET_SETTLEMENT.
#
# Reads DEPLOYER_PRIVATE_KEY/DEPLOYER_ADDRESS from ../server/.env.deployer-arbitrum (gitignored, never printed). Refuses to
# run while the deployer holds no ETH on the target chain, and writes deployments/<network>.json from Foundry's broadcast
# receipts (never from stdout — forge prints "deployed to" in simulation too).
set -euo pipefail
cd "$(dirname "$0")"

NETWORK="${1:?usage: ./deploy-testnet.sh arbitrum-sepolia|robinhood-testnet}"
case "$NETWORK" in
  arbitrum-sepolia)
    RPC="${ARBITRUM_SEPOLIA_RPC:-https://sepolia-rollup.arbitrum.io/rpc}"; CHAIN=421614
    SETTLEMENT="0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"; EXPLORER="https://sepolia.arbiscan.io/address" ;;
  robinhood-testnet)
    RPC="${ROBINHOOD_TESTNET_RPC:-https://rpc.testnet.chain.robinhood.com}"; CHAIN=46630
    SETTLEMENT=""; EXPLORER="https://explorer.testnet.chain.robinhood.com/address" ;;
  *) echo "unknown network $NETWORK"; exit 1 ;;
esac

set -a; . ../server/.env.deployer-arbitrum; set +a
: "${DEPLOYER_PRIVATE_KEY:?server/.env.deployer-arbitrum has no DEPLOYER_PRIVATE_KEY}"
: "${DEPLOYER_ADDRESS:?server/.env.deployer-arbitrum has no DEPLOYER_ADDRESS}"
export DEPLOYER_PRIVATE_KEY

[ "$(cast chain-id --rpc-url "$RPC")" = "$CHAIN" ] || { echo "$RPC is not chain $CHAIN"; exit 1; }
BAL=$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC")
if [ "$BAL" = "0" ]; then
  echo "Deployer $DEPLOYER_ADDRESS holds no ETH on $NETWORK ($CHAIN). Fund it from a faucet, then re-run."
  exit 2
fi
echo "deployer $DEPLOYER_ADDRESS  balance $(cast from-wei "$BAL") ETH on $NETWORK"

receipt() { # script-dir field
  python3 -c "import json;r=json.load(open('broadcast/$1/$CHAIN/run-latest.json'))['receipts'][0];assert int(r['status'],16)==1,'reverted';print(r['$2'] if '$2'!='blockNumber' else int(r['blockNumber'],16))"
}
wait_nonce() { for _ in $(seq 1 30); do [ "$(cast nonce "$DEPLOYER_ADDRESS" --rpc-url "$RPC")" -ge "$1" ] && return 0; sleep 2; done; echo "nonce never reached $1"; exit 1; }

TEST_TOKEN_JSON=""
if [ -z "$SETTLEMENT" ]; then
  START=$(cast nonce "$DEPLOYER_ADDRESS" --rpc-url "$RPC")
  forge script script/DeployTestUSDC.s.sol:DeployTestUSDC --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --slow
  wait_nonce $((START + 1))
  SETTLEMENT=$(receipt DeployTestUSDC.s.sol contractAddress)
  TEST_TOKEN_JSON="\"TestUSDC\": { \"address\": \"$SETTLEMENT\", \"deployTx\": \"$(receipt DeployTestUSDC.s.sol transactionHash)\", \"note\": \"xorr's openly-mintable test settlement token\" },"
fi

START=$(cast nonce "$DEPLOYER_ADDRESS" --rpc-url "$RPC")
SETTLEMENT_TOKEN="$SETTLEMENT" forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --slow
wait_nonce $((START + 1))
forge script script/DeployAnchor.s.sol:DeployAnchor --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --slow
DELEGATION=$(receipt Deploy.s.sol contractAddress); DELEGATION_TX=$(receipt Deploy.s.sol transactionHash); DELEGATION_BLOCK=$(receipt Deploy.s.sol blockNumber)
ANCHOR=$(receipt DeployAnchor.s.sol contractAddress); ANCHOR_TX=$(receipt DeployAnchor.s.sol transactionHash); ANCHOR_BLOCK=$(receipt DeployAnchor.s.sol blockNumber)
for a in "$DELEGATION" "$ANCHOR"; do [ "$(cast code "$a" --rpc-url "$RPC")" != "0x" ] || { echo "no code at $a"; exit 1; }; done

cat > "deployments/$NETWORK.json" <<JSON
{
  "network": "$NETWORK",
  "chainId": $CHAIN,
  "deployer": "$DEPLOYER_ADDRESS",
  "sourceCommit": "$(git rev-parse HEAD)",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "contracts": {
    $TEST_TOKEN_JSON
    "XorrDelegation": { "address": "$DELEGATION", "deployTx": "$DELEGATION_TX", "blockNumber": $DELEGATION_BLOCK, "constructorArgs": { "settlementToken": "$SETTLEMENT" } },
    "XorrAuditAnchor": { "address": "$ANCHOR", "deployTx": "$ANCHOR_TX", "blockNumber": $ANCHOR_BLOCK }
  },
  "explorer": "$EXPLORER/$DELEGATION"
}
JSON
echo
echo "DELEGATION_ADDRESS=$DELEGATION"
echo "ANCHOR_ADDRESS=$ANCHOR"
[ "$NETWORK" = robinhood-testnet ] && echo "ROBINHOOD_TESTNET_SETTLEMENT=$SETTLEMENT"
echo "wrote deployments/$NETWORK.json"
