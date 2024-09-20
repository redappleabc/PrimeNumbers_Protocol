// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockFaucetToken is ERC20 {
    error NOT_A_MINTER();
    error DELAY_PERIOD_NOT_REACHED();
    error NOT_THE_OWNER();

    mapping (address => uint) lastClaimTimestamp;
    mapping (address => bool) isMinter;

    address public owner;

    uint256 public faucetAmount;

    uint256 constant DELAY_PERIOD = 1 days;

    uint8 private decimals_;

	constructor(string memory _name, string memory _symbol, uint256 _faucetAmount, uint8 _decimals) ERC20(_name, _symbol) {
        decimals_ = _decimals;
        owner = _msgSender();
        isMinter[owner] = true;
        faucetAmount = _faucetAmount;
    }

    function transferOwnership(address newOwner) public {
        address caller = _msgSender();

        if(caller != owner) {
            revert NOT_THE_OWNER();
        }

        owner = newOwner;
    }

    function updateMinterStatus(address to, bool canMint) public {
        address caller = _msgSender();

        if(caller != owner) {
            revert NOT_THE_OWNER();
        }

        isMinter[to] = canMint;
    }

    function mint(address _to, uint256 _amount) public {
        address caller = _msgSender();

        if(!isMinter[caller]) {
            revert NOT_A_MINTER();
        }

		_mint(_to, _amount);
	}

	function getFaucetFunds() external {
        address onBehalf = _msgSender();

        if(block.timestamp < lastClaimTimestamp[onBehalf] + DELAY_PERIOD) {
            revert DELAY_PERIOD_NOT_REACHED();
        }

        lastClaimTimestamp[onBehalf] = block.timestamp;

        _mint(onBehalf, faucetAmount);
    }

    function updateFaucetAmount(uint256 _faucetAmount) external {
        address caller = _msgSender();

        if(caller != owner) {
            revert NOT_THE_OWNER();
        }

        faucetAmount = _faucetAmount;
    }

    function decimals() public view override returns (uint8) {
		return decimals_;
	}
}
