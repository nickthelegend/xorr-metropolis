// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {XorrPriceReceiver} from "../src/XorrPriceReceiver.sol";
import {ReceiverTemplate} from "../src/cre/ReceiverTemplate.sol";
import {IReceiver} from "../src/cre/IReceiver.sol";

contract XorrPriceReceiverTest is Test {
    // CRE's simulation forwarder on Monad testnet (MockKeystoneForwarder), the one `cre workflow simulate --broadcast` uses.
    address constant FORWARDER = 0xB9F79d863261869B234c481D1f9A7af84AeAd192;
    XorrPriceReceiver receiver;

    function setUp() public {
        receiver = new XorrPriceReceiver(FORWARDER);
    }

    function report(int256 answer, uint8 sources, uint16 spread, uint16 gap, bool halt, uint64 observedAt) internal pure returns (bytes memory) {
        return abi.encode(answer, sources, spread, gap, halt, observedAt);
    }

    function test_storesAReportFromTheForwarder() public {
        vm.prank(FORWARDER);
        receiver.onReport("", report(3_235_700, 3, 14, 22, false, 1_791_200_000));
        (uint80 round, int256 answer,, uint256 updatedAt,) = receiver.latestRoundData();
        assertEq(round, 1);
        assertEq(answer, 3_235_700);
        assertEq(updatedAt, 1_791_200_000);
        assertEq(receiver.decimals(), 8);
        assertFalse(receiver.halted());
        XorrPriceReceiver.Observation memory o = receiver.latestObservation();
        assertEq(o.sources, 3);
        assertEq(o.spreadBps, 14);
        assertEq(o.anchorGapBps, 22);
    }

    function test_refusesAnyoneButTheForwarder() public {
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidSender.selector, address(this), FORWARDER));
        receiver.onReport("", report(3_235_700, 3, 14, 22, false, 1_791_200_000));
    }

    function test_roundsOnlyMoveForward() public {
        vm.startPrank(FORWARDER);
        receiver.onReport("", report(3_235_700, 3, 14, 22, false, 1_791_200_000));
        vm.expectRevert(abi.encodeWithSelector(XorrPriceReceiver.StaleReport.selector, uint64(1_791_200_000), uint64(1_791_200_000)));
        receiver.onReport("", report(3_300_000, 3, 14, 22, false, 1_791_200_000));
        receiver.onReport("", report(3_300_000, 3, 14, 22, false, 1_791_200_300));
        vm.stopPrank();
        assertEq(receiver.latestRound(), 2);
        (, int256 first,,,) = receiver.getRoundData(1);
        assertEq(first, 3_235_700);
    }

    function test_aHaltIsStoredAndSaid() public {
        vm.prank(FORWARDER);
        receiver.onReport("", report(3_235_700, 3, 14, 480, true, 1_791_200_000));
        assertTrue(receiver.halted());
    }

    function test_noPriceIsOnlyAcceptedAsAHalt() public {
        vm.startPrank(FORWARDER);
        vm.expectRevert(XorrPriceReceiver.NoPrice.selector);
        receiver.onReport("", report(0, 1, 0, 0, false, 1_791_200_000));
        receiver.onReport("", report(0, 1, 0, 0, true, 1_791_200_000));
        vm.stopPrank();
        assertTrue(receiver.halted());
    }

    function test_nothingToReadBeforeTheFirstReport() public {
        vm.expectRevert(XorrPriceReceiver.NoRound.selector);
        receiver.latestRoundData();
        assertFalse(receiver.halted());
    }

    function test_saysItIsAReceiver() public view {
        assertTrue(receiver.supportsInterface(type(IReceiver).interfaceId));
    }
}
