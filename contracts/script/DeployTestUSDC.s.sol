// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

/// @notice Deploys xorr's openly-mintable 6-decimal test settlement token (testnets without a canonical USDG/USDC).
contract DeployTestUSDC is Script {
    function run() external returns (TestUSDC token) {
        vm.startBroadcast();
        token = new TestUSDC();
        vm.stopBroadcast();
        console.log("TestUSDC deployed to:", address(token));
    }
}
