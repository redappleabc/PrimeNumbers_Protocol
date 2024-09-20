// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {IUniswapV2Router} from "../../uniswap-solc-0.8/interfaces/IUniswapV2Router.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

import {IAToken} from "../../interfaces/IAToken.sol";
import {IMultiFeeDistribution} from "../../interfaces/IMultiFeeDistribution.sol";
import {ILendingPoolAddressesProvider} from "../../interfaces/ILendingPoolAddressesProvider.sol";
import {IAaveOracle} from "../../interfaces/IAaveOracle.sol";
import {ILendingPool} from "../../interfaces/ILendingPool.sol";
import {ILockZap} from "../../interfaces/ILockZap.sol";
import {IPriceProvider} from "../../interfaces/IPriceProvider.sol";
import {IFeeDistribution} from "../../interfaces/IFeeDistribution.sol";
import {IMintableToken} from "../../interfaces/IMintableToken.sol";
import {IBountyManager} from "../../interfaces/IBountyManager.sol";

/// @title Compounder Contract
/// @author Prime
contract Compounder is OwnableUpgradeable, PausableUpgradeable {
	using SafeERC20 for IERC20;

	/// @notice Reward data struct
	struct RewardData {
		address token;
		uint256 amount;
	}

	/********************** Events ***********************/

	/// @notice Emitted when routes are updated
	event RoutesUpdated(address _token, address[] _routes);

	/// @notice Emitted when bounty manager is updated
	event BountyManagerUpdated(address indexed _manager);

	/// @notice Emitted when compounding fee is updated
	event CompoundFeeUpdated(uint256 indexed _compoundFee);

	/// @notice Emitted when slippage limit is updated
	event SlippageLimitUpdated(uint256 indexed _slippageLimit);

	/********************** Errors ***********************/
	error AddressZero();

	error InvalidCompoundFee();

	error InvalidSlippage();

	error NotBountyManager();

	error NotEligible();

	error InsufficientStakeAmount();

	error ArrayLengthMismatch();

	error SwapFailed(address asset, uint256 amount);

	/// @notice The maximum slippage limit that can be set by admins
	/// @dev The max slippage should be equal to the max slippage of the LockZap contract, otherwise transactions could revert
	uint256 public constant MAX_SLIPPAGE_LIMIT = 8500; //15%

	/// @notice Percent divisor which is equal to 100%
	uint256 public constant PERCENT_DIVISOR = 10000;
	uint256 public constant MAX_COMPOUND_FEE = 2000;
	uint256 public constant MIN_DELAY = 1 days;
	/// @notice Fee of compounding
	uint256 public compoundFee;

	/// @notice Slippage limit for swap
	uint256 public slippageLimit;

	/// @notice PRNT token address
	IMintableToken public prntToken;

	/// @notice Token that PRNT is paired with in LP
	address public baseToken;

	/// @notice Lending Pool Addresses Provider contract address
	address public addressProvider;

	/// @notice Price provider contract address
	address public priceProvider;

	/// @notice Swap route WETH -> PRNT
	address[] public wethToPrime;

	/// @notice Swap router
	address public uniRouter;

	/// @notice MFD address
	address public multiFeeDistribution;

	/// @notice Lockzap address
	address public lockZap;

	/// @notice BountyManager address
	address public bountyManager;

	/// @notice Timestamp of last auto compounding
	mapping(address => uint256) public lastAutocompound;

	/// @notice Swap route from rewardToken to baseToken
	mapping(address => address[]) public rewardToBaseRoute;

	constructor() {
		_disableInitializers();
	}

	/**
	 * @notice Initializer
	 * @param _uniRouter Address of swap router
	 * @param _mfd Address of MFD
	 * @param _baseToken Address of pair asset of PRNT LP
	 * @param _addressProvider Address of LendingPoolAddressesProvider
	 * @param _lockZap Address of LockZap contract
	 * @param _compoundFee Compounding fee
	 * @param _slippageLimit Slippage limit
	 */
	function initialize(
		address _uniRouter,
		address _mfd,
		address _baseToken,
		address _addressProvider,
		address _lockZap,
		uint256 _compoundFee,
		uint256 _slippageLimit
	) external initializer {
		if (_uniRouter == address(0)) revert AddressZero();
		if (_mfd == address(0)) revert AddressZero();
		if (_baseToken == address(0)) revert AddressZero();
		if (_addressProvider == address(0)) revert AddressZero();
		if (_lockZap == address(0)) revert AddressZero();
		if (_compoundFee == 0) revert InvalidCompoundFee();
		if (_compoundFee > MAX_COMPOUND_FEE) revert InvalidCompoundFee();
		_validateSlippageLimit(_slippageLimit);

		uniRouter = _uniRouter;
		multiFeeDistribution = _mfd;
		baseToken = _baseToken;
		addressProvider = _addressProvider;
		lockZap = _lockZap;
		prntToken = IMultiFeeDistribution(multiFeeDistribution).prntToken();
		priceProvider = IMultiFeeDistribution(multiFeeDistribution).getPriceProvider();
		wethToPrime = [baseToken, address(prntToken)];
		compoundFee = _compoundFee;
		slippageLimit = _slippageLimit;
		__Ownable_init();
		__Pausable_init();
	}

	/**
	 * @notice Pause contract
	 */
	function pause() external onlyOwner {
		_pause();
	}

	/**
	 * @notice Unpause contract
	 */
	function unpause() external onlyOwner {
		_unpause();
	}

	/**
	 * @notice Set swap routes
	 * @param _token Token for swap
	 * @param _routes Swap route for token
	 */
	function setRoutes(address _token, address[] memory _routes) external onlyOwner {
		rewardToBaseRoute[_token] = _routes;
		emit RoutesUpdated(_token, _routes);
	}

	/**
	 * @notice Set bounty manager
	 * @param _manager Bounty manager address
	 */
	function setBountyManager(address _manager) external onlyOwner {
		if (_manager == address(0)) revert AddressZero();
		bountyManager = _manager;
		emit BountyManagerUpdated(_manager);
	}

	/**
	 * @notice Sets the fee for compounding.
	 * @param _compoundFee fee ratio for compounding
	 */
	function setCompoundFee(uint256 _compoundFee) external onlyOwner {
		if (_compoundFee == 0) revert InvalidCompoundFee();
		if (_compoundFee > MAX_COMPOUND_FEE) revert InvalidCompoundFee();
		compoundFee = _compoundFee;
		emit CompoundFeeUpdated(_compoundFee);
	}

	/**
	 * @notice Sets slippage limit.
	 * @param _slippageLimit new slippage limit
	 */
	function setSlippageLimit(uint256 _slippageLimit) external onlyOwner {
		_validateSlippageLimit(_slippageLimit);
		slippageLimit = _slippageLimit;
		emit SlippageLimitUpdated(_slippageLimit);
	}

	/**
	 * @notice Claim and swap them into base token.
	 * @param _user User whose rewards are compounded into dLP
	 * @param tokens Tokens to claim and turn into dLP
	 * @param amts Amounts of each token to be claimed and turned into dLP
	 * @return Total base token amount
	 */
	function _claimAndSwapToBase(
		address _user,
		address[] memory tokens,
		uint256[] memory amts
	) internal returns (uint256) {
		IMultiFeeDistribution mfd = IMultiFeeDistribution(multiFeeDistribution);
		mfd.claimFromConverter(_user);
		ILendingPool lendingPool = ILendingPool(ILendingPoolAddressesProvider(addressProvider).getLendingPool());

		uint256 length = tokens.length;
		for (uint256 i; i < length; i++) {
			uint256 balance = amts[i];
			if (balance == 0) {
				continue;
			}

			address tokenToTrade = tokens[i];
			uint256 amount;
			try lendingPool.withdraw(tokenToTrade, type(uint256).max, address(this)) returns (uint256 withdrawnAmt) {
				amount = withdrawnAmt;
			} catch {
				amount = balance;
			}

			if (tokenToTrade != baseToken) {
				IERC20(tokenToTrade).forceApprove(uniRouter, amount);
				try
					IUniswapV2Router(uniRouter).swapExactTokensForTokens(
						amount,
						0,
						rewardToBaseRoute[tokenToTrade],
						address(this),
						block.timestamp
					)
				{} catch {
					revert SwapFailed(tokenToTrade, amount);
				}
			}
		}
		return IERC20(baseToken).balanceOf(address(this));
	}

	/**
	 * @notice Converts base token to lp token and stake them.
	 * @param _user User for this action
	 * @param _slippage maximum tolerated slippage for any occurring swaps
	 * @return liquidity LP token amount
	 */
	function _convertBaseToLPandStake(address _user, uint256 _slippage) internal returns (uint256 liquidity) {
		uint256 baseBal = IERC20(baseToken).balanceOf(address(this));
		if (baseBal != 0) {
			IERC20(baseToken).forceApprove(lockZap, baseBal);
			liquidity = ILockZap(lockZap).zapOnBehalf(false, address(0), baseBal, 0, _user, _slippage);
		}
	}

	/**
	 * @notice Compound user's rewards
	 * @dev Can be auto compound or manual compound
	 * @param _user user address
	 * @param _execute whether to execute txn, or just quote (expected amount out for bounty executor)
	 * @param _slippage that shouldn't be exceeded when performing swaps
	 * @return fee amount
	 */
	function claimCompound(address _user, bool _execute, uint256 _slippage) public returns (uint256 fee) {
		if (paused()) {
			return 0;
		}
		uint256 slippageLimit_ = slippageLimit;

		bool isAutoCompound = _user != msg.sender;

		(address[] memory tokens, uint256[] memory amts) = viewPendingRewards(_user);
		uint256 noSlippagePendingEth = _quoteSwapWithOracles(tokens, amts, baseToken);

		if (isAutoCompound) {
			_slippage = IMultiFeeDistribution(multiFeeDistribution).userSlippage(_user);
		}
		if (_slippage == 0) {
			_slippage = slippageLimit_;
		}
		if (_slippage < slippageLimit_ || _slippage >= PERCENT_DIVISOR) revert InvalidSlippage();

		if (isAutoCompound) {
			if (msg.sender != bountyManager) revert NotBountyManager();
			bool eligible = isEligibleForAutoCompound(_user, noSlippagePendingEth);
			if (!eligible) {
				if (_execute) {
					revert NotEligible();
				} else {
					return (0);
				}
			}
		} else {
			if (!isEligibleForCompound(noSlippagePendingEth)) revert InsufficientStakeAmount();
		}

		if (!_execute) {
			if (isAutoCompound) {
				uint256 pendingInPrnt = _wethToPrnt(noSlippagePendingEth, _execute, _slippage);
				fee = (pendingInPrnt * compoundFee) / PERCENT_DIVISOR;
				return fee;
			} else {
				return 0;
			}
		}

		uint256 actualWethAfterSwap = _claimAndSwapToBase(_user, tokens, amts);
		if ((PERCENT_DIVISOR * actualWethAfterSwap) / noSlippagePendingEth < _slippage) revert InvalidSlippage();

		if (isAutoCompound) {
			fee = _wethToPrnt(((actualWethAfterSwap * compoundFee) / PERCENT_DIVISOR), _execute, _slippage);
		}

		_convertBaseToLPandStake(_user, _slippage);

		if (isAutoCompound) {
			prntToken.approve(bountyManager, fee);
			lastAutocompound[_user] = block.timestamp;
		}
	}

	/**
	 * @notice Compound `msg.sender`'s rewards.
	 * @param _slippage that shouldn't be exceeded when performing swaps
	 */
	function selfCompound(uint256 _slippage) external {
		claimCompound(msg.sender, true, _slippage);
	}

	/**
	 * @notice Returns the pending rewards of the `_user`
	 * @param _user owner of rewards
	 * @return tokens array of reward token addresses
	 * @return amts array of reward amounts
	 */
	function viewPendingRewards(address _user) public view returns (address[] memory tokens, uint256[] memory amts) {
		IFeeDistribution.RewardData[] memory pending = IMultiFeeDistribution(multiFeeDistribution).claimableRewards(
			_user
		);
		tokens = new address[](pending.length - 1);
		amts = new uint256[](pending.length - 1);
		uint256 index;
		uint256 length = pending.length;
		for (uint256 i; i < length;) {
			if (pending[i].token != address(prntToken)) {
				try IAToken(pending[i].token).UNDERLYING_ASSET_ADDRESS() returns (address underlyingAddress) {
					tokens[index] = underlyingAddress;
				} catch {
					tokens[index] = pending[i].token;
				}
				amts[index] = pending[i].amount;
				unchecked {
					index++;
				}
			}
			unchecked {
				i++;
			}
		}
	}

	/**
	 * @notice Estimate the out tokens amount.
	 * @param _in token address
	 * @param _out token address
	 * @param _amtIn amount of input token
	 * @return tokensOut amount of output
	 */
	function _estimateTokensOut(address _in, address _out, uint256 _amtIn) internal view returns (uint256 tokensOut) {
		IAaveOracle oracle = IAaveOracle(ILendingPoolAddressesProvider(addressProvider).getPriceOracle());
		uint256 priceInAsset = oracle.getAssetPrice(_in); //USDC: 100000000
		uint256 priceOutAsset = oracle.getAssetPrice(_out); //WETH: 153359950000
		uint256 decimalsIn = IERC20Metadata(_in).decimals();
		uint256 decimalsOut = IERC20Metadata(_out).decimals();
		tokensOut = (_amtIn * priceInAsset * (10 ** decimalsOut)) / (priceOutAsset * (10 ** decimalsIn));
	}

	/**
	 * @notice Estimate the out tokens amount.
	 * @param _in array of input token address
	 * @param _amtsIn amount of input tokens
	 * @return amtOut Sum of outputs
	 */
	function _quoteSwapWithOracles(
		address[] memory _in,
		uint256[] memory _amtsIn,
		address _out
	) internal view returns (uint256 amtOut) {
		if (_in.length != _amtsIn.length) revert ArrayLengthMismatch();
		uint256 length = _in.length;
		for (uint256 i; i < length;) {
			amtOut += _estimateTokensOut(_in[i], _out, _amtsIn[i]);
			unchecked {
				i++;
			}
		}
	}

	/**
	 * @notice Swap WETH to PRNT.
	 * @param _wethIn WETH input amount
	 * @param _execute Option to excute this action or not
	 * @param _slippageLimit User defined slippage limit
	 * @return prntOut Output PRNT amount
	 */
	function _wethToPrnt(uint256 _wethIn, bool _execute, uint256 _slippageLimit) internal returns (uint256 prntOut) {
		if (_execute) {
			IPriceProvider(priceProvider).update();
		}
		uint256 prntPrice = IPriceProvider(priceProvider).getTokenPrice();
		if (_wethIn != 0) {
			if (_execute) {
				IERC20(baseToken).forceApprove(uniRouter, _wethIn);
				uint256[] memory amounts = IUniswapV2Router(uniRouter).swapExactTokensForTokens(
					_wethIn,
					0,
					wethToPrime,
					address(this),
					block.timestamp
				);
				prntOut = amounts[amounts.length - 1];
			} else {
				uint256[] memory amounts = IUniswapV2Router(uniRouter).getAmountsOut(
					_wethIn, //amt in
					wethToPrime
				);
				prntOut = amounts[amounts.length - 1];
			}
		}
		uint256 ethValueOfPRNT = prntPrice * prntOut;
		if (ethValueOfPRNT / 10 ** 8 < (_wethIn * _slippageLimit) / PERCENT_DIVISOR) revert InvalidSlippage();
	}

	/**
	 * @notice Returns minimum stake amount in ETH
	 * @return minStakeAmtEth Minimum stake amount in ETH
	 */
	function autocompoundThreshold() public view returns (uint256 minStakeAmtEth) {
		IPriceProvider priceProv = IPriceProvider(priceProvider);

		uint256 minStakeLpAmt = IBountyManager(bountyManager).minDLPBalance();
		uint256 lpPriceEth = priceProv.getLpTokenPrice();

		minStakeAmtEth = (minStakeLpAmt * lpPriceEth) / (10 ** priceProv.decimals());
	}

	/**
	 * @notice Returns if user is eligbile for auto compounding
	 * @param _user address
	 * @param _pending amount
	 * @return True or False
	 */
	function isEligibleForAutoCompound(address _user, uint256 _pending) public view returns (bool) {
		bool delayComplete = true;
		if (lastAutocompound[_user] != 0) {
			delayComplete = (block.timestamp - lastAutocompound[_user]) >= MIN_DELAY;
		}
		return
			IMultiFeeDistribution(multiFeeDistribution).autocompoundEnabled(_user) &&
			isEligibleForCompound(_pending) &&
			delayComplete;
	}

	/**
	 * @notice Returns if pending amount is elgible for auto compounding
	 * @param _pending amount
	 * @return eligible True or False
	 */
	function isEligibleForCompound(uint256 _pending) public view returns (bool eligible) {
		eligible = _pending >= autocompoundThreshold();
	}

	/**
	 * @notice Returns if the user is eligible for auto compound
	 * @param _user address
	 * @return eligible `true` or `false`
	 */
	function userEligibleForCompound(address _user) external view returns (bool eligible) {
		eligible = _userEligibleForCompound(_user);
	}

	/**
	 * @notice Returns if the `msg.sender` is eligible for self compound
	 * @return eligible `true` or `false`
	 */
	function selfEligibleCompound() external view returns (bool eligible) {
		eligible = _userEligibleForCompound(msg.sender);
	}

	/**
	 * @notice Returns if the user is eligible for auto compound
	 * @param _user address the be checked
	 * @return eligible `true` if eligible or `false` if not
	 */
	function _userEligibleForCompound(address _user) internal view returns (bool eligible) {
		(address[] memory tokens, uint256[] memory amts) = viewPendingRewards(_user);
		uint256 pendingEth = _quoteSwapWithOracles(tokens, amts, baseToken);
		eligible = pendingEth >= autocompoundThreshold();
	}

	/**
	 * @notice Validate if the slippage limit is within the boundaries
	 * @param _slippageLimit slippage limit to be validated
	 */
	function _validateSlippageLimit(uint256 _slippageLimit) internal pure {
		if (_slippageLimit < MAX_SLIPPAGE_LIMIT || _slippageLimit >= PERCENT_DIVISOR) revert InvalidSlippage();
	}
}
