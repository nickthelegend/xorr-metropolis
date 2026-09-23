// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {XorrDelegation} from "../src/XorrDelegation.sol";
import {MockUSDC, MockVenue} from "./XorrDelegation.t.sol";

/// Individual agents: each agent is its own wallet with its own permission, cap and daily tally from the same owner.
contract XorrDelegationAgentsTest is Test {
    XorrDelegation internal del;
    MockUSDC internal usdc;
    MockUSDC internal asset;
    MockVenue internal venue;

    address internal owner = address(0xA11CE);
    address internal scout = address(0x5C0);
    address internal keeper = address(0xCEE);
    address internal stranger = address(0xBAD);

    uint256 internal constant USD = 1e6;

    event Spent(address indexed owner, address indexed delegate, address indexed venue, address token, uint256 amount, uint256 spentToday);
    event Revoked(address indexed owner, address indexed delegate);

    function setUp() public {
        usdc = new MockUSDC();
        asset = new MockUSDC();
        del = new XorrDelegation(address(usdc));
        venue = new MockVenue(usdc, asset, del);
        usdc.mint(owner, 10_000 * USD);
        address[] memory venues = new address[](1);
        venues[0] = address(venue);
        vm.startPrank(owner);
        usdc.approve(address(del), type(uint256).max);
        del.grant(scout, 100 * USD, uint64(block.timestamp + 3 days), venues);
        del.grantAgent(keeper, 30 * USD, uint64(block.timestamp + 1 days));
        vm.stopPrank();
    }

    function _buyAs(address agent, uint256 amount) internal {
        vm.prank(agent);
        del.spend(owner, address(usdc), address(venue), amount, address(asset), amount,
            abi.encodeWithSelector(MockVenue.swap.selector, amount, owner, amount));
    }

    function test_EachAgentHasItsOwnPolicy() public view {
        (uint256 capS, uint64 expS, bool revS, bool stopped) = del.agentPolicyOf(owner, scout);
        (uint256 capK, uint64 expK, bool revK,) = del.agentPolicyOf(owner, keeper);
        assertEq(capS, 100 * USD);
        assertEq(capK, 30 * USD);
        assertGt(expS, expK);
        assertFalse(revS || revK || stopped);
        address[] memory agents = del.agentsOf(owner);
        assertEq(agents.length, 2);
        assertEq(agents[0], scout);
        assertEq(agents[1], keeper);
    }

    function test_EachAgentSpendsAgainstItsOwnCap() public {
        _buyAs(scout, 80 * USD);
        _buyAs(keeper, 30 * USD); // the scout's spending does not use up the keeper's cap
        assertEq(del.spentTodayBy(owner, scout), 80 * USD);
        assertEq(del.spentTodayBy(owner, keeper), 30 * USD);
        assertEq(del.remainingTodayFor(owner, scout), 20 * USD);
        assertEq(del.remainingTodayFor(owner, keeper), 0);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(XorrDelegation.DailyCapExceeded.selector, 1 * USD, 0));
        del.spend(owner, address(usdc), address(venue), 1 * USD, address(asset), 1 * USD,
            abi.encodeWithSelector(MockVenue.swap.selector, 1 * USD, owner, 1 * USD));
    }

    function test_TheSpendEventNamesTheAgentThatSigned() public {
        vm.expectEmit(true, true, true, true);
        emit Spent(owner, keeper, address(venue), address(usdc), 10 * USD, 10 * USD);
        _buyAs(keeper, 10 * USD);
        assertEq(asset.balanceOf(owner), 10 * USD); // the asset lands with the owner, never the agent
        assertEq(asset.balanceOf(keeper), 0);
    }

    function test_RevokingOneAgentLeavesTheOthers() public {
        vm.expectEmit(true, true, false, false);
        emit Revoked(owner, keeper);
        vm.prank(owner);
        del.revokeAgent(keeper);
        vm.prank(keeper);
        vm.expectRevert(XorrDelegation.PolicyRevoked.selector);
        del.spend(owner, address(usdc), address(venue), 1 * USD, address(asset), 1 * USD,
            abi.encodeWithSelector(MockVenue.swap.selector, 1 * USD, owner, 1 * USD));
        _buyAs(scout, 5 * USD);
        assertEq(del.spentTodayBy(owner, scout), 5 * USD);
    }

    function test_StopAllStopsEveryAgentAndAGrantResumes() public {
        vm.prank(owner);
        del.revoke();
        assertTrue(del.isStopped(owner));
        for (uint256 i = 0; i < 2; i++) {
            address agent = i == 0 ? scout : keeper;
            vm.prank(agent);
            vm.expectRevert(XorrDelegation.PolicyRevoked.selector);
            del.spend(owner, address(usdc), address(venue), 1 * USD, address(asset), 1 * USD,
                abi.encodeWithSelector(MockVenue.swap.selector, 1 * USD, owner, 1 * USD));
        }
        assertEq(del.remainingTodayFor(owner, scout), 0);
        vm.prank(owner);
        del.grantAgent(scout, 100 * USD, uint64(block.timestamp + 3 days));
        assertFalse(del.isStopped(owner));
        _buyAs(scout, 1 * USD);
    }

    function test_AnAddressNoOwnerGrantedIsNotAnAgent() public {
        vm.prank(stranger);
        vm.expectRevert(XorrDelegation.NotDelegate.selector);
        del.spend(owner, address(usdc), address(venue), 1 * USD, address(asset), 1 * USD,
            abi.encodeWithSelector(MockVenue.swap.selector, 1 * USD, owner, 1 * USD));
    }

    function test_AnAgentExpiresOnItsOwnDate() public {
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(keeper);
        vm.expectRevert(XorrDelegation.PolicyExpired.selector);
        del.spend(owner, address(usdc), address(venue), 1 * USD, address(asset), 1 * USD,
            abi.encodeWithSelector(MockVenue.swap.selector, 1 * USD, owner, 1 * USD));
        _buyAs(scout, 1 * USD); // the scout's grant runs three days
    }

    function test_GrantAgentIsOwnerScoped() public {
        vm.prank(stranger);
        del.grantAgent(stranger, 1_000 * USD, uint64(block.timestamp + 1 days)); // a policy from the stranger, not the owner
        vm.prank(stranger);
        vm.expectRevert(XorrDelegation.NotDelegate.selector);
        del.spend(owner, address(usdc), address(venue), 1 * USD, address(asset), 1 * USD,
            abi.encodeWithSelector(MockVenue.swap.selector, 1 * USD, owner, 1 * USD));
    }
}
