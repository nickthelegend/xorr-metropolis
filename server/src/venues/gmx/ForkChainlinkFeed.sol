// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// FORK ONLY. Written over a Chainlink price feed address on an anvil fork (anvil_setCode) when the fork's copy of the
/// feed has gone stale past GMX's heartbeat, which makes GMX's Oracle refuse every price with ChainlinkPriceFeedNotUpdated.
/// The fork keeper sets the answer to the same live GMX price it executes at; the timestamp is always the block's.
/// Storage lives at a hashed slot so it cannot be mistaken for the proxy's own layout. It must never exist on a real chain.
contract ForkChainlinkFeed {
    bytes32 private constant SLOT = keccak256("xorr.fork.chainlink-feed");

    struct Data {
        int256 answer;
        uint8 decimals;
    }

    function _data() private pure returns (Data storage d) {
        bytes32 s = SLOT;
        assembly {
            d.slot := s
        }
    }

    function setAnswer(int256 answer, uint8 decimals_) external {
        Data storage d = _data();
        d.answer = answer;
        d.decimals = decimals_;
    }

    function decimals() external view returns (uint8) {
        return _data().decimals;
    }

    function description() external pure returns (string memory) {
        return "xorr fork feed (live GMX price, fork only)";
    }

    function latestAnswer() external view returns (int256) {
        return _data().answer;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, _data().answer, block.timestamp, block.timestamp, 1);
    }
}
