// // SPDX-License-Identifier: MIT
// pragma solidity 0.8.12;

// import {OwnableUpgradeable} from "../../dependencies/openzeppelin/upgradeability/OwnableUpgradeable.sol";
// import {AggregatorV3Interface} from "../../interfaces/AggregatorV3Interface.sol";
// import {Chainlink} from "../libraries/Oracle.sol";

// /// @notice Provides wstETH/USD price using stETH/USD Chainlink oracle and wstETH/stETH exchange rate provided by stETH smart contract
// contract WSTETHOracle is OwnableUpgradeable {
// 	/// @notice stETH/USD price feed
// 	AggregatorV3Interface public stETHUSDOracle;
// 	/// @notice wstETHRatio feed
// 	AggregatorV3Interface public stEthPerWstETHOracle;

// 	error AddressZero();

// 	/**
// 	 * @notice Initializer
// 	 * @param _stETHUSDOracle stETH/USD price feed
// 	 * @param _stEthPerWstETHOracle wstETHRatio feed
// 	 */
// 	function initialize(address _stETHUSDOracle, address _stEthPerWstETHOracle) public initializer {
// 		if (_stETHUSDOracle == address(0)) revert AddressZero();
// 		if (_stEthPerWstETHOracle == address(0)) revert AddressZero();

// 		stETHUSDOracle = AggregatorV3Interface(_stETHUSDOracle); //8 decimals
// 		stEthPerWstETHOracle = AggregatorV3Interface(_stEthPerWstETHOracle); //18 decimals
// 		__Ownable_init();
// 	}

// 	/**
// 	 * @notice Returns decimals of oracle output
// 	 */
// 	function decimals() external pure returns (uint8) {
// 		return 8;
// 	}

// 	/**
// 	 * @notice Returns description of the oracle
// 	 */
// 	function description() external pure returns (string memory) {
// 		return "WSTETH/USD";
// 	}

// 	/**
// 	 * @notice Returns last updated timestamp of the oracle
// 	 */
// 	function latestTimestamp() external view returns (uint256) {
// 		(
// 			,
// 			,
// 			,
// 			//uint80 roundId
// 			//int256 answer
// 			//uint256 startedAt
// 			uint256 updatedAt, //uint256 answeredInRound

// 		) = stETHUSDOracle.latestRoundData();
// 		return updatedAt;
// 	}

// 	/// @notice Get wstETH/USD price. It does not check Chainlink oracle staleness! If staleness check needed, it's recommended to use latestTimestamp() function
// 	/// @return answer wstETH/USD price or 0 if failure
// 	function latestAnswer() external view returns (int256 answer) {
// 		int256 stETHPrice = Oracle.getAnswer(stETHUSDOracle);
// 		int256 wstETHRatio = Oracle.getAnswer(stEthPerWstETHOracle);

// 		answer = (stETHPrice * wstETHRatio) / 1 ether;
// 	}

// 	/**
// 	 * @notice Returns version of the oracle
// 	 */
// 	function version() external pure returns (uint256) {
// 		return 1;
// 	}
// }
