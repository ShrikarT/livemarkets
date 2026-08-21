// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title NaiveBook — sequential baseline. Same work as Market.place, shared slots.
/// @notice This exists so the landing page's speed claim has an honest baseline.
///         It does exactly the same logical work as Market.place — same price math,
///         same rounding, same balance debit, same push — but writes it all into
///         shared slots. Every transaction conflicts with every other, so the chain
///         has to execute them one at a time.
///
///         Do not "fix" this contract. Its inefficiency is the measurement.
contract NaiveBook {
    struct Order {
        address maker;
        uint128 shares;
        uint128 paid;
        bool isYes;
    }

    Order[] public orders; // ONE shared array
    uint128 public totalOpenYes; // ONE shared slot
    uint128 public totalOpenNo; // ONE shared slot
    uint256 public orderCount; // ONE shared slot
    mapping(address => uint256) public balance;

    event OrderPlaced(uint256 index, address indexed maker, uint8 tick, bool isYes, uint128 shares, uint256 cost);

    function deposit() external payable {
        balance[msg.sender] += msg.value;
    }

    function place(uint8 tick, uint128 shares, bool isYes) external returns (uint256 index) {
        uint256 p = (uint256(tick) + 1) * 500;
        uint256 leg = isYes ? p : 10_000 - p;
        uint256 cost = (uint256(shares) * leg + 9_999) / 10_000;

        require(balance[msg.sender] >= cost, "bal");
        balance[msg.sender] -= cost;

        index = orders.length;
        orders.push(Order(msg.sender, shares, uint128(cost), isYes));
        if (isYes) totalOpenYes += shares;
        else totalOpenNo += shares;
        orderCount++; // the serialiser

        emit OrderPlaced(index, msg.sender, tick, isYes, shares, cost);
    }

    function count() external view returns (uint256) {
        return orders.length;
    }
}
