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
let rewardBorrower: SignerWithAddress;
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
	rewardBorrower = (await ethers.getSigners())[12];

	// Deposit assets
	await deposit('pWETH', '10000', deployer, lendingPool, deployData);
	await zapAndDeposit(0, eligibleAmt);
};

describe(`Check Borrow Reward`, async () => {
	const {read} = deployments;

	before(async () => {
		await loadZappedUserFixture();
		// await zapIntoEligibility(user2, deployData);
	});

	it('check the deposit/borrow reward', async () => {
		await lpToken.transfer(rewardBorrower.address, ethers.utils.parseUnits('1000', 18));
		const lpBalance = await lpToken.balanceOf(rewardBorrower.address);
		stakedAmount = stakedAmount.add(lpBalance);
		console.log("lpBalance: ", lpBalance);
		console.log("staked amount: ", stakedAmount);
		await deposit('pWETH', '100', rewardBorrower, lendingPool, deployData);
		await lpToken.connect(rewardBorrower).approve(multiFeeDistribution.address, ethers.constants.MaxUint256);

		await multiFeeDistribution.connect(rewardBorrower).stake(lpBalance, rewardBorrower.address, 0);

		const lockedVaule1 = await eligibilityProvider.lockedUsdValue(rewardBorrower.address);

		const lpTokenPriceUsd = await priceProvider.getLpTokenPriceUsd();
		const expectedLockedUsdVal = lpTokenPriceUsd.mul(stakedAmount).div(ethers.utils.parseUnits('1', 18));
		
		expect(lockedVaule1).to.be.equal(expectedLockedUsdVal);

		// For test purpose, lockedValue should exceed required
		const required = await eligibilityProvider.requiredUsdValue(rewardBorrower.address);
		expect(lockedVaule1).to.be.gt(required);
		console.log("locked value: ", lockedVaule1, " required: ", required);
		expect(await eligibilityProvider.isEligibleForRewards(rewardBorrower.address)).to.be.equal(true);

		await doBorrow('pWETH', '1', rewardBorrower, lendingPool, deployData);

		await advanceTimeAndBlock(30 * DAY);

		const vestablePrnt = await chefIncentivesController.pendingRewards(rewardBorrower.address, deployData.allTokenAddrs);
		const balances = _.without(
			vestablePrnt.map((bn) => Number(bn)),
			0
		);
		console.log("reward balances: ", balances)

		
	})
})

