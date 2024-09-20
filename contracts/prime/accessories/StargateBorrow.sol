// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

import { OFTLimit, OFTFeeDetail, OFTReceipt, SendParam, MessagingReceipt, MessagingFee } from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/interfaces/IOFT.sol";
import {IStargateFeeLib} from "../../interfaces/IStargateFeeLib.sol" ;
import {ITokenMessaging} from "../../interfaces/ITokenMessaging.sol" ;
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {ILendingPool} from "../../interfaces/ILendingPool.sol";
import {IWETH} from "../../interfaces/IWETH.sol";
import { Transfer } from "../libraries/Transfer.sol";

/*
    Chain Ids
        Ethereum: 101
        BSC: 102
        Avalanche: 106
        Polygon: 109
        Arbitrum: 110
        Optimism: 111
        Fantom: 112
        Swimmer: 114
        DFK: 115
        Harmony: 116
        Moonbeam: 126

    Pool Ids
        Ethereum
            USDC: 1
            USDT: 2
            ETH: 13
        BSC
            USDT: 2
            BUSD: 5
        Avalanche
            USDC: 1
            USDT: 2
        Polygon
            USDC: 1
            USDT: 2
        Arbitrum
            USDC: 1
            USDT: 2
            ETH: 13
        Optimism
            USDC: 1
            ETH: 13
        Fantom
            USDC: 1
 */

/// @title Borrow gate via stargate
/// @author Prime
contract StargateBorrow is Transfer, IStargate, ITokenMessagingHandler, ICreditMessagingHandler {
    using SafeCast for uint256;

	/// @notice FEE ratio DIVISOR
	uint256 public constant FEE_PERCENT_DIVISOR = 10000;

	// MAX slippage that cannot be exceeded when setting slippage variable
	uint256 public constant MAX_SLIPPAGE = 80;

	// ETH address
	address private constant ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

	// Max reasonable fee, 1%
	uint256 public constant MAX_REASONABLE_FEE = 100;

	/// @notice Lending Pool address
	ILendingPool public lendingPool;

	// Weth address
	IWETH internal weth;

	// Referral code
	uint16 public constant REFERRAL_CODE = 0;

	/// @notice asset => poolId; at the moment, pool IDs for USDC and USDT are the same accross all chains
	mapping(address => uint256) public poolIdPerChain;

	/// @notice DAO wallet
	address public daoTreasury;

    address internal tokenMessaging;

	/// @notice Cross chain borrow fee ratio
	uint256 public xChainBorrowFeePercent;

	/// @notice Max slippage allowed for SG bridge swaps
	/// 99 = 1%
	uint256 public maxSlippage;

	/// @notice Emitted when DAO address is updated
	event DAOTreasuryUpdated(address indexed _daoTreasury);

	/// @notice Emitted when fee info is updated
	event XChainBorrowFeePercentUpdated(uint256 indexed percent);

	/// @notice Emited when pool ids of assets are updated
	event PoolIDsUpdated(address[] assets, uint256[] poolIDs);

    error Stargate_InvalidAmount();

    error Stargate_LzTokenUnavailable();

	error InvalidRatio();

	error AddressZero();

	/// @notice Emitted when new slippage is set too high
	error SlippageSetToHigh();

	error LengthMismatch();

	constructor() {
		_disableInitializers();
	}

	/**
	 * @notice Constructor
	 * @param _router Stargate Router address
	 * @param _routerETH Stargate Router for ETH
	 * @param _lendingPool Lending pool
	 * @param _weth WETH address
	 * @param _treasury Treasury address
	 * @param _xChainBorrowFeePercent Cross chain borrow fee ratio
	 */
	function initialize(
		// IStargateRouter _router,
		ILendingPool _lendingPool,
		IWETH _weth,
		address _treasury,
		uint256 _xChainBorrowFeePercent,
		uint256 _maxSlippage
	) external initializer {
		if (address(_lendingPool) == address(0)) revert AddressZero();
		if (address(_weth) == address(0)) revert AddressZero();
		if (_treasury == address(0)) revert AddressZero();
		if (_xChainBorrowFeePercent > MAX_REASONABLE_FEE) revert AddressZero();
		if (_maxSlippage < MAX_SLIPPAGE) revert SlippageSetToHigh();

		// router = _router;
		lendingPool = _lendingPool;
		daoTreasury = _treasury;
		xChainBorrowFeePercent = _xChainBorrowFeePercent;
		weth = _weth;
		maxSlippage = _maxSlippage;
		__Ownable_init();
	}

	receive() external payable {}

	/**
	 * @notice Set DAO Treasury.
	 * @param _daoTreasury DAO Treasury address.
	 */
	function setDAOTreasury(address _daoTreasury) external onlyOwner {
		if (_daoTreasury == address(0)) revert AddressZero();
		daoTreasury = _daoTreasury;
		emit DAOTreasuryUpdated(_daoTreasury);
	}

	/**
	 * @notice Set Cross Chain Borrow Fee Percent.
	 * @param percent Fee ratio.
	 */
	function setXChainBorrowFeePercent(uint256 percent) external onlyOwner {
		if (percent > MAX_REASONABLE_FEE) revert InvalidRatio();
		xChainBorrowFeePercent = percent;
		emit XChainBorrowFeePercentUpdated(percent);
	}

	/**
	 * @notice Set pool ids of assets.
	 * @param assets array.
	 * @param poolIDs array.
	 */
	function setPoolIDs(address[] calldata assets, uint256[] calldata poolIDs) external onlyOwner {
		uint256 length = assets.length;
		if (length != poolIDs.length) revert LengthMismatch();
		for (uint256 i = 0; i < length; ) {
			poolIdPerChain[assets[i]] = poolIDs[i];
			unchecked {
				i++;
			}
		}
		emit PoolIDsUpdated(assets, poolIDs);
	}

	/**
	 * @notice Set max slippage allowed for StarGate bridge Swaps.
	 * @param _maxSlippage Max slippage allowed.
	 */
	function setMaxSlippage(uint256 _maxSlippage) external onlyOwner {
		if (_maxSlippage < MAX_SLIPPAGE) revert SlippageSetToHigh();
		maxSlippage = _maxSlippage;
	}

	// ------------------------------- Public Functions ---------------------------------------

    /// @notice Send tokens through the Stargate
    /// @dev Emits OFTSent when the send is successful
    /// @param _sendParam The SendParam object detailing the transaction
    /// @param _fee The MessagingFee object describing the fee to pay
    /// @param _refundAddress The address to refund any LZ fees paid in excess
    /// @return msgReceipt The receipt proving the message was sent
    /// @return oftReceipt The receipt proving the OFT swap
    function send(
        SendParam calldata _sendParam,
        MessagingFee calldata _fee,
        address _refundAddress
    ) external payable override returns (MessagingReceipt memory msgReceipt, OFTReceipt memory oftReceipt) {
        (msgReceipt, oftReceipt, ) = sendToken(_sendParam, _fee, _refundAddress);
    }

    function sendToken(
        SendParam calldata _sendParam,
        MessagingFee calldata _fee,
        address _refundAddress
    )
        public
        payable
        override
        nonReentrantAndNotPaused
        returns (MessagingReceipt memory msgReceipt, OFTReceipt memory oftReceipt, Ticket memory ticket)
    {
        // step 1: assets inflows and apply the fee to the input amount
        (bool isTaxi, uint64 amountInSD, uint64 amountOutSD) = _inflowAndCharge(_sendParam);

        // step 2: generate the oft receipt
        oftReceipt = OFTReceipt(_sd2ld(amountInSD), _sd2ld(amountOutSD));

        // step 3: assert the messaging fee
        MessagingFee memory messagingFee = _assertMessagingFee(_fee, oftReceipt.amountSentLD);

        // step 4: send the token depending on the mode Taxi or Bus
        if (isTaxi) {
            msgReceipt = _taxi(_sendParam, messagingFee, amountOutSD, _refundAddress);
        } else {
            (msgReceipt, ticket) = _rideBus(_sendParam, messagingFee, amountOutSD, _refundAddress);
        }

        emit OFTSent(
            msgReceipt.guid,
            _sendParam.dstEid,
            msg.sender,
            oftReceipt.amountSentLD,
            oftReceipt.amountReceivedLD
        );
    }

	/**
	 * @notice Get Cross Chain Borrow Fee amount.
	 * @param amount Fee cost.
	 * @return Fee amount for cross chain borrow
	 */
	function getXChainBorrowFeeAmount(uint256 amount) public view returns (uint256) {
		uint256 feeAmount = (amount * (xChainBorrowFeePercent)) / (FEE_PERCENT_DIVISOR);
		return feeAmount;
	}

	/// @notice Provides a quote for sending OFT to another chain.
	/// @dev Implements the IOFT interface
	/// @param _sendParam The parameters for the send operation
	/// @return limit The information on OFT transfer limits
	/// @return oftFeeDetails The details of OFT transaction cost or reward
	/// @return receipt The OFT receipt information, indicating how many tokens would be sent and received

	function quoteOFT(
		SendParam calldata _sendParam
	) external view returns (OFTLimit memory limit, OFTFeeDetail[] memory oftFeeDetails, OFTReceipt memory receipt) {
		// cap the transfer to the paths limit
		limit = OFTLimit(_sd2ld(1), _sd2ld(paths[_sendParam.dstEid].credit));

		// get the expected amount in the destination chain from FeeLib
		uint64 amountInSD = _ld2sd(_sendParam.amountLD > limit.maxAmountLD ? limit.maxAmountLD : _sendParam.amountLD);
		FeeParams memory params = _buildFeeParams(_sendParam.dstEid, amountInSD, _isTaxiMode(_sendParam.oftCmd));
		uint64 amountOutSD = IStargateFeeLib(feeLib).applyFeeView(params);

		// fill in the FeeDetails if there is a fee or reward
		if (amountOutSD != amountInSD) {
			oftFeeDetails = new OFTFeeDetail[](1);
			if (amountOutSD < amountInSD) {
				// fee
				oftFeeDetails[0] = OFTFeeDetail(-1 * _sd2ld(amountInSD - amountOutSD).toInt256(), "protocol fee");
			} else if (amountOutSD > amountInSD) {
				// reward
				uint64 reward = amountOutSD - amountInSD;
				(amountOutSD, reward) = _capReward(amountOutSD, reward);
				if (amountOutSD == amountInSD) {
					// hide the Fee detail if the reward is capped to 0
					oftFeeDetails = new OFTFeeDetail[](0);
				} else {
					oftFeeDetails[0] = OFTFeeDetail(_sd2ld(reward).toInt256(), "reward");
				}
			}
		}

		receipt = OFTReceipt(_sd2ld(amountInSD), _sd2ld(amountOutSD));
	}

	/// @notice Provides a quote for the send() operation.
	/// @dev Implements the IOFT interface.
	/// @dev Reverts with InvalidAmount if send mode is drive but value is specified.
	/// @param _sendParam The parameters for the send() operation
	/// @param _payInLzToken Flag indicating whether the caller is paying in the LZ token
	/// @return fee The calculated LayerZero messaging fee from the send() operation
	/// @dev MessagingFee: LayerZero message fee
	///   - nativeFee: The native fee.
	///   - lzTokenFee: The LZ token fee.

	function quoteSend(
		SendParam calldata _sendParam,
		bool _payInLzToken
	) external view returns (MessagingFee memory fee) {
		uint64 amountSD = _ld2sd(_sendParam.amountLD);
		if (amountSD == 0) revert Stargate_InvalidAmount();

		bool isTaxi = _isTaxiMode(_sendParam.oftCmd);
		if (isTaxi) {
			fee = ITokenMessaging(tokenMessaging).quoteTaxi(
				TaxiParams({
					sender: msg.sender,
					dstEid: _sendParam.dstEid,
					receiver: _sendParam.to,
					amountSD: amountSD,
					composeMsg: _sendParam.composeMsg,
					extraOptions: _sendParam.extraOptions
				}),
				_payInLzToken
			);
		} else {
			bool nativeDrop = _sendParam.extraOptions.length > 0;
			fee = ITokenMessaging(tokenMessaging).quoteRideBus(_sendParam.dstEid, nativeDrop);
		}
	}

	function _taxi(
		SendParam calldata _sendParam,
		MessagingFee memory _messagingFee,
		uint64 _amountSD,
		address _refundAddress
	) internal returns (MessagingReceipt memory receipt) {
		if (_messagingFee.lzTokenFee > 0) _payLzToken(_messagingFee.lzTokenFee); // handle lz token fee

		receipt = ITokenMessaging(tokenMessaging).taxi{value: _messagingFee.nativeFee}(
			TaxiParams({
				sender: msg.sender,
				dstEid: _sendParam.dstEid,
				receiver: _sendParam.to,
				amountSD: _amountSD,
				composeMsg: _sendParam.composeMsg,
				extraOptions: _sendParam.extraOptions
			}),
			_messagingFee,
			_refundAddress
		);
	}

	function _rideBus(
		SendParam calldata _sendParam,
		MessagingFee memory _messagingFee,
		uint64 _amountSD,
		address _refundAddress
	) internal virtual returns (MessagingReceipt memory receipt, Ticket memory ticket) {
		if (_messagingFee.lzTokenFee > 0) revert Stargate_LzTokenUnavailable();

		(receipt, ticket) = ITokenMessaging(tokenMessaging).rideBus(
			RideBusParams({
				sender: msg.sender,
				dstEid: _sendParam.dstEid,
				receiver: _sendParam.to,
				amountSD: _amountSD,
				nativeDrop: _sendParam.extraOptions.length > 0
			})
		);

		uint256 busFare = receipt.fee.nativeFee;
		uint256 providedFare = _messagingFee.nativeFee;

		// assert sufficient nativeFee was provided to cover the fare
		if (busFare == providedFare) {
			// return; Do nothing in this case
		} else if (providedFare > busFare) {
			uint256 refund;
			unchecked {
				refund = providedFare - busFare;
			}
			Transfer.transferNative(_refundAddress, refund, false); // no gas limit to refund
		} else {
			revert Stargate_InsufficientFare();
		}
	}

	/// @notice Pay the LZ fee in LZ tokens.
    /// @dev Reverts with LzTokenUnavailable if the LZ token OFT has not been set.
    /// @param _lzTokenFee The fee to pay in LZ tokens
    function _payLzToken(uint256 _lzTokenFee) internal {
        address lzTkn = lzToken;
        if (lzTkn == address(0)) revert Stargate_LzTokenUnavailable();
        Transfer.safeTransferTokenFrom(lzTkn, msg.sender, address(endpoint), _lzTokenFee);
    }

	/// @notice Translate an amount in SD to LD
    /// @dev Since SD <= LD by definition, convertRate >= 1, so there is no rounding errors in this function.
    /// @param _amountSD The amount in SD
    /// @return amountLD The same value expressed in LD
    function _sd2ld(uint64 _amountSD) internal view returns (uint256 amountLD) {
        unchecked {
            amountLD = _amountSD * convertRate;
        }
    }

    /// @notice Translate an value in LD to SD
    /// @dev Since SD <= LD by definition, convertRate >= 1, so there might be rounding during the cast.
    /// @param _amountLD The value in LD
    /// @return amountSD The same value expressed in SD
    function _ld2sd(uint256 _amountLD) internal view returns (uint64 amountSD) {
        unchecked {
            amountSD = SafeCast.toUint64(_amountLD / convertRate);
        }
    }

	/// @dev Build the FeeParams object for the FeeLib
    /// @param _dstEid The destination endpoint ID
    /// @param _amountInSD The amount to send in SD
    /// @param _isTaxi Whether this send is riding the bus or taxing
    function _buildFeeParams(
        uint32 _dstEid,
        uint64 _amountInSD,
        bool _isTaxi
    ) internal view virtual returns (FeeParams memory);

	/// @dev if _cmd is empty, Taxi mode. Otherwise, Bus mode
    function _isTaxiMode(bytes calldata _oftCmd) internal pure returns (bool) {
        return _oftCmd.length == 0;
    }

	// ---------------------------------- Virtual Functions ------------------------------------------

    /// @notice Limits the reward awarded when withdrawing value.
    /// @param _amountOutSD The amount of expected on the destination chain in SD
    /// @param _reward The initial calculated reward by FeeLib
    /// @return newAmountOutSD The actual amount to be delivered on the destination chain
    /// @return newReward The actual reward after applying any caps
    function _capReward(
        uint64 _amountOutSD,
        uint64 _reward
    ) internal view virtual returns (uint64 newAmountOutSD, uint64 newReward);
}