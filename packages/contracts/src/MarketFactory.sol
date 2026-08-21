// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Market} from "./Market.sol";

/// @title MarketFactory — registry and kill switch
/// @notice The factory is the discovery root: the indexer only needs this address.
///         It creates one-off markets directly and tracks the Series contracts that
///         create their own rounds, so every market in the system is reachable from
///         a single place.
contract MarketFactory {
    address public owner;
    address public feeRecipient;
    uint16 public defaultFeeBps = 100; // 1%
    uint16 public defaultCrankShareBps = 1_000; // 10% of the fee goes to the cranker
    bool public paused; // kill switch: stops NEW markets, never touches live ones

    Market[] public markets;
    address[] public series;
    mapping(address => bool) public isSeries;

    event MarketCreated(address indexed market, string question, uint64 openUntil, uint64 resolveAfter);
    event SeriesRegistered(address indexed series, string question);
    event PausedSet(bool paused);
    event OwnerSet(address indexed owner);
    event FeeConfigSet(address feeRecipient, uint16 feeBps, uint16 crankShareBps);

    error NotOwner();
    error IsPaused();
    error BadWindow();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _feeRecipient) {
        require(_feeRecipient != address(0), "zero addr");
        owner = msg.sender;
        feeRecipient = _feeRecipient;
        emit OwnerSet(msg.sender);
    }

    // ---------------------------------------------------------------- admin

    function setOwner(address o) external onlyOwner {
        require(o != address(0), "zero addr");
        owner = o;
        emit OwnerSet(o);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    function setFeeConfig(address _feeRecipient, uint16 _feeBps, uint16 _crankShareBps) external onlyOwner {
        require(_feeRecipient != address(0), "zero addr");
        require(_feeBps <= 500, "fee too high");
        require(_crankShareBps <= 10_000, "bad crank share");
        feeRecipient = _feeRecipient;
        defaultFeeBps = _feeBps;
        defaultCrankShareBps = _crankShareBps;
        emit FeeConfigSet(_feeRecipient, _feeBps, _crankShareBps);
    }

    // -------------------------------------------------------------- create

    function create(string calldata question, uint64 openSeconds, uint64 resolveSeconds)
        external
        onlyOwner
        returns (Market m)
    {
        if (paused) revert IsPaused();
        if (resolveSeconds < openSeconds) revert BadWindow();

        m = new Market(
            question, msg.sender, feeRecipient, defaultFeeBps, defaultCrankShareBps, openSeconds, resolveSeconds
        );
        markets.push(m);
        emit MarketCreated(address(m), question, m.openUntil(), m.resolveAfter());
    }

    /// @notice Register a Series so indexers and the app can discover its rounds
    ///         from the factory alone.
    function registerSeries(address s, string calldata question) external onlyOwner {
        require(s != address(0), "zero addr");
        require(!isSeries[s], "dupe");
        isSeries[s] = true;
        series.push(s);
        emit SeriesRegistered(s, question);
    }

    // --------------------------------------------------------------- views

    function count() external view returns (uint256) {
        return markets.length;
    }

    function seriesCount() external view returns (uint256) {
        return series.length;
    }

    function allSeries() external view returns (address[] memory) {
        return series;
    }

    /// @notice The `n` most recently created markets, newest first.
    function recent(uint256 n) external view returns (Market[] memory out) {
        uint256 len = markets.length;
        uint256 k = n > len ? len : n;
        out = new Market[](k);
        for (uint256 i; i < k; ++i) {
            out[i] = markets[len - 1 - i];
        }
    }
}
