// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import "../prime/oracles/PriceProvider.sol";

contract MockNewPriceProvider is PriceProvider {
	function mockNewFunction() external pure returns (bool) {
		return true;
	}
}
