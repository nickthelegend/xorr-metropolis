// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {XorrDelegation} from "../src/XorrDelegation.sol";
import {KuruVenue} from "../src/KuruVenue.sol";

/// @dev A plain ERC-20 with the transfer the venue pays out with.
contract Token {
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint8 d) {
        decimals = d;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "allowance");
        allowance[from][msg.sender] = a - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev WMON: wraps and unwraps native one to one.
contract WrappedNative is Token(18) {
    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "send");
    }
}

/**
 * @dev A native-base Kuru book with Kuru's own sizing, as measured on Monad's MON/USDC book (2026-09-24): a buy is sized
 *      in price precision (1e8 per dollar) and pays native MON; a sell is sized in size precision (1e10 per MON) and must
 *      be paid exactly `size × 1e8` wei.
 */
contract NativeBook {
    Token public quote;
    address public base;
    /// Quote units (6 dp) per whole MON.
    uint256 public price;
    /// The share of a buy the book fills, in bps — a thin book leaves quote behind.
    uint256 public fillBps = 10_000;

    constructor(Token q, address b, uint256 p) {
        quote = q;
        base = b;
        price = p;
    }

    function setFillBps(uint256 b) external {
        fillBps = b;
    }

    function getMarketParams()
        external
        view
        returns (uint32, uint96, address, uint256, address, uint256, uint32, uint96, uint96, uint256, uint256)
    {
        return (1e8, 1e10, base, 18, address(quote), 6, 100, 0, type(uint96).max, 0, 0);
    }

    function placeAndExecuteMarketBuy(uint96 quoteSize, uint256 minAmountOut, bool, bool) external payable returns (uint256) {
        uint256 quoteIn = (uint256(quoteSize) * 1e6) / 1e8;
        uint256 taken = (quoteIn * fillBps) / 10_000;
        quote.transferFrom(msg.sender, address(this), taken);
        uint256 baseOut = (taken * 1e18) / price;
        require(baseOut >= minAmountOut, "Kuru: slippage");
        (bool ok,) = msg.sender.call{value: baseOut}("");
        require(ok, "send");
        return baseOut;
    }

    function placeAndExecuteMarketSell(uint96 size, uint256 minAmountOut, bool, bool) external payable returns (uint256) {
        require(msg.value == uint256(size) * 1e8, "Kuru: value");
        uint256 quoteOut = (msg.value * price) / 1e18;
        require(quoteOut >= minAmountOut, "Kuru: slippage");
        quote.mint(msg.sender, quoteOut);
        return quoteOut;
    }

    receive() external payable {}
}

contract KuruVenueTest is Test {
    Token internal usdc;
    WrappedNative internal wmon;
    NativeBook internal book;
    KuruVenue internal venue;
    XorrDelegation internal del;

    address internal owner = address(0xA11CE);
    address internal bot = address(0xB0B);
    uint256 internal constant USD = 1e6;
    /// $0.024 a MON.
    uint256 internal constant PRICE = 24_000;

    function setUp() public {
        usdc = new Token(6);
        wmon = new WrappedNative();
        book = new NativeBook(usdc, address(0), PRICE);
        vm.deal(address(book), 1_000_000 ether);
        venue = new KuruVenue(address(wmon));
        del = new XorrDelegation(address(usdc));

        usdc.mint(owner, 1_000 * USD);
        address[] memory venues = new address[](1);
        venues[0] = address(venue);
        vm.startPrank(owner);
        usdc.approve(address(del), type(uint256).max);
        wmon.approve(address(del), type(uint256).max);
        del.grant(bot, 100 * USD, uint64(block.timestamp + 7 days), venues);
        vm.stopPrank();
    }

    function _buy(uint256 quoteIn, uint256 minBase, address to) internal view returns (bytes memory) {
        return abi.encodeCall(KuruVenue.buy, (address(book), quoteIn, minBase, to));
    }

    function _sell(uint256 baseIn, uint256 minQuote, address to) internal view returns (bytes memory) {
        return abi.encodeCall(KuruVenue.sell, (address(book), baseIn, minQuote, to));
    }

    function test_BuyThroughTheDelegationDeliversWmonToTheOwner() public {
        vm.prank(bot);
        bytes memory ret = del.spend(owner, address(usdc), address(venue), 10 * USD, address(wmon), 416 ether, _buy(10 * USD, 416 ether, owner));
        uint256 delivered = abi.decode(ret, (uint256));
        assertEq(wmon.balanceOf(owner), delivered, "the owner holds what the venue says it delivered");
        assertApproxEqAbs(delivered, 416.666666666666666666 ether, 1e3, "$10 at $0.024");
        assertEq(usdc.balanceOf(owner), 990 * USD, "exactly $10 was pulled");
        assertEq(del.spentToday(owner), 10 * USD, "and it counts against the day's cap");
        assertEq(address(venue).balance, 0, "the venue holds no MON");
        assertEq(wmon.balanceOf(address(venue)) + usdc.balanceOf(address(venue)), 0, "or any token");
        assertEq(usdc.allowance(address(del), address(venue)), 0, "no standing approval");
    }

    function test_ABuyTheBookOnlyPartlyFillsRefundsTheRest() public {
        book.setFillBps(6_000);
        vm.prank(bot);
        del.spend(owner, address(usdc), address(venue), 10 * USD, address(wmon), 1, _buy(10 * USD, 0, owner));
        assertEq(usdc.balanceOf(owner), 994 * USD, "the $4 the book did not take came back");
        assertEq(usdc.balanceOf(address(venue)), 0, "none of it left behind");
    }

    function test_SellThroughTheDelegationDeliversQuoteAndReturnsDust() public {
        // The owner holds 500 WMON and a few wei that are less than one of Kuru's size units.
        vm.deal(owner, 500 ether + 123);
        vm.prank(owner);
        wmon.deposit{value: 500 ether + 123}();

        vm.prank(bot);
        bytes memory ret = del.closePosition(owner, address(wmon), address(venue), 500 ether + 123, address(usdc), 11 * USD, _sell(500 ether + 123, 11 * USD, owner));
        uint256 delivered = abi.decode(ret, (uint256));
        assertEq(delivered, 12 * USD, "500 MON at $0.024");
        assertEq(usdc.balanceOf(owner), 1_000 * USD + 12 * USD, "the USDC reached the owner");
        assertEq(wmon.balanceOf(owner), 123, "the dust below one size unit came back wrapped");
        assertEq(address(venue).balance, 0, "nothing native left in the venue");
    }

    function test_AFillSentAnywhereButTheOwnerIsRefusedByTheDelegation() public {
        vm.prank(bot);
        vm.expectRevert(abi.encodeWithSelector(XorrDelegation.OutputNotReceived.selector, 0, 400 ether));
        del.spend(owner, address(usdc), address(venue), 10 * USD, address(wmon), 400 ether, _buy(10 * USD, 0, address(0xBAD)));
    }

    function test_KurusOwnFloorRevertsAThinFill() public {
        vm.prank(bot);
        vm.expectRevert(bytes("Kuru: slippage"));
        del.spend(owner, address(usdc), address(venue), 10 * USD, address(wmon), 1, _buy(10 * USD, 500 ether, owner));
    }

    function test_ABookWhoseBaseIsATokenIsRefused() public {
        NativeBook erc20Base = new NativeBook(usdc, address(wmon), PRICE);
        usdc.mint(address(this), 10 * USD);
        usdc.approve(address(venue), 10 * USD);
        vm.expectRevert(abi.encodeWithSelector(KuruVenue.NotNativeBase.selector, address(erc20Base)));
        venue.buy(address(erc20Base), 10 * USD, 0, address(this));
    }
}

/**
 * @dev Against Kuru's real MON/USDC book on a fork of Monad mainnet — run with `MONAD_FORK_RPC=http://127.0.0.1:8547`.
 *      Skipped without it (CI has no fork).
 */
contract KuruVenueForkTest is Test {
    address internal constant BOOK = 0x065C9d28E428A0db40191a54d33d5b7c71a9C394;
    address internal constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address internal constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    /// The fork's own USDC reserve (`server/src/fork/anvil.ts`).
    address internal constant RESERVE = 0xDeBB6f1c45b2E997547eBAC5a5A8aA63dbAEf6a5;

    function test_RoundTripOnKurusRealBook() public {
        string memory rpc = vm.envOr("MONAD_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        KuruVenue venue = new KuruVenue(WMON);
        address me = address(0xC0FFEE);

        vm.prank(RESERVE);
        Token(USDC).transfer(me, 10e6);
        vm.startPrank(me);
        Token(USDC).approve(address(venue), 10e6);
        uint256 bought = venue.buy(BOOK, 10e6, 1, me);
        assertEq(Token(WMON).balanceOf(me), bought, "WMON delivered");
        assertGt(bought, 100 ether, "a sane number of MON for $10");

        Token(WMON).approve(address(venue), bought);
        uint256 sold = venue.sell(BOOK, bought, 1, me);
        vm.stopPrank();
        assertEq(Token(USDC).balanceOf(me), sold, "USDC delivered");
        assertGt(sold, 9.9e6, "the spread, not the money, was lost on the round trip");
        assertEq(address(venue).balance, 0, "the venue holds nothing");
    }
}
