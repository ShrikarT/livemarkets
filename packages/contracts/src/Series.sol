// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Market} from "./Market.sol";

/// @title Series — rounds that roll themselves
/// @notice A Series is a repeating question ("boundary this over?") that spawns a
///         fresh Market every `roundSeconds`. poke() is permissionless, so the app
///         stays alive even if the backend dies — anyone, including the frontend,
///         can roll the round.
contract Series {
    string public question;
    uint64 public openSeconds;
    uint64 public roundSeconds;
    address public resolver;
    address public feeRecipient;
    uint16 public feeBps;
    uint16 public crankShareBps;

    Market[] public rounds;
    uint64 public nextStart;
    bool public stopped;

    event RoundStarted(uint256 indexed round, address market, uint64 startedAt, uint64 nextStart);
    event Stopped(bool stopped);

    error TooEarly();
    error NotResolver();
    error IsStopped();

    constructor(
        string memory _question,
        uint64 _openSeconds,
        uint64 _roundSeconds,
        address _resolver,
        address _feeRecipient,
        uint16 _feeBps,
        uint16 _crankShareBps
    ) {
        require(_resolver != address(0) && _feeRecipient != address(0), "zero addr");
        require(_roundSeconds >= _openSeconds && _openSeconds > 0, "bad window");
        question = _question;
        openSeconds = _openSeconds;
        roundSeconds = _roundSeconds;
        resolver = _resolver;
        feeRecipient = _feeRecipient;
        feeBps = _feeBps;
        crankShareBps = _crankShareBps;
        nextStart = uint64(block.timestamp);
    }

    /// @notice Roll the next round. Anyone may call once the window has elapsed.
    /// @dev The schedule is advanced from the previous slot, not from `now`, so a
    ///      late poke does not push every future round later. If pokes have been
    ///      missed for a long time the schedule catches up to the current slot
    ///      instead of firing a burst of rounds.
    function poke() external returns (Market m) {
        if (stopped) revert IsStopped();
        if (block.timestamp < nextStart) revert TooEarly();

        m = new Market(question, resolver, feeRecipient, feeBps, crankShareBps, openSeconds, roundSeconds);
        rounds.push(m);

        uint64 next = nextStart + roundSeconds;
        if (next <= uint64(block.timestamp)) {
            // missed slots: resync to the next slot boundary after now
            uint64 behind = uint64(block.timestamp) - nextStart;
            next = nextStart + ((behind / roundSeconds) + 1) * roundSeconds;
        }
        nextStart = next;

        emit RoundStarted(rounds.length - 1, address(m), uint64(block.timestamp), next);
    }

    /// @notice Stop rolling new rounds. Live rounds are untouched and remain
    ///         fully claimable.
    function setStopped(bool s) external {
        if (msg.sender != resolver) revert NotResolver();
        stopped = s;
        emit Stopped(s);
    }

    function current() external view returns (Market) {
        require(rounds.length > 0, "none");
        return rounds[rounds.length - 1];
    }

    function count() external view returns (uint256) {
        return rounds.length;
    }

    function recent(uint256 n) external view returns (Market[] memory out) {
        uint256 len = rounds.length;
        uint256 k = n > len ? len : n;
        out = new Market[](k);
        for (uint256 i; i < k; ++i) {
            out[i] = rounds[len - 1 - i];
        }
    }

    /// @notice True when poke() would succeed. Lets the frontend roll the round.
    function pokeable() external view returns (bool) {
        return !stopped && block.timestamp >= nextStart;
    }
}
