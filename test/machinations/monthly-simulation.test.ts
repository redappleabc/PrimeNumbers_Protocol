import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {ethers, upgrades} from 'hardhat';
import {advanceTimeAndBlock} from '../../scripts/utils';
import {
	BountyManager,
	LendingPool,
	MultiFeeDistribution,
	ERC20,
	VariableDebtToken,
	Leverager,
	WETH,
	WETHGateway,
	Compounder,
	EligibilityDataProvider,
	PriceProvider,
	MiddleFeeDistribution,
	CustomERC20,
	TestnetLockZap,
	PrimeToken,
	UniswapPoolHelper,
	UniswapV2Router02,
	AToken,
	ChefIncentivesController
} from '../../typechain';
import _ from 'lodash';
import chai from 'chai';
import {solidity} from 'ethereum-waffle';
import {DeployConfig, DeployData, LP_PROVIDER} from '../../scripts/deploy/types';
import {deposit, doBorrow, toNum, zap} from '../bounties/helpers';
import {setupTest} from '../setup';
import { DAY } from '../../config/constants';
import { sellPrnt, getLatestBlockTimestamp, zapIntoEligibility, getTotalPendingRewards } from '../shared/helpers';
import { BigNumber } from 'ethers';

chai.use(solidity);
const {expect} = chai;

let multiFeeDistribution: MultiFeeDistribution;
let eligibilityProvider: EligibilityDataProvider;
let middleFeeDistribution: MiddleFeeDistribution;
let compounder: Compounder;
let lendingPool: LendingPool;
let leverager: Leverager;
let wethGateway: WETHGateway;
let weth: WETH;
let priceProvider: PriceProvider;
let deployData: DeployData;
let user1: SignerWithAddress;
let user2: SignerWithAddress;
let user3: SignerWithAddress;
let staker: SignerWithAddress;
let borrower: SignerWithAddress;
let liquidator : SignerWithAddress;
let hunter: SignerWithAddress;
let vdWETH: VariableDebtToken;
let deployer: SignerWithAddress;
let DEFAULT_LOCK_TIME: number;
let LOCK_DURATION: number;
let SKIP_DURATION: number;
let bountyManager: BountyManager;
let lpToken: ERC20;
let prntToken: PrimeToken;
let usdc: CustomERC20;
let dao: SignerWithAddress;
let lockZap: TestnetLockZap;
let stakingToken: string;
let deployConfig: DeployConfig;
let poolHelperAddress: string;
let poolHelper: UniswapPoolHelper;
let uniRouterAddress: string;
let uniV2Router: UniswapV2Router02;
let chefIncentivesController: ChefIncentivesController;
let stakedAmount: BigNumber = BigNumber.from(0);
const eligibleAmt = 1000000;
const acceptableUserSlippage = 9500;
const rewardsByMonth: BigNumber[] = [];
let monthIndex = 0;

const zapAndDeposit = async (defaultLockTime: number, depositAmt: number) => {
	// await multiFeeDistribution.connect(user1).setRelock(relock);
	await multiFeeDistribution.connect(user1).setDefaultRelockTypeIndex(defaultLockTime);
	await deposit('pUSDC', depositAmt.toString(), user1, lendingPool, deployData);
	await zap(user1, deployData, true, defaultLockTime);

	// Now Locked
	const isEligible = await eligibilityProvider.isEligibleForRewards(user1.address);
	const lockedUsd = await eligibilityProvider.lockedUsdValue(user1.address);
	const requiredUsdValue = await eligibilityProvider.requiredUsdValue(user1.address);
	return {
		isEligible,
		lockedUsd,
		requiredUsdValue,
	};
};

const loadZappedUserFixture = async () => {
	({
		multiFeeDistribution,
		eligibilityProvider,
		middleFeeDistribution,
		lendingPool,
		leverager,
		weth,
		wethGateway,
		priceProvider,
		chefIncentivesController,
		deployData,
		LOCK_DURATION,
		deployConfig,
		compounder,
		bountyManager,
		user1,
		user2,
		user3,
		user4: borrower,
		user5: liquidator,
		deployer,
		prntToken,
		usdc,
		dao
	} = await setupTest());
	const {read} = deployments;

	hunter = user2;
	DEFAULT_LOCK_TIME = LOCK_DURATION;
	SKIP_DURATION = DEFAULT_LOCK_TIME / 20;
	lpToken = await ethers.getContractAt('ERC20', deployData.stakingToken);
	lockZap = await ethers.getContractAt('TestnetLockZap', deployData.lockZap);
	stakingToken = await read('UniswapV2Factory', 'getPair', prntToken.address, weth.address);
	poolHelperAddress = await lockZap.getPoolHelper();
	poolHelper = <UniswapPoolHelper>await ethers.getContractAt('UniswapPoolHelper', poolHelperAddress);
	staker = (await ethers.getSigners())[11];

	// Deposit assets
	await deposit('pWETH', '10000', deployer, lendingPool, deployData);
	await zapAndDeposit(0, eligibleAmt);
};

const sell = async () => {
	let sellAmt = '800000000';
	if (deployConfig.LP_PROVIDER == LP_PROVIDER.BALANCER) {
		sellAmt = ethers.utils.formatEther(deployConfig.LP_INIT_PRNT.div(5));
	}

	await sellPrnt(sellAmt, dao, prntToken, lockZap, priceProvider, stakingToken);
	await advanceTimeAndBlock(3601);
	await priceProvider.update();
}

const stakeAndCheckRewards = async (user: SignerWithAddress) => {
	await lpToken.transfer(user.address, ethers.utils.parseUnits('1000', 18));
	const lpBalance = await lpToken.balanceOf(user.address);
	stakedAmount = stakedAmount.add(lpBalance);
	console.log("lpBalance: ", lpBalance);
	console.log("staked amount: ", stakedAmount);
	await deposit('pWETH', '100', user, lendingPool, deployData);
	await lpToken.connect(user).approve(multiFeeDistribution.address, ethers.constants.MaxUint256);

	await multiFeeDistribution.connect(user).stake(lpBalance, user.address, 0);

	const lockedVaule1 = await eligibilityProvider.lockedUsdValue(user.address);

	const lpTokenPriceUsd = await priceProvider.getLpTokenPriceUsd();
	const expectedLockedUsdVal = lpTokenPriceUsd.mul(stakedAmount).div(ethers.utils.parseUnits('1', 18));
	
	expect(lockedVaule1).to.be.equal(expectedLockedUsdVal);

	// For test purpose, lockedValue should exceed required
	const required = await eligibilityProvider.requiredUsdValue(user.address);
	expect(lockedVaule1).to.be.gt(required);
	console.log("locked value: ", lockedVaule1, " required: ", required);
	expect(await eligibilityProvider.isEligibleForRewards(user.address)).to.be.equal(true);
	const pendingRewards = await getTotalPendingRewards(user.address, chefIncentivesController);
	console.log("initial pending rewards: ", pendingRewards);
	const previusMonthReward = monthIndex > 0 ? rewardsByMonth[monthIndex - 1] : BigNumber.from("0");
	rewardsByMonth.push(pendingRewards.sub(previusMonthReward));
}

describe(`Machinations Simulation`, async () => {
	const {read} = deployments;

	before(async () => {
		await loadZappedUserFixture();
		// await zapIntoEligibility(user2, deployData);
	});

	it('First Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 10,000,000 PRNT
		await deposit('pPRNT', '5000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '3000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '2000000', user3, lendingPool, deployData);

		//borrower borrows 3,000,000 PRNT using ETH as collateral
		await deposit('pWETH', '20000', borrower, lendingPool, deployData);
		await doBorrow('pPRNT', '3000000', borrower, lendingPool, deployData);


		await doBorrow('pPRNT', '2000000', user2, lendingPool, deployData);
		await doBorrow('pPRNT', '1000000', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('240000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 240,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//18,000 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(18000, 1);

			//decrease PRNT price back.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(deployerBalanceIncreasement, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);
	
			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			expect(prntPriceInUSDAfterMonth).closeTo(9.1, 0.2);
		}

	});

	it('Second Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 16896552 PRNT
		await deposit('pPRNT', '3000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '2000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '1896552', user3, lendingPool, deployData);

		//borrower borrows 5,000,000 PRNT using ETH as collateral
		await deposit('pWETH', '40000', borrower, lendingPool, deployData);
		await doBorrow('pPRNT', '2000000', borrower, lendingPool, deployData);


		await doBorrow('pPRNT', '1000000', user2, lendingPool, deployData);
		await doBorrow('pPRNT', '1137931.2', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('405520', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 405,520 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//18,000 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(30414, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(4).div(5);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(11.2, 0.2);
		}

	});

	it('Third Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 25,789,475 PRNT
		await deposit('pPRNT', '4500000', user1, lendingPool, deployData);
		await deposit('pPRNT', '2500000', user2, lendingPool, deployData);
		await deposit('pPRNT', '1892923', user3, lendingPool, deployData);

		//borrower borrows 15,473,685 PRNT using ETH as collateral
		await deposit('pWETH', '40000', borrower, lendingPool, deployData);
		await doBorrow('pPRNT', '2000000', borrower, lendingPool, deployData);


		await doBorrow('pPRNT', '2000000', user2, lendingPool, deployData);
		await doBorrow('pPRNT', '1335753.8', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('618950', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 618,950 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//46,421 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(46421, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(5).div(6);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(13.3, 0.2);
		}

	});

	it('Fourth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 36,763,720 PRNT
		await deposit('pPRNT', '5500000', user1, lendingPool, deployData);
		await deposit('pPRNT', '2500000', user2, lendingPool, deployData);
		await deposit('pPRNT', '2974245', user3, lendingPool, deployData);

		//borrower borrows 22,058,232 PRNT using ETH as collateral
		await deposit('pWETH', '40000', borrower, lendingPool, deployData);
		await doBorrow('pPRNT', '5000000', borrower, lendingPool, deployData);

		await doBorrow('pPRNT', '1000000', user2, lendingPool, deployData);

		await doBorrow('pPRNT', '584547', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('882330', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 882,330 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//66,174 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(66174, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(6).div(7);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(15.4, 0.2);
		}

	});

	it('Fifth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 49,893,620 PRNT
		await deposit('pPRNT', '7000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '5000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '1129900', user3, lendingPool, deployData);

		//borrower borrows 29,936,172 PRNT using ETH as collateral
		await deposit('pWETH', '50000', borrower, lendingPool, deployData);
		await doBorrow('pPRNT', '5000000', borrower, lendingPool, deployData);


		await doBorrow('pPRNT', '2000000', user2, lendingPool, deployData);

		await doBorrow('pPRNT', '1877940', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('1200000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 1,200,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//90,000 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(90000, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(6).div(7);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(17.5, 0.2);
		}

	});

	it('Sixth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 65,245,504 PRNT
		await deposit('pPRNT', '5000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '5000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '5351884', user3, lendingPool, deployData);

		//borrower borrows 39,147,302.4 PRNT using ETH as collateral
		await deposit('pWETH', '100000', borrower, lendingPool, deployData);
		await doBorrow('pPRNT', '5000000', borrower, lendingPool, deployData);


		await doBorrow('pPRNT', '1000000', user2, lendingPool, deployData);

		await doBorrow('pPRNT', '2211130.4', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('1570000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 1,570,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//117,750 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(117750, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(7).div(8);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(19.6, 0.2);
		}

	});

	it('Seventh Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 82,879,425 PRNT
		await deposit('pPRNT', '8000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '8000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '1633921', user3, lendingPool, deployData);

		//borrower borrows 49,727,655 PRNT using ETH as collateral
		await deposit('pWETH', '100000', borrower, lendingPool, deployData);
		await doBorrow('pPRNT', '5000000', borrower, lendingPool, deployData);

		await doBorrow('pPRNT', '5000000', user2, lendingPool, deployData);

		await doBorrow('pPRNT', '580352.6', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('1990000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 1,990,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//149,250 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(149250, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(7).div(8);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(21.7, 0.2);
		}

	});

	it('Eighth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 102,850,371 PRNT
		await deposit('pPRNT', '12000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '7000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '970946', user3, lendingPool, deployData);

		//borrower borrows 39,147,302.4 PRNT using ETH as collateral
		await deposit('pWETH', '200000', borrower, lendingPool, deployData);

		await doBorrow('pPRNT', '5000000', borrower, lendingPool, deployData);

		await doBorrow('pPRNT', '5000000', user2, lendingPool, deployData);

		await doBorrow('pPRNT', '1982567.6', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('2470000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 2,470,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//185,250 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(185250, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(8).div(9);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(23.8, 0.2);
		}

	});

	it('Nineth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 125,209,148 PRNT
		await deposit('pPRNT', '10000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '5000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '7358777', user3, lendingPool, deployData);

		//borrower borrows 75,125,488.8 PRNT using ETH as collateral
		await deposit('pWETH', '100000', borrower, lendingPool, deployData);
		await doBorrow('pPRNT', '5000000', borrower, lendingPool, deployData);


		await doBorrow('pPRNT', '5000000', user2, lendingPool, deployData);

		await doBorrow('pPRNT', '3415266.2', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('3010000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 3,010,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//225,750 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(225750, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(8).div(9);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(25.9, 0.2);
		}

	});

	it('Tenth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 150,003,039 PRNT
		await deposit('pPRNT', '10000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '10000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '4793891', user3, lendingPool, deployData);

		//borrower borrows 75,125,488.8 PRNT using ETH as collateral
		await deposit('pWETH', '300000', borrower, lendingPool, deployData);

		await doBorrow('pPRNT', '10000000', borrower, lendingPool, deployData);

		await doBorrow('pPRNT', '4876334.6', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('3600000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 3,600,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//270,000 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(270000, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(9).div(10);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(28, 0.2);
		}

	});

	it('Eleventh Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 177,276,319 PRNT
		await deposit('pPRNT', '15000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '10000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '2273280', user3, lendingPool, deployData);

		//borrower borrows 106,365,791.4 PRNT using ETH as collateral
		await deposit('pWETH', '300000', borrower, lendingPool, deployData);

		await doBorrow('pPRNT', '7000000', borrower, lendingPool, deployData);

		await doBorrow('pPRNT', '7000000', user2, lendingPool, deployData);

		await doBorrow('pPRNT', '2363968', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('4250000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 4,250,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//318,750 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(318750, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(10).div(11);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(30.1, 0.2);
		}

	});

	it('Twelfth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 207,070,659 PRNT
		await deposit('pPRNT', '15000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '10000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '4794340', user3, lendingPool, deployData);

		//borrower borrows 124,242,395.4 PRNT using ETH as collateral
		await deposit('pWETH', '300000', borrower, lendingPool, deployData);
		await doBorrow('pPRNT', '10000000', borrower, lendingPool, deployData);

		await doBorrow('pPRNT', '4000000', user2, lendingPool, deployData);

		await doBorrow('pPRNT', '3876604', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('4970000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 4,970,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//372,750 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(372750, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(10).div(11);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(32.2, 0.2);
		}

	});

	it('Thirteenth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 239,425,450 PRNT
		await deposit('pPRNT', '20000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '10000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '2354791', user3, lendingPool, deployData);

		await deposit('pWETH', '300000', user3, lendingPool, deployData);

		//borrower borrows 143,655,270 PRNT using ETH as collateral
		await deposit('pWETH', '300000', borrower, lendingPool, deployData);
		await doBorrow('pPRNT', '10000000', borrower, lendingPool, deployData);

		await doBorrow('pPRNT', '6000000', user2, lendingPool, deployData);

		await doBorrow('pPRNT', '3412874.6', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('5750000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 5,750,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//431,250 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(431250, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(10).div(11);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(34.3, 0.2);
		}

	});

	it('Fourteenth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 274,378,071 PRNT
		await deposit('pPRNT', '15000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '15000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '4952621', user3, lendingPool, deployData);

		//borrower borrows 143,655,270 PRNT using ETH as collateral
		await deposit('pWETH', '300000', borrower, lendingPool, deployData);
		await doBorrow('pPRNT', '10000000', borrower, lendingPool, deployData);

		await doBorrow('pPRNT', '10000000', user2, lendingPool, deployData);

		await doBorrow('pPRNT', '971572.6', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('6590000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 6,590,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//494,250 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(494250, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(10).div(11);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(36.4, 0.2);
		}

	});

	it('Fifteenth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 311,964,109 PRNT
		await deposit('pPRNT', '20000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '5000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '12586038', user3, lendingPool, deployData);

		//borrower borrows 187,178,465.4 PRNT using ETH as collateral
		await deposit('pWETH', '700000', borrower, lendingPool, deployData);
		await doBorrow('pPRNT', '15000000', borrower, lendingPool, deployData);

		await doBorrow('pPRNT', '5000000', user2, lendingPool, deployData);

		await doBorrow('pPRNT', '2551622.8', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('7490000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 7,490,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//561,750 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(561750, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(11).div(12);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(38.5, 0.2);
		}

	});

	it('Sixteenth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 352,217,543 PRNT
		await deposit('pPRNT', '20000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '15000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '5253434', user3, lendingPool, deployData);

		//borrower borrows 211,330,525.8 PRNT using ETH as collateral
		await deposit('pWETH', '700000', borrower, lendingPool, deployData);
		await doBorrow('pPRNT', '10000000', borrower, lendingPool, deployData);

		await doBorrow('pPRNT', '10000000', user2, lendingPool, deployData);

		await doBorrow('pPRNT', '4152060.4', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('8450000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 8,450,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//633,750 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(633750, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(59).div(90);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(48.81, 0.2);
		}

	});

	it('Seventeenth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 395,170,902 PRNT
		await deposit('pPRNT', '15000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '25000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '2953359', user3, lendingPool, deployData);

		//borrower borrows 237,102,541.2 PRNT using ETH as collateral
		await deposit('pWETH', '700000', borrower, lendingPool, deployData);
		await doBorrow('pPRNT', '10000000', borrower, lendingPool, deployData);

		await doBorrow('pPRNT', '15000000', user2, lendingPool, deployData);

		await doBorrow('pPRNT', '772015.4', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('9480000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 9,480,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//711,000 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(711000, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(99).div(80);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(42.7, 0.2);
		}

	});

	it('Eighteenth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 440,855,400 PRNT
		await deposit('pPRNT', '30000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '10000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '5684498', user3, lendingPool, deployData);

		//borrower borrows 264,513,240 PRNT using ETH as collateral
		await deposit('pWETH', '700000', borrower, lendingPool, deployData);
		await doBorrow('pPRNT', '15000000', borrower, lendingPool, deployData);

		await doBorrow('pPRNT', '10000000', user2, lendingPool, deployData);

		await doBorrow('pPRNT', '2410698.8', user3, lendingPool, deployData);

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('10580000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 10,580,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//793,500 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(793500, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(12).div(13);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(44.8, 0.2);
		}

	});

	it('Nineteenth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 489,301,049 PRNT
		await deposit('pPRNT', '25000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '15000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '8445649', user3, lendingPool, deployData);

		//borrower borrows 293,580,629.4 PRNT using ETH as collateral
		await deposit('pWETH', '700000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '15000000', borrower, lendingPool, deployData);
		

		await doBorrow('pPRNT', '10000000', user2, lendingPool, deployData);
		

		await doBorrow('pPRNT', '4067389.4', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('11740000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 11,740,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//880,500 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(880500, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(14).div(15);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(46.9, 0.2);
		}

	});

	it('Twentieth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 540,536,761 PRNT
		await deposit('pPRNT', '25000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '15000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '11235712', user3, lendingPool, deployData);

		//borrower borrows 324,322,056.6 PRNT using ETH as collateral
		await deposit('pWETH', '700000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '15000000', borrower, lendingPool, deployData);
		

		await doBorrow('pPRNT', '10000000', user2, lendingPool, deployData);
		

		await doBorrow('pPRNT', '5741427.2', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('12970000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 12,970,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//972,750 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(972750, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(13).div(14);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(49, 0.2);
		}

	});

	it('Twenty-first Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 594,590,438 PRNT
		await deposit('pPRNT', '27000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '13000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '14053677', user3, lendingPool, deployData);

		//borrower borrows 356,754,262.8 PRNT using ETH as collateral
		await deposit('pWETH', '700000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '15000000', borrower, lendingPool, deployData);
		

		await doBorrow('pPRNT', '15000000', user2, lendingPool, deployData);
		

		await doBorrow('pPRNT', '2432206.2', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('14270000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 14,270,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//1,070,250 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(1070250, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(14).div(15);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(51.1, 0.2);
		}

	});

	it('Twenty-second Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 651,489,045 PRNT
		await deposit('pPRNT', '28000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '27000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '1898607', user3, lendingPool, deployData);

		//borrower borrows 390,893,427 PRNT using ETH as collateral
		await deposit('pWETH', '700000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '5000000', borrower, lendingPool, deployData);
		

		await doBorrow('pPRNT', '5000000', user2, lendingPool, deployData);
		

		await doBorrow('pPRNT', '24139164.2', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('15640000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 15,640,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//1,173,000 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(1173000, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(14).div(15);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(53.2, 0.2);
		}

	});

	it('Twenty-third Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 711,258,683 PRNT
		await deposit('pPRNT', '30000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '15000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '14769638', user3, lendingPool, deployData);

		//borrower borrows 426,755,209.8 PRNT using ETH as collateral
		await deposit('pWETH', '1000000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '30000000', borrower, lendingPool, deployData);
		

		await doBorrow('pPRNT', '5000000', user2, lendingPool, deployData);
		
		await doBorrow('pPRNT', '861782.8', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('17070000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 17,070,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//1,280,250 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(1280250, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(15).div(16);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(55.3, 0.2);
		}

	});

	it('twenty-fourth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 773,924,647 PRNT
		await deposit('pPRNT', '30000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '10000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '22665964', user3, lendingPool, deployData);

		//borrower borrows 464,354,788.2 PRNT using ETH as collateral
		await deposit('pWETH', '1400000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '20000000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '10000000', user2, lendingPool, deployData);
		

		await doBorrow('pPRNT', '7599578.4', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('18570000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 18,570,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//1,392,750 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(1392750, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(15).div(16);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(57.4, 0.2);
		}

	});

	it('twenty-fifth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);
		//Supplied Liquidity from users: 839,511,482 PRNT
		await deposit('pPRNT', '35000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '15000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '15586835', user3, lendingPool, deployData);

		//borrower borrows 503,706,889.2 PRNT using ETH as collateral
		await deposit('pWETH', '1400000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '20000000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '5000000', user2, lendingPool, deployData);
		

		await doBorrow('pPRNT', '14352101', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('20150000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 20,150,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//1,511,250 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(1511250, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(15).div(16);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(59.5, 0.2);
		}

	});

	it('twenty-sixth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 908,043,032 PRNT
		await deposit('pPRNT', '30000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '20000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '18531550', user3, lendingPool, deployData);

		//borrower borrows 544,825,819.2 PRNT using ETH as collateral
		await deposit('pWETH', '1400000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '20000000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '10000000', user2, lendingPool, deployData);
		

		await doBorrow('pPRNT', '11118930', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('21790000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 21,790,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//1,634,250 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(1634250, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(17).div(18);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(61.6, 0.2);
		}

	});

	it('twenty-seventh Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 979,542,484 PRNT
		await deposit('pPRNT', '40000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '20000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '11499452', user3, lendingPool, deployData);

		//borrower borrows 587,725,490.4 PRNT using ETH as collateral
		await deposit('pWETH', '1400000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '20000000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '10000000', user2, lendingPool, deployData);
		

		await doBorrow('pPRNT', '12899671.2', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('23510000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 23,510,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//1,763,250 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(1763250, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(15).div(16);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(63.7, 0.2);
		}

	});

	it('twenty-eighth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 1,054,032,407 PRNT
		await deposit('pPRNT', '10000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '20000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '44489923', user3, lendingPool, deployData);

		//borrower borrows 632,419,444.2 PRNT using ETH as collateral
		await deposit('pWETH', '1400000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '25000000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '15000000', user2, lendingPool, deployData);
		

		await doBorrow('pPRNT', '4693953.8', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('25300000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 25,300,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//1,897,500 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(1897500, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(17).div(18);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(65.8, 0.2);
		}

	});

	it('twenty-nineth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 1,131,534,790 PRNT
		await deposit('pPRNT', '50000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '10000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '17502383', user3, lendingPool, deployData);

		//borrower borrows 678,920,874 PRNT using ETH as collateral
		await deposit('pWETH', '1500000', borrower, lendingPool, deployData);
		await doBorrow('pPRNT', '25000000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '15000000', user2, lendingPool, deployData);
		

		await doBorrow('pPRNT', '6501429.8', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('27160000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 27,160,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//2,037,000 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(2037000, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(19).div(20);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(67.9, 0.2);
		}

	});

	it('Thirtieth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 1,212,071,074 PRNT
		await deposit('pPRNT', '50000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '20000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '10536284', user3, lendingPool, deployData);

		//borrower borrows 727,242,644.4 PRNT using ETH as collateral
		await deposit('pWETH', '1800000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '20000000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '20000000', user2, lendingPool, deployData);
		

		await doBorrow('pPRNT', '8321770.4', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('29090000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 29,090,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//2,181,750 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(2181750, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(15).div(16);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(70, 0.2);
		}

	});

	it('Thirty-first Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 1,295,662,183 PRNT
		await deposit('pPRNT', '50000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '25000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '8591109', user3, lendingPool, deployData);

		//borrower borrows 777,397,309.8 PRNT using ETH as collateral
		await deposit('pWETH', '1800000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '25000000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '15000000', user2, lendingPool, deployData);
		

		await doBorrow('pPRNT', '10154665.4', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('31100000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 31,100,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//2,332,500 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(2332500, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(18).div(19);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(72.1, 0.2);
		}

	});

	it('Thirty-second Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 1,382,328,550 PRNT
		await deposit('pPRNT', '40000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '15000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '31666367', user3, lendingPool, deployData);

		//borrower borrows 829,397,130 PRNT using ETH as collateral
		await deposit('pWETH', '2800000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '30000000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '15000000', user2, lendingPool, deployData);
		
		await doBorrow('pPRNT', '3999820.2', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('33180000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 33,180,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//2,488,500 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(2488500, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(18).div(19);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(74.2, 0.2);
		}

	});

	it('Thirty-third Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 1,472,090,145 PRNT
		await deposit('pPRNT', '45000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '35000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '9761595', user3, lendingPool, deployData);

		//borrower borrows 883,254,087 PRNT using ETH as collateral
		await deposit('pWETH', '2800000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '25000000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '20000000', user2, lendingPool, deployData);
		
		await doBorrow('pPRNT', '11856957', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('35330000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 35,330,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//2,649,750 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(2649750, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(18).div(19);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(76.3, 0.2);
		}

	});

	it('Thirty-fourth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 1,564,966,495 PRNT
		await deposit('pPRNT', '15000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '25000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '52876350', user3, lendingPool, deployData);

		//borrower borrows 938,979,897 PRNT using ETH as collateral
		await deposit('pWETH', '2800000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '30000000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '10000000', user2, lendingPool, deployData);
		
		await doBorrow('pPRNT', '15725810', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('5000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('37560000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 37,560,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//2,766,480 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(2766480, 3);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(18).div(19);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(78.4, 0.2);
		}

	});

	it('Thirty-fifth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 1,660,976,710 PRNT
		await deposit('pPRNT', '80000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '10000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '6010215', user3, lendingPool, deployData);

		//borrower borrows 996,586,026 PRNT using ETH as collateral
		await deposit('pWETH', '2800000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '30000000', borrower, lendingPool, deployData);

		await doBorrow('pPRNT', '20000000', user2, lendingPool, deployData);
		
		await doBorrow('pPRNT', '7606129', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('10000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('39860000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 39,860,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//2,515,277 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(2515277, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(33).div(34);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(80.5, 0.2);
		}

	});

	it('Thirty-sixth Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 1,760,139,499 PRNT
		await deposit('pPRNT', '50000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '20000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '29162789', user3, lendingPool, deployData);

		//borrower borrows 1,056,083,699.4 PRNT using ETH as collateral
		await deposit('pWETH', '2800000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '6000000', borrower, lendingPool, deployData);

		await deposit('pWETH', '2800000', user2, lendingPool, deployData);
		await doBorrow('pPRNT', '20000000', user2, lendingPool, deployData);

		await doBorrow('pPRNT', '33497673.4', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('10000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('42240000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 42,240,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//1,488,968 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(1488968, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(33).div(34);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(82.6, 0.2);
		}

	});

	it('Thirty-seventh Month', async () => {
		const prntPriceInUSDInitial = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
		console.log("prnt price: ", prntPriceInUSDInitial);

		//Supplied Liquidity from users: 1,862,473,191 PRNT
		await deposit('pPRNT', '50000000', user1, lendingPool, deployData);
		await deposit('pPRNT', '20000000', user2, lendingPool, deployData);
		await deposit('pPRNT', '32333692', user3, lendingPool, deployData);

		//borrower borrows 1,056,083,699.4 PRNT using ETH as collateral
		await deposit('pWETH', '2800000', borrower, lendingPool, deployData);
		
		await doBorrow('pPRNT', '44000000', borrower, lendingPool, deployData);

		await doBorrow('pPRNT', '10000000', user2, lendingPool, deployData);

		await doBorrow('pPRNT', '7400215.2', user3, lendingPool, deployData);
		

		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			uniRouterAddress = await poolHelper.router();
			uniV2Router = <UniswapV2Router02>await ethers.getContractAt('UniswapV2Router02', uniRouterAddress);
			const wethAmt = ethers.utils.parseUnits('10000', 18);
			await weth.connect(deployer).mint(wethAmt);
			await weth.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			await prntToken.connect(deployer).approve(uniV2Router.address, ethers.constants.MaxUint256);
			const deployerBalancePre = await prntToken.balanceOf(deployer.address);

			//increase PRNT price to make borrower eligible for liquidation.
			await uniV2Router.connect(deployer).swapExactTokensForTokens(wethAmt, 0, [weth.address, prntToken.address], deployer.address, await getLatestBlockTimestamp() + 3600);
			await advanceTimeAndBlock(100);
			await priceProvider.update();
			const deployerBalancePost = await prntToken.balanceOf(deployer.address);
			const deployerBalanceIncreasement = deployerBalancePost.sub(deployerBalancePre);

			const liquidatedAmount = ethers.utils.parseUnits('44700000', 18);
			let liquidationFeeTo = await read('LendingPoolAddressesProvider', 'getLiquidationFeeTo');
			await prntToken.connect(dao).transfer(liquidator.address, liquidatedAmount);
			await prntToken.connect(liquidator).approve(lendingPool.address, ethers.constants.MaxUint256);

			const wethBalanceOfLiquidationFeeToPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPre = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			//Liquidator liquidates 44,700,000 PRNT of the borrower debt.
			await lendingPool.connect(liquidator).liquidationCall(weth.address, prntToken.address, borrower.address, liquidatedAmount, false);

			const wethBalanceOfLiquidationFeeToPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidationFeeTo), 18));
			const wethBalanceOfLiquidatorPost = parseFloat(ethers.utils.formatUnits(await weth.balanceOf(liquidator.address), 18));

			const protocolBonus = wethBalanceOfLiquidationFeeToPost - wethBalanceOfLiquidationFeeToPre;
			const liquidatorClaimedWithBonus = wethBalanceOfLiquidatorPost - wethBalanceOfLiquidatorPre;
			const liquidatorClaimed = liquidatorClaimedWithBonus - protocolBonus;

			//Protocol and Liquidator get 7.5% as liquidation fee.
			expect(protocolBonus / liquidatorClaimed).closeTo(0.075, 0.0001);

			const prntPriceInETH = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPrice(), 8));
			const bonusInPrnt = protocolBonus / prntPriceInETH;

			//2,398,287 PRNT in ETH as bonus of 7.5%
			expect(bonusInPrnt).closeTo(2398287, 1);

			//decrease PRNT price back.
			const prntSwapBackAmount = deployerBalanceIncreasement.mul(33).div(34);
			await uniV2Router.connect(deployer).swapExactTokensForTokens(prntSwapBackAmount, 0, [prntToken.address, weth.address], deployer.address, await getLatestBlockTimestamp() + 3600);

			await stakeAndCheckRewards(staker);

			console.log("Total rewards by this month: ", rewardsByMonth[monthIndex]);
			monthIndex++;

			await advanceTimeAndBlock(30 * DAY);

			const vestablePrnt = await chefIncentivesController.pendingRewards(borrower.address, deployData.allTokenAddrs);
			const balances = _.without(
				vestablePrnt.map((bn) => Number(bn)),
				0
			);
			console.log("reward balances: ", balances)
			for (let i = 0; i < deployData.allTokenAddrs.length; i++) {
				const rewardData = await multiFeeDistribution.rewardData(deployData.allTokenAddrs[i]);
				console.log(i, ":", deployData.allTokenAddrs[i], rewardData);
			}

			console.log("deposited: ", await chefIncentivesController.depositedRewards());
			console.log("accounted: ", await chefIncentivesController.accountedRewards());
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(borrower.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user1.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user2.address))
			console.log("eligibility: ", await eligibilityProvider.isEligibleForRewards(user3.address))

			await priceProvider.update();
			const prntPriceInUSDAfterMonth = parseFloat(ethers.utils.formatUnits(await priceProvider.getTokenPriceUsd(), 8));
			console.log("prnt price **", prntPriceInUSDAfterMonth)
			expect(prntPriceInUSDAfterMonth).closeTo(84.7, 0.2);
			
			const token = <AToken>await ethers.getContractAt('AToken', deployData.allTokens['pWETH']);
			
			const beforeBalance = await prntToken.balanceOf(staker.address);
			
			await chefIncentivesController.connect(staker).claim(staker.address, [token.address]);
			await multiFeeDistribution.connect(staker).exit(true);
			console.log(await multiFeeDistribution.connect(user1).getBalances(staker.address));

			const afterBalance = await prntToken.balanceOf(staker.address);

			console.log("beforeBalance: ", beforeBalance);
			console.log("afterBalance: ", afterBalance);
		}

	});
});
