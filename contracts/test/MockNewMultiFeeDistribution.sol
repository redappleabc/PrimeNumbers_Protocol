// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import "../prime/staking/MultiFeeDistribution.sol";

contract MockNewMultiFeeDistribution is MultiFeeDistribution {
	function mockNewFunction() external pure returns (bool) {
		return true;
	}
}
