// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {MarketFactory} from "../src/MarketFactory.sol";
import {Series} from "../src/Series.sol";
import {NaiveBook} from "../bench/NaiveBook.sol";

/// @notice Deploys the factory, the benchmark baseline, and one Series per question
///         listed in SERIES_QUESTIONS. Writes an addresses file the web app reads.
///
///         Nothing here hardcodes a chain id or an RPC URL: both come from the
///         environment, so the same script deploys identical bytecode anywhere.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
        address resolver = vm.envOr("RESOLVER_ADDRESS", deployer);
        uint64 openSeconds = uint64(vm.envOr("OPEN_SECONDS", uint256(45)));
        uint64 roundSeconds = uint64(vm.envOr("ROUND_SECONDS", uint256(60)));
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(100)));
        uint16 crankShareBps = uint16(vm.envOr("CRANK_SHARE_BPS", uint256(1_000)));

        string[] memory questions = vm.envOr("SERIES_QUESTIONS", ",", _defaultQuestions());

        vm.startBroadcast(pk);

        MarketFactory factory = new MarketFactory(feeRecipient);
        NaiveBook naive = new NaiveBook();

        address[] memory seriesAddrs = new address[](questions.length);
        for (uint256 i; i < questions.length; ++i) {
            Series s = new Series(questions[i], openSeconds, roundSeconds, resolver, feeRecipient, feeBps, crankShareBps);
            factory.registerSeries(address(s), questions[i]);
            s.poke(); // start round 0 immediately so the app is never empty
            seriesAddrs[i] = address(s);
        }

        vm.stopBroadcast();

        console2.log("chain id        ", block.chainid);
        console2.log("deployer        ", deployer);
        console2.log("resolver        ", resolver);
        console2.log("MarketFactory   ", address(factory));
        console2.log("NaiveBook       ", address(naive));
        for (uint256 i; i < seriesAddrs.length; ++i) {
            console2.log("Series          ", seriesAddrs[i], questions[i]);
        }

        _writeAddresses(factory, naive, seriesAddrs, questions, resolver);
    }

    function _defaultQuestions() internal pure returns (string[] memory q) {
        q = new string[](3);
        q[0] = "Boundary this over?";
        q[1] = "Does the CT side win this round?";
        q[2] = "Next block above 2M gas?";
    }

    function _writeAddresses(
        MarketFactory factory,
        NaiveBook naive,
        address[] memory seriesAddrs,
        string[] memory questions,
        address resolver
    ) internal {
        string memory json = "{\n";
        json = string.concat(json, '  "chainId": ', vm.toString(block.chainid), ",\n");
        json = string.concat(json, '  "factory": "', vm.toString(address(factory)), '",\n');
        json = string.concat(json, '  "naiveBook": "', vm.toString(address(naive)), '",\n');
        json = string.concat(json, '  "resolver": "', vm.toString(resolver), '",\n');
        json = string.concat(json, '  "series": [\n');
        for (uint256 i; i < seriesAddrs.length; ++i) {
            json = string.concat(json, '    { "address": "', vm.toString(seriesAddrs[i]), '", "question": "');
            json = string.concat(json, questions[i], '" }');
            json = string.concat(json, i + 1 < seriesAddrs.length ? ",\n" : "\n");
        }
        json = string.concat(json, "  ]\n}\n");

        string memory path = string.concat("./deployments/", vm.toString(block.chainid), ".json");
        vm.writeFile(path, json);
        console2.log("wrote", path);
    }
}
