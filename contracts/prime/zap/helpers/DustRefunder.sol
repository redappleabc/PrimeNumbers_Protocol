// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IWETH} from "../../../interfaces/IWETH.sol";

/// @title Dust Refunder Contract
/// @dev Refunds dust tokens remaining from zapping.
/// @author Prime
contract DustRefunder {
	using SafeERC20 for IERC20;

	/**
	 * @notice Refunds PRNT and WETH.
	 * @param _prnt PRNT address
	 * @param _weth WETH address
	 * @param _refundAddress Address for refund
	 */
	function _refundDust(address _prnt, address _weth, address _refundAddress) internal {
		IERC20 prnt = IERC20(_prnt);
		IWETH weth = IWETH(_weth);

		uint256 dustWETH = weth.balanceOf(address(this));
		if (dustWETH > 0) {
			weth.transfer(_refundAddress, dustWETH);
		}
		uint256 dustPrnt = prnt.balanceOf(address(this));
		if (dustPrnt > 0) {
			prnt.safeTransfer(_refundAddress, dustPrnt);
		}
	}
}
