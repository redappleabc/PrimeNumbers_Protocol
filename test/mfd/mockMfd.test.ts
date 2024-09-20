import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import hre, {ethers, upgrades} from 'hardhat';
import {advanceTimeAndBlock, getLatestBlockTimestamp} from '../../scripts/utils';
import {CustomERC20, MultiFeeDistribution} from '../../typechain';
import HardhatDeployConfig from '../../config/31337';
import {setupTest} from '../setup';
import chai from 'chai';
import {solidity} from 'ethereum-waffle';
import {BigNumber} from 'ethers';
chai.use(solidity);
const {expect} = chai;

describe('MultiFeeDistribution', () => {
	let preTestSnapshotID: any;

	let deployer: SignerWithAddress;
	let user1: SignerWithAddress;
	let user2: SignerWithAddress;
	let treasury: SignerWithAddress;
	let mfd: MultiFeeDistribution;
	let prime: CustomERC20;

	const QUART = 25000; //  25%
	const HALF = 65000; //  65%
	const WHOLE = 100000; // 100%
	const BURN = 20000; //  60%

	const MFD_REWARD_DURATION_SECS = parseInt(HardhatDeployConfig.MFD_REWARD_DURATION_SECS);
	const MFD_REWARD_LOOKBACK_SECS = parseInt(HardhatDeployConfig.MFD_REWARD_LOOKBACK_SECS);
	const MFD_LOCK_DURATION_SECS = parseInt(HardhatDeployConfig.MFD_LOCK_DURATION_SECS);
	const MFD_VEST_DURATION = HardhatDeployConfig.MFD_VEST_DURATION;

	const amount = ethers.utils.parseUnits('10000000', 18);

	beforeEach(async () => {
		preTestSnapshotID = await hre.network.provider.send('evm_snapshot');

		[deployer, user1, user2, treasury] = await ethers.getSigners();

		const config = HardhatDeployConfig;

		const erc20Factory = await ethers.getContractFactory('CustomERC20');
		prime = <CustomERC20>await erc20Factory.deploy(amount);

		await prime.transfer(user1.address, amount.div(10));
		await prime.transfer(user2.address, amount.div(10));

		const UniV2TwapOracle = await ethers.getContractFactory('MockUniV2TwapOracle');
		const uniV2TwapOracle = await UniV2TwapOracle.deploy();
		await uniV2TwapOracle.deployed();

		const MockPoolHelper = await ethers.getContractFactory('MockPoolHelper');
		const poolHelper = await MockPoolHelper.deploy();
		const PriceProvider = await ethers.getContractFactory('PriceProvider');
		const priceProvider = await upgrades.deployProxy(
			PriceProvider,
			[config.CHAINLINK_ETH_USD_AGGREGATOR_PROXY, poolHelper.address],
			{initializer: 'initialize', unsafeAllow: ['constructor']}
		);
		await priceProvider.deployed();

		const mfdFactory = await ethers.getContractFactory('MockMFD');
		mfd = <MultiFeeDistribution>await upgrades.deployProxy(
			mfdFactory,
			[
				prime.address,
				deployer.address, // Mock address
				treasury.address,
				priceProvider.address,
				MFD_REWARD_DURATION_SECS,
				MFD_REWARD_LOOKBACK_SECS,
				MFD_LOCK_DURATION_SECS,
				BURN,
				MFD_VEST_DURATION,
			],
			{initializer: 'initialize', unsafeAllow: ['constructor']}
		);
		await mfd.deployed();
		await mfd.setLPToken(prime.address);

		const mockChefFactory = await ethers.getContractFactory('MockIncentivesController');
		const mockChef = await mockChefFactory.deploy();
		await mockChef.deployed();

		const mockMiddleFactory = await ethers.getContractFactory('MockMiddleFeeDistribution');
		const mockMiddle = await mockMiddleFactory.deploy();
		await mockMiddle.deployed();

		await mfd.setMinters([deployer.address]);
		await mfd.setAddresses(mockChef.address, mockMiddle.address, deployer.address);
		await mfd.setLockTypeInfo(HardhatDeployConfig.LOCK_INFO.LOCK_PERIOD, HardhatDeployConfig.LOCK_INFO.MULTIPLIER);

		await prime.connect(user1).approve(mfd.address, ethers.constants.MaxUint256);
		await prime.connect(user2).approve(mfd.address, ethers.constants.MaxUint256);
	});

	afterEach(async () => {
		await hre.network.provider.send('evm_revert', [preTestSnapshotID]);
	});

	it('autorelock is disabled.', async () => {
		const depositAmount = ethers.utils.parseUnits('100', 18);
		await mfd.connect(user1).stake(depositAmount, user1.address, 0);
		await prime.mint(mfd.address, depositAmount);
		await mfd.vestTokens(user1.address, depositAmount, true);
		await mfd.connect(user1).setRelock(true);

		const autoRelockDisabled = await mfd.autoRelockDisabled(user1.address);
		expect(autoRelockDisabled).to.be.equal(true);

		const LOCK_DURATION = await mfd.defaultLockDuration();
		await advanceTimeAndBlock(LOCK_DURATION.toNumber());
		await mfd.connect(user1).withdrawExpiredLocksForWithOptions(user1.address, 0, false);

		const lockedBal = (await mfd.lockedBalances(user1.address)).locked;

		expect(lockedBal).to.be.equal(BigNumber.from('0'));
	});

	it('relock is disabled.', async () => {
		const depositAmount = ethers.utils.parseUnits('100', 18);
		await mfd.connect(user1).stake(depositAmount, user1.address, 0);
		await prime.mint(mfd.address, depositAmount);
		await mfd.vestTokens(user1.address, depositAmount, true);

		const LOCK_DURATION = await mfd.defaultLockDuration();
		await advanceTimeAndBlock(LOCK_DURATION.toNumber());

		const lockedBalances = await mfd.lockedBalances(user1.address);
		expect(lockedBalances.locked).to.be.equal(BigNumber.from('0'));
		expect(lockedBalances.unlockable).to.be.equal(depositAmount);

		await mfd.connect(user1).relock();

		const lockedBalances2 = await mfd.lockedBalances(user1.address);
		expect(lockedBalances2.locked).to.be.equal(lockedBalances.locked);
		expect(lockedBalances2.unlockable).to.be.equal(lockedBalances.unlockable);
	});
});
