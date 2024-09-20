// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {OwnableUpgradeable} from "../../dependencies/openzeppelin/upgradeability/OwnableUpgradeable.sol";
import {IChainlinkAdapter} from "../../interfaces/IChainlinkAdapter.sol";
import {IBaseOracle} from "../../interfaces/IBaseOracle.sol";

/// @title PrimeChainlinkOracle Contract
/// @author Prime
contract PrimeChainlinkOracle is IBaseOracle, OwnableUpgradeable {
	/// @notice Eth price feed
	IChainlinkAdapter public ethChainlinkAdapter;
	/// @notice Token price feed
	IChainlinkAdapter public prntChainlinkAdapter;

	error AddressZero();

	/**
	 * @notice Initializer
	 * @param _ethChainlinkAdapter Chainlink adapter for ETH.
	 * @param _prntChainlinkAdapter Chainlink price feed for PRNT.
	 */
	function initialize(address _ethChainlinkAdapter, address _prntChainlinkAdapter) external initializer {
		if (_ethChainlinkAdapter == address(0)) revert AddressZero();
		if (_prntChainlinkAdapter == address(0)) revert AddressZero();
		ethChainlinkAdapter = IChainlinkAdapter(_ethChainlinkAdapter);
		prntChainlinkAdapter = IChainlinkAdapter(_prntChainlinkAdapter);
		__Ownable_init();
	}

	/**
	 * @notice Returns USD price in quote token.
	 * @dev supports 18 decimal token
	 * @return price of token in decimal 8
	 */
	function latestAnswer() public view returns (uint256 price) {
		// Chainlink param validations happens inside here
		price = prntChainlinkAdapter.latestAnswer();
	}

	/**
	 * @notice Returns price in ETH
	 * @dev supports 18 decimal token
	 * @return price of token in decimal 8.
	 */
	function latestAnswerInEth() public view returns (uint256 price) {
		uint256 prntPrice = prntChainlinkAdapter.latestAnswer();
		uint256 ethPrice = ethChainlinkAdapter.latestAnswer();
		price = (prntPrice * (10 ** 8)) / ethPrice;
	}

	/**
	 * @dev Check if update() can be called instead of wasting gas calling it.
	 */
	function canUpdate() public pure returns (bool) {
		return false;
	}

	/**
	 * @dev this function only exists so that the contract is compatible with the IBaseOracle Interface
	 */
	function update() public {}

	/**
	 * @notice Returns current price.
	 */
	function consult() public view returns (uint256 price) {
		price = latestAnswer();
	}
}
