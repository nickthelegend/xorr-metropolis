// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// FORK ONLY. Written over GMX's oracle provider address on an anvil fork (anvil_setCode) so a fork keeper can
/// execute orders at prices it names. Adapted from gmx-synthetics `forked-env-example/contracts/mock/MockOracleProvider.sol`,
/// updated to the interface the LIVE Oracle (0x26C02F22…, solc 0.8.29, read from Blockscout 2026-09-23) calls:
/// `ValidatedPrice` has seven fields (rawMin/rawMax added) and providers answer `shouldCheckRefPrice()`. The example's
/// five-field struct makes the live Oracle revert with empty data while decoding the return value.
/// It verifies nothing: any caller can set any price. GMX's Chainlink reference-price check still applies
/// (`shouldCheckRefPrice` = true, as the real Data Streams provider answers). It must never exist on a real chain.
contract ForkOracleProvider {
    struct ValidatedPrice {
        address token;
        uint256 min;
        uint256 max;
        uint256 rawMin;
        uint256 rawMax;
        uint256 timestamp;
        address provider;
    }

    struct Props {
        uint256 min;
        uint256 max;
    }

    mapping(address => Props) public tokenPrices;

    function setPrice(address token, uint256 minPrice, uint256 maxPrice) external {
        tokenPrices[token] = Props(minPrice, maxPrice);
    }

    function setPrices(address[] calldata tokens, uint256[] calldata minPrices, uint256[] calldata maxPrices) external {
        for (uint256 i; i < tokens.length; i++) tokenPrices[tokens[i]] = Props(minPrices[i], maxPrices[i]);
    }

    function getOraclePrice(address token, bytes memory) external view returns (ValidatedPrice memory p) {
        Props memory price = tokenPrices[token];
        require(price.min != 0 && price.max != 0, "fork oracle: no price set for token");
        p = ValidatedPrice(token, price.min, price.max, price.min, price.max, block.timestamp, address(this));
    }

    function shouldAdjustTimestamp() external pure returns (bool) {
        return false;
    }

    function isChainlinkOnChainProvider() external pure returns (bool) {
        return false;
    }

    function shouldCheckRefPrice() external pure returns (bool) {
        return true;
    }
}
