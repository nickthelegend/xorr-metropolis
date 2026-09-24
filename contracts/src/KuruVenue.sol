// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The ERC-20 surface this venue touches.
interface IERC20Venue {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Wrapped MON (WMON): native in, token out, and back.
interface IWrappedNative {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/**
 * @notice A Kuru order book, as its live implementation on Monad answers (selectors read from its bytecode on
 *         2026-09-24: the size is `uint96`, the floor `uint256` — Kuru's documented `uint96` floor has no selector there).
 */
interface IKuruOrderBook {
    function placeAndExecuteMarketBuy(uint96 quoteSize, uint256 minAmountOut, bool isMargin, bool isFillOrKill)
        external
        payable
        returns (uint256);

    function placeAndExecuteMarketSell(uint96 size, uint256 minAmountOut, bool isMargin, bool isFillOrKill)
        external
        payable
        returns (uint256);

    function getMarketParams()
        external
        view
        returns (
            uint32 pricePrecision,
            uint96 sizePrecision,
            address baseAsset,
            uint256 baseAssetDecimals,
            address quoteAsset,
            uint256 quoteAssetDecimals,
            uint32 tickSize,
            uint96 minSize,
            uint96 maxSize,
            uint256 takerFeeBps,
            uint256 makerFeeBps
        );
}

/**
 * @title KuruVenue
 * @notice Lets `XorrDelegation` fill through a Kuru order book whose base asset is native MON (MON/USDC, MON/AUSD).
 *
 * @dev Why an adapter at all. `XorrDelegation` checks that the OWNER's balance of the output token rose by the floor;
 *      Kuru's market orders pay whoever called them, in native MON on a native-base book. Called directly, every fill
 *      would land in the delegation contract and revert `OutputNotReceived`. This contract is the caller Kuru pays: it
 *      pulls exactly what the delegation approved it for, runs the market order, wraps or unwraps MON, and sends every
 *      unit it receives to `recipient` — plus anything the book did not take. It holds nothing between calls, has no
 *      owner and no state: it can only move what it is handed inside one transaction.
 *
 *      `recipient` is the caller's to name, and it does not need trusting: the delegation's floor is measured on the
 *      owner's own balance, so a fill sent anywhere else reverts there. Each function returns what it delivered first,
 *      which is what the executor's route measurement reads.
 */
contract KuruVenue {
    IWrappedNative public immutable wrapped;

    error NotNativeBase(address book);
    error NothingToSell(uint256 baseIn, uint256 unit);

    constructor(address wrappedNative) {
        wrapped = IWrappedNative(wrappedNative);
    }

    /**
     * @notice Buy MON on `book` with `quoteIn` of its quote token, delivered to `recipient` as WMON.
     * @param minBaseOut Kuru's own floor, in wei of MON: the book reverts rather than fill for less.
     * @return baseOut WMON delivered to `recipient`.
     */
    function buy(address book, uint256 quoteIn, uint256 minBaseOut, address recipient) external returns (uint256 baseOut) {
        (uint32 pricePrecision,, address base,, address quote, uint256 quoteDecimals,,,,,) = IKuruOrderBook(book).getMarketParams();
        if (base != address(0)) revert NotNativeBase(book);
        require(IERC20Venue(quote).transferFrom(msg.sender, address(this), quoteIn), "pull failed");

        // Kuru sizes a market buy in the book's price precision, not in the token's decimals ($10 = 1e9 at 1e8).
        uint96 quoteSize = uint96((quoteIn * pricePrecision) / 10 ** quoteDecimals);
        IERC20Venue(quote).approve(book, quoteIn);
        uint256 before = address(this).balance;
        IKuruOrderBook(book).placeAndExecuteMarketBuy(quoteSize, minBaseOut, false, false);
        IERC20Venue(quote).approve(book, 0);

        baseOut = address(this).balance - before;
        wrapped.deposit{value: baseOut}();
        require(IERC20Venue(address(wrapped)).transfer(recipient, baseOut), "payout failed");

        // Whatever of the quote the book did not take goes back, not left here.
        uint256 left = IERC20Venue(quote).balanceOf(address(this));
        if (left > 0) require(IERC20Venue(quote).transfer(recipient, left), "refund failed");
    }

    /**
     * @notice Sell `baseIn` WMON on `book` for its quote token, delivered to `recipient`.
     * @param minQuoteOut Kuru's own floor, in the quote token's units.
     * @return quoteOut Quote token delivered to `recipient`.
     */
    function sell(address book, uint256 baseIn, uint256 minQuoteOut, address recipient) external returns (uint256 quoteOut) {
        (, uint96 sizePrecision, address base, uint256 baseDecimals, address quote,,,,,,) = IKuruOrderBook(book).getMarketParams();
        if (base != address(0)) revert NotNativeBase(book);
        require(IERC20Venue(address(wrapped)).transferFrom(msg.sender, address(this), baseIn), "pull failed");
        wrapped.withdraw(baseIn);

        // A native-base sell is sized in the book's size precision and paid for in exactly that much MON.
        uint256 unit = 10 ** baseDecimals / sizePrecision;
        uint96 size = uint96(baseIn / unit);
        if (size == 0) revert NothingToSell(baseIn, unit);
        uint256 before = IERC20Venue(quote).balanceOf(address(this));
        IKuruOrderBook(book).placeAndExecuteMarketSell{value: uint256(size) * unit}(size, minQuoteOut, false, false);

        quoteOut = IERC20Venue(quote).balanceOf(address(this)) - before;
        require(IERC20Venue(quote).transfer(recipient, quoteOut), "payout failed");

        // Dust below one size unit, and anything the book handed back, returns wrapped.
        uint256 left = address(this).balance;
        if (left > 0) {
            wrapped.deposit{value: left}();
            require(IERC20Venue(address(wrapped)).transfer(recipient, left), "refund failed");
        }
    }

    /// @dev Kuru pays native MON here, and WMON unwraps here.
    receive() external payable {}
}
