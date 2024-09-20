// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.12;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract MockSequencerAggregator {
	address public aggregator;
	uint80 private roundId;
	int256 private answer;
	uint256 private startedAt;
	uint256 private updatedAt;
	uint80 private answeredInRound;

	error AddressZero();
	error NotUptimeFeed();

	function init(address _aggregator) external {
		aggregator = _aggregator;
		roundId++;
		answer = 0;
		startedAt = block.timestamp;
		updatedAt = block.timestamp;
		answeredInRound++;
	}

	function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
		return (roundId, answer, startedAt, updatedAt, answeredInRound);
	}

	function updateStatus(bool status, uint64 timestamp) external {
		if (status) {
			answer = 1;
			roundId++;
			startedAt = uint256(timestamp);
			updatedAt = uint256(timestamp);
			answeredInRound++;
		} else {
			answer = 0;
			roundId++;
			startedAt = uint256(timestamp);
			updatedAt = uint256(timestamp);
			answeredInRound++;
		}
	}
}
