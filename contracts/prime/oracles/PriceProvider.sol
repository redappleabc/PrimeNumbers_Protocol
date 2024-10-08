// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;
import {IBaseOracle} from "../../interfaces/IBaseOracle.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IPoolHelper} from "../../interfaces/IPoolHelper.sol";
import {IChainlinkAdapter} from "../../interfaces/IChainlinkAdapter.sol";

/// @title PriceProvider Contract
/// @author Prime
contract PriceProvider is Initializable, OwnableUpgradeable {
	/// @notice Chainlink aggregator for USD price of base token
	IChainlinkAdapter public baseAssetChainlinkAdapter;

	/// @notice Pool helper contract - Uniswap/Balancer
	IPoolHelper public poolHelper;

	/// @notice Selected PRNT Oracle
	IBaseOracle public oracle;

	bool private usePool;

	error AddressZero();

	error InvalidOracle();

	/********************** Events ***********************/

	event OracleUpdated(address indexed _newOracle);

	event PoolHelperUpdated(address indexed _poolHelper);

	event AggregatorUpdated(address indexed _baseTokenPriceInUsdProxyAggregator);

	event UsePoolUpdated(bool indexed _usePool);

	constructor() {
		_disableInitializers();
	}

	/**
	 * @notice Initializer
	 * @param _baseAssetChainlinkAdapter Chainlink aggregator for USD price of base token
	 * @param _poolHelper Pool helper contract - Uniswap/Balancer
	 */
	function initialize(IChainlinkAdapter _baseAssetChainlinkAdapter, IPoolHelper _poolHelper) public initializer {
		if (address(_baseAssetChainlinkAdapter) == (address(0))) revert AddressZero();
		if (address(_poolHelper) == (address(0))) revert AddressZero();
		__Ownable_init();

		poolHelper = _poolHelper;
		baseAssetChainlinkAdapter = IChainlinkAdapter(_baseAssetChainlinkAdapter);
		usePool = true;
	}

	/**
	 * @notice Update oracles.
	 */
	function update() public {
		if (address(oracle) != address(0) && oracle.canUpdate()) {
			oracle.update();
		}
	}

	/**
	 * @notice Returns the latest price in eth.
	 */
	function getTokenPrice() public view returns (uint256 priceInEth) {
		if (usePool) {
			// use sparingly, TWAP/CL otherwise
			priceInEth = poolHelper.getPrice();
		} else {
			priceInEth = oracle.latestAnswerInEth();
		}
	}

	/**
	 * @notice Returns the latest price in USD.
	 */
	function getTokenPriceUsd() public view returns (uint256 price) {
		// use sparingly, TWAP/CL otherwise
		if (usePool) {
			uint256 ethPrice = baseAssetChainlinkAdapter.latestAnswer();
			uint256 priceInEth = poolHelper.getPrice();
			price = (priceInEth * uint256(ethPrice)) / (10 ** 8);
		} else {
			price = oracle.latestAnswer();
		}
	}

	/**
	 * @notice Returns lp token price in ETH.
	 */
	function getLpTokenPrice() public view returns (uint256) {
		// decis 8
		uint256 prntPriceInEth = getTokenPrice();
		return poolHelper.getLpPrice(prntPriceInEth);
	}

	/**
	 * @notice Returns lp token price in USD.
	 */
	function getLpTokenPriceUsd() public view returns (uint256 price) {
		// decimals 8
		uint256 lpPriceInEth = getLpTokenPrice();
		// decimals 8
		uint256 ethPrice = baseAssetChainlinkAdapter.latestAnswer();
		price = (lpPriceInEth * uint256(ethPrice)) / (10 ** 8);
	}

	/**
	 * @notice Returns lp token address.
	 */
	function getLpTokenAddress() public view returns (address) {
		return poolHelper.lpTokenAddr();
	}

	/**
	 * @notice Sets new oracle.
	 */
	function setOracle(address _newOracle) external onlyOwner {
		if (_newOracle == address(0)) revert AddressZero();
		oracle = IBaseOracle(_newOracle);
		emit OracleUpdated(_newOracle);
	}

	/**
	 * @notice Sets pool helper contract.
	 */
	function setPoolHelper(address _poolHelper) external onlyOwner {
		poolHelper = IPoolHelper(_poolHelper);
		if (getLpTokenPrice() == 0) revert InvalidOracle();
		emit PoolHelperUpdated(_poolHelper);
	}

	/**
	 * @notice Sets base token price aggregator.
	 */
	function setAggregator(address _baseAssetChainlinkAdapter) external onlyOwner {
		baseAssetChainlinkAdapter = IChainlinkAdapter(_baseAssetChainlinkAdapter);
		if (getLpTokenPriceUsd() == 0) revert InvalidOracle();
		emit AggregatorUpdated(_baseAssetChainlinkAdapter);
	}

	/**
	 * @notice Sets option to use pool.
	 */
	function setUsePool(bool _usePool) external onlyOwner {
		usePool = _usePool;
		emit UsePoolUpdated(_usePool);
	}

	/**
	 * @notice Returns decimals of price.
	 */
	function decimals() public pure returns (uint256) {
		return 8;
	}
}
