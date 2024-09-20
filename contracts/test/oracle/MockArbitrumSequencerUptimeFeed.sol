// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.12;

import {ISequencerAggregator} from "../../interfaces/ISequencerAggregator.sol";

contract MockArbitrumSequencerUptimeFeed {
	address public aliasedL1MessageSender;
	ISequencerAggregator public sequencer = ISequencerAggregator(0xFdB631F5EE196F0ed6FAa767959853A9F217697D);

	constructor() {
		aliasedL1MessageSender = msg.sender;
	}

	function updateStatus(bool status, uint64 timestamp) external {
		sequencer.updateStatus(status, timestamp);
	}
}
