// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverTemplate} from "./cre/ReceiverTemplate.sol";

/**
 * @title XorrPriceReceiver — a MON/USD price on Monad testnet, written by a Chainlink CRE workflow
 * @notice Monad testnet has no Chainlink MON/USD feed (its five feeds are BTC, ETH, USDC, USDT, LINK), and xorr's agents
 *         trade MON perps there. The CRE workflow in `cre/mon-price` reads three independent prices on Monad mainnet —
 *         Perpl's MON mark (HTTP, consensus across the DON), Kuru's MON/USDC book and Chainlink's MON/USD feed (EVM
 *         reads) — and writes their median here, with how far the markets sit from Chainlink and whether that is too far
 *         to trade on (`halt`). The executor's price gate on testnet reads this contract before an agent's MON order.
 *
 *         Only the CRE forwarder may write (ReceiverTemplate). `latestRoundData` has Chainlink's AggregatorV3 shape, so a
 *         reader written for a feed reads this unchanged; `halted()` is the extra the gate needs.
 *
 *         Report: abi.encode(int256 answer, uint8 sources, uint16 spreadBps, uint16 anchorGapBps, bool halt,
 *         uint64 observedAt) — answer in 8 decimals, observedAt in unix seconds (the cron's scheduled time).
 */
contract XorrPriceReceiver is ReceiverTemplate {
    struct Observation {
        int256 answer;
        /// How many of the three sources answered.
        uint8 sources;
        /// Kuru's best ask over best bid, around the mid.
        uint16 spreadBps;
        /// The furthest a market price (Perpl, Kuru) sat from Chainlink's.
        uint16 anchorGapBps;
        bool halt;
        uint64 observedAt;
    }

    uint8 public constant decimals = 8;
    string public constant description = "MON / USD (CRE: median of Perpl, Kuru and Chainlink on Monad mainnet)";

    uint80 public latestRound;
    mapping(uint80 => Observation) private s_rounds;

    event PriceReported(uint80 indexed roundId, int256 answer, uint8 sources, uint16 spreadBps, uint16 anchorGapBps, bool halt, uint64 observedAt);

    error StaleReport(uint64 observedAt, uint64 latestObservedAt);
    error NoPrice();
    error NoRound();

    constructor(address forwarder) ReceiverTemplate(forwarder) {}

    function _processReport(bytes calldata report) internal override {
        (int256 answer, uint8 sources, uint16 spreadBps, uint16 anchorGapBps, bool halt, uint64 observedAt) =
            abi.decode(report, (int256, uint8, uint16, uint16, bool, uint64));
        // A report with no price is only meaningful as a halt.
        if (answer <= 0 && !halt) revert NoPrice();
        // Rounds only move forward: a late or replayed report is refused, never stored over a newer one.
        uint64 last = s_rounds[latestRound].observedAt;
        if (latestRound != 0 && observedAt <= last) revert StaleReport(observedAt, last);
        uint80 round = latestRound + 1;
        s_rounds[round] = Observation(answer, sources, spreadBps, anchorGapBps, halt, observedAt);
        latestRound = round;
        emit PriceReported(round, answer, sources, spreadBps, anchorGapBps, halt, observedAt);
    }

    /// @notice AggregatorV3's shape: (roundId, answer, startedAt, updatedAt, answeredInRound).
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        if (latestRound == 0) revert NoRound();
        Observation storage o = s_rounds[latestRound];
        return (latestRound, o.answer, o.observedAt, o.observedAt, latestRound);
    }

    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
        Observation storage o = s_rounds[roundId];
        if (o.observedAt == 0) revert NoRound();
        return (roundId, o.answer, o.observedAt, o.observedAt, roundId);
    }

    function latestObservation() external view returns (Observation memory) {
        if (latestRound == 0) revert NoRound();
        return s_rounds[latestRound];
    }

    /// @notice True when the workflow's latest report said the markets are too far from Chainlink to trade on.
    function halted() external view returns (bool) {
        return latestRound != 0 && s_rounds[latestRound].halt;
    }
}
