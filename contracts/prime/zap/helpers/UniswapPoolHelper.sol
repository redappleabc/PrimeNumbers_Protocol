// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {DustRefunder} from "./DustRefunder.sol";
import {UniswapV2Library} from "../../../uniswap-solc-0.8/libraries/UniswapV2Library.sol";
import {IUniswapV2Pair} from "../../../uniswap-solc-0.8/interfaces/IUniswapV2Pair.sol";
import {IUniswapV2Factory} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {HomoraMath} from "../../../dependencies/math/HomoraMath.sol";
import {IUniswapV2Router02} from "../../../interfaces/uniswap/IUniswapV2Router02.sol";
import {ILiquidityZap} from "../../../interfaces/ILiquidityZap.sol";
import {IWETH} from "../../../interfaces/IWETH.sol";

/// @title Uniswap Pool Helper Contract
/// @author Prime
contract UniswapPoolHelper is Initializable, OwnableUpgradeable, DustRefunder {
	using SafeERC20 for IERC20;
	using HomoraMath for uint256;

	/********************** Events ***********************/
	event LiquidityZapUpdated(address indexed _liquidityZap);

	event LockZapUpdated(address indexed _lockZap);

	/********************** Errors ***********************/
	error AddressZero();
	error InsufficientPermission();

	address public lpTokenAddr;
	address public prntAddr;
	address public wethAddr;

	IUniswapV2Router02 public router;
	ILiquidityZap public liquidityZap;
	address public lockZap;

	constructor() {
		_disableInitializers();
	}

	/**
	 * @notice Initializer
	 * @param _prntAddr PRNT address
	 * @param _wethAddr WETH address
	 * @param _routerAddr Uniswap router address
	 * @param _liquidityZap LiquidityZap addrress
	 */
	function initialize(
		address _prntAddr,
		address _wethAddr,
		address _routerAddr,
		ILiquidityZap _liquidityZap
	) external initializer {
		if (_prntAddr == address(0)) revert AddressZero();
		if (_wethAddr == address(0)) revert AddressZero();
		if (_routerAddr == address(0)) revert AddressZero();
		if (address(_liquidityZap) == address(0)) revert AddressZero();

		__Ownable_init();

		prntAddr = _prntAddr;
		wethAddr = _wethAddr;

		router = IUniswapV2Router02(_routerAddr);
		liquidityZap = _liquidityZap;
	}

	/**
	 * @notice Initialize PRNT/WETH pool and liquidity zap
	 */
	function initializePool() public onlyOwner {
		lpTokenAddr = IUniswapV2Factory(router.factory()).createPair(prntAddr, wethAddr);

		IERC20 prnt = IERC20(prntAddr);
		prnt.forceApprove(address(router), type(uint256).max);
		prnt.forceApprove(address(liquidityZap), type(uint256).max);
		IERC20(wethAddr).approve(address(liquidityZap), type(uint256).max);
		IERC20(wethAddr).approve(address(router), type(uint256).max);

		router.addLiquidity(
			address(prnt),
			wethAddr,
			prnt.balanceOf(address(this)),
			IERC20(wethAddr).balanceOf(address(this)),
			0,
			0,
			address(this),
			block.timestamp
		);

		IERC20 lp = IERC20(lpTokenAddr);
		lp.safeTransfer(msg.sender, lp.balanceOf(address(this)));
	}

	/**
	 * @notice Gets needed WETH for adding LP
	 * @param lpAmount LP amount
	 * @return wethAmount WETH amount
	 */
	function quoteWETH(uint256 lpAmount) public view returns (uint256 wethAmount) {
		IUniswapV2Pair lpToken = IUniswapV2Pair(lpTokenAddr);

		(uint256 reserve0, uint256 reserve1, ) = lpToken.getReserves();
		uint256 weth = lpToken.token0() != address(prntAddr) ? reserve0 : reserve1;
		uint256 prnt = lpToken.token0() == address(prntAddr) ? reserve0 : reserve1;
		uint256 lpTokenSupply = lpToken.totalSupply();

		uint256 neededPrnt = (prnt * lpAmount) / lpTokenSupply;
		uint256 neededWeth = (prnt * lpAmount) / lpTokenSupply;

		uint256 neededPrntInWeth = router.getAmountIn(neededPrnt, weth, prnt);
		return neededWeth + neededPrntInWeth;
	}

	/**
	 * @notice Zap WETH into LP
	 * @param amount of WETH
	 * @return liquidity LP token amount
	 */
	function zapWETH(uint256 amount) public returns (uint256 liquidity) {
		if (msg.sender != lockZap) revert InsufficientPermission();
		IWETH weth = IWETH(wethAddr);
		weth.transferFrom(msg.sender, address(liquidityZap), amount);
		liquidityZap.addLiquidityWETHOnly(amount, payable(address(this)));
		IERC20 lp = IERC20(lpTokenAddr);

		liquidity = lp.balanceOf(address(this));
		lp.safeTransfer(msg.sender, liquidity);
		_refundDust(prntAddr, wethAddr, msg.sender);
	}

	/**
	 * @notice Returns reserve information.
	 * @return prnt PRNT amount
	 * @return weth WETH amount
	 * @return lpTokenSupply LP token supply
	 */
	function getReserves() public view returns (uint256 prnt, uint256 weth, uint256 lpTokenSupply) {
		IUniswapV2Pair lpToken = IUniswapV2Pair(lpTokenAddr);

		(uint256 reserve0, uint256 reserve1, ) = lpToken.getReserves();
		weth = lpToken.token0() != address(prntAddr) ? reserve0 : reserve1;
		prnt = lpToken.token0() == address(prntAddr) ? reserve0 : reserve1;

		lpTokenSupply = lpToken.totalSupply();
	}

	// UniV2 / SLP LP Token Price
	// Alpha Homora Fair LP Pricing Method (flash loan resistant)
	// https://cmichel.io/pricing-lp-tokens/
	// https://blog.alphafinance.io/fair-lp-token-pricing/
	// https://github.com/AlphaFinanceLab/alpha-homora-v2-contract/blob/master/contracts/oracle/UniswapV2Oracle.sol
	/**
	 * @notice Returns LP price
	 * @param prntPriceInEth price of PRNT in ETH
	 * @return priceInEth LP price in ETH
	 */
	function getLpPrice(uint256 prntPriceInEth) public view returns (uint256 priceInEth) {
		(uint256 prntReserve, uint256 wethReserve, uint256 lpSupply) = getReserves();

		uint256 sqrtK = HomoraMath.sqrt(prntReserve * wethReserve).fdiv(lpSupply); // in 2**112

		// prnt in eth, decis 8
		uint256 px0 = prntPriceInEth * (2 ** 112); // in 2**112
		// eth in eth, decis 8
		uint256 px1 = uint256(100_000_000) * (2 ** 112); // in 2**112

		// fair token0 amt: sqrtK * sqrt(px1/px0)
		// fair token1 amt: sqrtK * sqrt(px0/px1)
		// fair lp price = 2 * sqrt(px0 * px1)
		// split into 2 sqrts multiplication to prevent uint256 overflow (note the 2**112)
		uint256 result = (((sqrtK * 2 * (HomoraMath.sqrt(px0))) / (2 ** 56)) * (HomoraMath.sqrt(px1))) / (2 ** 56);
		priceInEth = result / (2 ** 112);
	}

	/**
	 * @notice Zap WETH and PRNT into LP
	 * @param _wethAmt amount of WETH
	 * @param _prntAmt amount of PRNT
	 * @return liquidity LP token amount
	 */
	function zapTokens(uint256 _wethAmt, uint256 _prntAmt) public returns (uint256 liquidity) {
		if (msg.sender != lockZap) revert InsufficientPermission();
		IWETH weth = IWETH(wethAddr);
		weth.transferFrom(msg.sender, address(this), _wethAmt);
		IERC20(prntAddr).safeTransferFrom(msg.sender, address(this), _prntAmt);
		liquidityZap.standardAdd(_prntAmt, _wethAmt, address(this));
		IERC20 lp = IERC20(lpTokenAddr);
		liquidity = lp.balanceOf(address(this));
		lp.safeTransfer(msg.sender, liquidity);
		_refundDust(prntAddr, wethAddr, msg.sender);
	}

	/**
	 * @notice Returns `quote` of PRNT in WETH
	 * @param tokenAmount amount of PRNT
	 * @return optimalWETHAmount WETH amount
	 */
	function quoteFromToken(uint256 tokenAmount) public view returns (uint256 optimalWETHAmount) {
		optimalWETHAmount = liquidityZap.quoteFromToken(tokenAmount);
	}

	/**
	 * @notice Returns LiquidityZap address
	 */
	function getLiquidityZap() public view returns (address) {
		return address(liquidityZap);
	}

	/**
	 * @notice Sets new LiquidityZap address
	 * @param _liquidityZap LiquidityZap address
	 */
	function setLiquidityZap(address _liquidityZap) external onlyOwner {
		if (_liquidityZap == address(0)) revert AddressZero();
		liquidityZap = ILiquidityZap(_liquidityZap);
		emit LiquidityZapUpdated(_liquidityZap);
	}

	/**
	 * @notice Sets new LockZap address
	 * @param _lockZap LockZap address
	 */
	function setLockZap(address _lockZap) external onlyOwner {
		if (_lockZap == address(0)) revert AddressZero();
		lockZap = _lockZap;
		emit LockZapUpdated(_lockZap);
	}

	/**
	 * @notice Returns PRNT price in ETH
	 * @return priceInEth price of PRNT
	 */
	function getPrice() public view returns (uint256 priceInEth) {
		(uint256 prnt, uint256 weth, ) = getReserves();
		if (prnt > 0) {
			priceInEth = (weth * (10 ** 8)) / prnt;
		}
	}

	/**
	 * @notice Calculate quote in WETH from token
	 * @param _inToken input token
	 * @param _wethAmount WETH amount
	 * @return tokenAmount token amount
	 */
	function quoteSwap(address _inToken, uint256 _wethAmount) public view returns (uint256 tokenAmount) {
		address[] memory path = new address[](2);
		path[0] = _inToken;
		path[1] = wethAddr;
		uint256[] memory amountsIn = router.getAmountsIn(_wethAmount, path);
		return amountsIn[0];
	}

	/**
	 * @dev Helper function to swap a token to weth given an {_inToken} and swap {_amount}.
	 * Will revert if the output is under the {_minAmountOut}
	 * @param _inToken Input token for swap
	 * @param _amount Amount of input tokens
	 * @param _minAmountOut Minimum output amount
	 */
	function swapToWeth(address _inToken, uint256 _amount, uint256 _minAmountOut) external {
		if (msg.sender != lockZap) revert InsufficientPermission();
		address[] memory path = new address[](2);
		path[0] = _inToken;
		path[1] = wethAddr;
		IERC20(_inToken).forceApprove(address(router), _amount);
		router.swapExactTokensForTokens(_amount, _minAmountOut, path, msg.sender, block.timestamp);
	}
}
