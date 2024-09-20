import {ethers} from 'hardhat';
import {
	ChefIncentivesController,
	Compounder,
	LendingPool,
	LockZap,
	MiddleFeeDistribution,
	MockToken,
	MultiFeeDistribution,
} from '../typechain';
import {advanceTimeAndBlock} from './utils';
import {node_url} from '../utils/network';

(async () => {
	const provider = new ethers.providers.JsonRpcProvider(node_url('localhost'));
	// Test usersgetNamedAccounts
	const testUserOne = '0xBcd4042DE499D14e55001CcbB24a551F3b954096';
	const testUserTwo = '0x71bE63f3384f5fb98995898A86B02Fb2426c5788';
	const testUserThree = '0xFABB0ac9d68B0B445fB7357272Ff202C5651694a';
	const testUserFour = '0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec';
	const testUserOneSigner = await ethers.getSigner(testUserOne);
	const testUserTwoSigner = await ethers.getSigner(testUserTwo);
	const testUserThreeSigner = await ethers.getSigner(testUserThree);
	const testUserFourSigner = await ethers.getSigner(testUserFour);
	const testUsers = [testUserOne, testUserTwo, testUserThree, testUserFour];
	const testUserSigners = [testUserOneSigner, testUserTwoSigner, testUserThreeSigner, testUserFourSigner];

	const wethAddress = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
	const cicOwner = '0x111CEEee040739fD91D29C34C33E6B3E112F2177';
	const cicOwnerSigner = await ethers.getSigner(cicOwner);
	const threeMonths = 60 * 60 * 24 * 30 * 3 + 1;
	const prntTokenAddress = '0x3082CC23568eA640225c2467653dB90e9250AaA0';
	const prntHolder = '0x9d9e4A95765154A575555039E9E2a321256B5704';
	const pWETH = await ethers.getContractAt('MockToken', '0x0dF5dfd95966753f01cb80E76dc20EA958238C46');
	const prntERC20: MockToken = await ethers.getContractAt('MockToken', prntTokenAddress);
	const wethERC20 = await ethers.getContractAt('contracts/interfaces/IWETH.sol:IWETH', wethAddress);

	const lockZapContract: LockZap = await ethers.getContractAt(
		'LockZap',
		'0x8991C4C347420E476F1cf09C03abA224A76E2997'
	);
	const lendingPool: LendingPool = await ethers.getContractAt(
		'LendingPool',
		'0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1'
	);
	const mfdContract: MultiFeeDistribution = await ethers.getContractAt(
		'MultiFeeDistribution',
		'0x76ba3eC5f5adBf1C58c91e86502232317EeA72dE'
	);
	const cicContract: ChefIncentivesController = await ethers.getContractAt(
		'ChefIncentivesController',
		'0xebC85d44cefb1293707b11f707bd3CEc34B4D5fA'
	);
	const middleContract: MiddleFeeDistribution = await ethers.getContractAt(
		'MiddleFeeDistribution',
		'0xE10997B8d5C6e8b660451f61accF4BBA00bc901f'
	);

	// testUserOne sends ETH to prntHolder
	await provider.send('hardhat_impersonateAccount', [testUserOne]);
	await testUserOneSigner.sendTransaction({
		to: prntHolder,
		value: ethers.utils.parseEther('1'),
	});

	//prntHolder sends PRNT to testUserOne
	await provider.send('hardhat_impersonateAccount', [prntHolder]);
	const rndtHolderSigner = await ethers.getSigner(prntHolder);

	for (let i = 0; i < testUsers.length; i++) {
		await prntERC20.connect(rndtHolderSigner).transfer(testUsers[i], ethers.utils.parseEther('20000'));
	}

	// Increase PRNT rewards
	await prntERC20.connect(rndtHolderSigner).transfer(cicContract.address, ethers.utils.parseEther('100000000'));
	await cicContract.connect(cicOwnerSigner).registerRewardDeposit(ethers.utils.parseEther('100000000'));

	////////////////////////
	// Make User Eligible //
	////////////////////////
	// Lock a lot of LP
	let prntAmountToZap = ethers.utils.parseEther('20000');

	for (let i = 0; i < testUsers.length; i++) {
		let requiredETH = await lockZapContract.quoteFromToken(wethAddress, prntAmountToZap);
		await prntERC20.connect(testUserSigners[i]).approve(lockZapContract.address, prntAmountToZap);
		await lockZapContract
			.connect(testUserSigners[i])
			.zap(false, ethers.constants.AddressZero, requiredETH, prntAmountToZap, 1, 9600, {
				value: requiredETH,
			});

		// Deposit some funds into lending market
		const depositAmount = ethers.utils.parseEther('60');
		await wethERC20.connect(testUserSigners[i]).deposit({value: depositAmount});
		await wethERC20.connect(testUserSigners[i]).approve(lendingPool.address, depositAmount);
		await lendingPool.connect(testUserSigners[i]).deposit(wethAddress, depositAmount, testUsers[i], 0);
	}

	//////////////////////////////////////////////////////
	// Generate Fees (Distributed to eligible accounts)   //
	//////////////////////////////////////////////////////
	const rewardAmount = ethers.utils.parseEther('2000');
	await wethERC20.connect(testUserOneSigner).deposit({value: rewardAmount});
	await wethERC20.connect(testUserOneSigner).approve(lendingPool.address, rewardAmount);
	await lendingPool.connect(testUserOneSigner).deposit(wethAddress, rewardAmount, testUserOne, 0);
	await pWETH.connect(testUserOneSigner).transfer(middleContract.address, rewardAmount);
	await mfdContract.connect(testUserTwoSigner).getReward([pWETH.address]);

	///////////////////////////
	// Generate Vested PRNT  //
	///////////////////////////
	// Advance time for 3 months (Thus unlocking the zapped position, we have gained some PRNT to vest)
	await advanceTimeAndBlock(threeMonths);

	// Claim all rewards, so that PRNT tokens are started to be vested
	for (let i = 0; i < testUsers.length; i++) {
		await cicContract.connect(testUserSigners[i]).claimAll(testUsers[i]);
	}

	// Skip 3 months, so that PRNT finished vesting and dLP unlocks
	await advanceTimeAndBlock(threeMonths);
})();
