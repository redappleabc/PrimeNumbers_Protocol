import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {ethers, upgrades} from 'hardhat';
import chai from 'chai';
import {
	ChefIncentivesController,
	LendingPool,
	LiquidityZap,
	MockToken,
	MultiFeeDistribution,
	PrimeToken,
	EligibilityDataProvider,
	UniswapPoolHelper,
	VariableDebtToken,
	TestnetLockZap,
	WETH,
	PriceProvider,
	AaveOracle,
} from '../../typechain';
import {advanceTimeAndBlock} from '../shared/helpers';
import {DeployConfig, DeployData, LP_PROVIDER} from '../../scripts/deploy/types';
import {BigNumber} from 'ethers';
import {setupTest} from '../setup';
import {solidity} from 'ethereum-waffle';
chai.use(solidity);
const {expect} = chai;

describe('Zapper', function () {
	let deployData: DeployData;
	let deployConfig: DeployConfig;

	let deployer: SignerWithAddress;
	let user2: SignerWithAddress;
	let user3: SignerWithAddress;
	let user4: SignerWithAddress;

	let lockZap: TestnetLockZap;
	let mfd: MultiFeeDistribution;

	const usdcPerAccount = ethers.utils.parseUnits('1000000000', 6);
	const wethPerAccount = ethers.utils.parseUnits('100', 18);
	const depositAmt = ethers.utils.parseUnits('1', 6);
	const depositAmtWeth = ethers.utils.parseUnits('1', 18);
	const SLIPPAGE_DIVISOR = BigNumber.from('10000');
	const MAX_SLIPPAGE = SLIPPAGE_DIVISOR.mul(950).div(1000);

	let USDC: MockToken;
	let usdcAddress = '';
	let rUSDCAddress = '';
	let WETH: WETH;
	let wethAddress = '';
	let rWETHAddress = '';
	let vdWETH: VariableDebtToken;
	let aaveOracle: AaveOracle;
	let lendingPool: LendingPool;
	let chefIncentivesController: ChefIncentivesController;
	let eligibilityProvider: EligibilityDataProvider;
	let prime: PrimeToken;
	let poolHelperAddress: string;
	let liquidityZapAddress: string;
	let liquidityZap: LiquidityZap;
	let poolHelper: UniswapPoolHelper;
	let priceProvider: PriceProvider;
	let uniRouterAddress: string;

	beforeEach(async function () {
		const {deploy} = deployments;
		const fixture = await setupTest();

		deployData = fixture.deployData;
		deployConfig = fixture.deployConfig;

		deployer = fixture.deployer;
		user2 = fixture.user2;
		user3 = fixture.user3;
		user4 = fixture.user4;

		lockZap = <TestnetLockZap>fixture.lockZap;
		lendingPool = fixture.lendingPool;
		aaveOracle = await ethers.getContractAt('AaveOracle', deployData.aaveOracle);
		chefIncentivesController = fixture.chefIncentivesController;
		mfd = fixture.multiFeeDistribution;
		prime = fixture.prntToken;
		eligibilityProvider = fixture.eligibilityProvider;

		rUSDCAddress = deployData.allTokens.pUSDC;
		USDC = fixture.usdc;
		usdcAddress = USDC.address;

		rWETHAddress = deployData.allTokens.pWETH;
		vdWETH = deployData.allTokens.vdWETH;
		WETH = fixture.weth;
		wethAddress = WETH.address;

		poolHelperAddress = await lockZap.getPoolHelper();

		poolHelper = <UniswapPoolHelper>await ethers.getContractAt('UniswapPoolHelper', poolHelperAddress);
		priceProvider = fixture.priceProvider;
		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			liquidityZapAddress = await poolHelper.getLiquidityZap();
			liquidityZap = await ethers.getContractAt('LiquidityZap', liquidityZapAddress);
			uniRouterAddress = await poolHelper.router();
		}
	});

	it('initialize pool helper again', async () => {
		await expect(
			poolHelper.initialize(
				prime.address,
				wethAddress,
				deployer.address, // router
				deployer.address // liquidity zap
			)
		).to.be.revertedWith('Initializable: contract is already initialized');
	});

	it('poolHelper perms and views', async () => {
		await expect(poolHelper.zapWETH(0)).to.be.revertedWith('InsufficientPermission');
		await expect(poolHelper.zapTokens(10, 10)).to.be.revertedWith('InsufficientPermission');
		await expect(poolHelper.setLiquidityZap(ethers.constants.AddressZero)).to.be.revertedWith('AddressZero');
		await expect(poolHelper.connect(user2).setLockZap(ethers.constants.AddressZero)).to.be.revertedWith(
			'Ownable: caller is not the owner'
		);
		await expect(poolHelper.setLockZap(ethers.constants.AddressZero)).to.be.revertedWith('AddressZero');
		const reserves = await poolHelper.getReserves();
		const price = await poolHelper.getPrice();
		expect(price).to.be.equal(reserves.weth.mul(10 ** 8).div(reserves.prnt));
	});

	it('init params validation', async () => {
		const zapFactory = await ethers.getContractFactory('LockZap');
		await expect(
			lockZap.initialize(
				poolHelper.address,
				uniRouterAddress,
				lendingPool.address,
				wethAddress,
				prime.address,
				1000,
				aaveOracle.address
			)
		).to.be.revertedWith('Initializable: contract is already initialized');
		await expect(
			upgrades.deployProxy(
				zapFactory,
				[
					ethers.constants.AddressZero,
					uniRouterAddress,
					lendingPool.address,
					wethAddress,
					prime.address,
					1000,
					aaveOracle.address,
				],
				{initializer: 'initialize', unsafeAllow: ['constructor']}
			)
		).to.be.revertedWith('AddressZero');
		await expect(
			upgrades.deployProxy(
				zapFactory,
				[
					poolHelper.address,
					uniRouterAddress,
					ethers.constants.AddressZero,
					wethAddress,
					prime.address,
					1000,
					aaveOracle.address,
				],
				{initializer: 'initialize', unsafeAllow: ['constructor']}
			)
		).to.be.revertedWith('AddressZero');
		await expect(
			upgrades.deployProxy(
				zapFactory,
				[
					poolHelper.address,
					uniRouterAddress,
					lendingPool.address,
					ethers.constants.AddressZero,
					prime.address,
					1000,
					aaveOracle.address,
				],
				{initializer: 'initialize', unsafeAllow: ['constructor']}
			)
		).to.be.revertedWith('AddressZero');
		await expect(
			upgrades.deployProxy(
				zapFactory,
				[
					poolHelper.address,
					uniRouterAddress,
					lendingPool.address,
					wethAddress,
					ethers.constants.AddressZero,
					1000,
					aaveOracle.address,
				],
				{initializer: 'initialize', unsafeAllow: ['constructor']}
			)
		).to.be.revertedWith('AddressZero');
		await expect(
			upgrades.deployProxy(
				zapFactory,
				[
					poolHelper.address,
					uniRouterAddress,
					lendingPool.address,
					wethAddress,
					prime.address,
					1000,
					ethers.constants.AddressZero,
				],
				{initializer: 'initialize', unsafeAllow: ['constructor']}
			)
		).to.be.revertedWith('AddressZero');
		await expect(
			upgrades.deployProxy(
				zapFactory,
				[
					poolHelper.address,
					uniRouterAddress,
					lendingPool.address,
					wethAddress,
					prime.address,
					10001,
					ethers.constants.AddressZero,
				],
				{initializer: 'initialize', unsafeAllow: ['constructor']}
			)
		).to.be.revertedWith('InvalidRatio');
	});

	it('setPriceProvider', async function () {
		await expect(lockZap.connect(user2).setPriceProvider(priceProvider.address)).to.be.revertedWith(
			'Ownable: caller is not the owner'
		);
		await expect(lockZap.setPriceProvider(ethers.constants.AddressZero)).to.be.revertedWith('AddressZero');
	});

	it('setMfd', async function () {
		await expect(lockZap.connect(user2).setMfd(priceProvider.address)).to.be.revertedWith(
			'Ownable: caller is not the owner'
		);
		await expect(lockZap.setMfd(ethers.constants.AddressZero)).to.be.revertedWith('AddressZero');
	});

	it('setPoolHelper', async function () {
		await expect(lockZap.connect(user2).setPoolHelper(priceProvider.address)).to.be.revertedWith(
			'Ownable: caller is not the owner'
		);
		await expect(lockZap.setPoolHelper(ethers.constants.AddressZero)).to.be.revertedWith('AddressZero');
	});

	describe('pause/unpause', async () => {
		it('owner permission', async () => {
			await expect(lockZap.connect(user2).pause()).to.be.revertedWith('Ownable: caller is not the owner');
			await expect(lockZap.connect(user2).unpause()).to.be.revertedWith('Ownable: caller is not the owner');
			await lockZap.pause();
			await lockZap.unpause();
		});

		it('functions when not paused', async () => {
			await lockZap.pause();
			await expect(
				lockZap.connect(user2).zap(true, ethers.constants.AddressZero, 10, 0, 0, 0)
			).to.be.revertedWith('Pausable: paused');
			await expect(
				lockZap.connect(user2).zapOnBehalf(true, ethers.constants.AddressZero, 10, 0, user3.address, 0)
			).to.be.revertedWith('Pausable: paused');
			await expect(
				lockZap.connect(user2).zapFromVesting(true, ethers.constants.AddressZero, 0, 0, 0)
			).to.be.revertedWith('Pausable: paused');
		});
	});

	it('setLiquidityZap', async function () {
		if (deployConfig.LP_PROVIDER == LP_PROVIDER.UNISWAP) {
			await expect(poolHelper.connect(user2).setLiquidityZap(liquidityZapAddress)).to.be.revertedWith(
				'Ownable: caller is not the owner'
			);
			await poolHelper.setLiquidityZap(liquidityZapAddress);
		}
	});

	it('setPoolHelper', async function () {
		await expect(lockZap.connect(user2).setPoolHelper(poolHelperAddress)).to.be.revertedWith(
			'Ownable: caller is not the owner'
		);
		await lockZap.setPoolHelper(poolHelperAddress);
	});

	it('Can recover falsely received ETH', async () => {
		const depositAmount = ethers.utils.parseEther('1');
		await deployer.sendTransaction({
			to: lockZap.address,
			value: depositAmount,
		});

		const user2Eth0 = await user2.getBalance();
		await lockZap.withdrawLockedETH(user2.address, depositAmount);
		const user2Eth1 = await user2.getBalance();

		expect(user2Eth1.sub(user2Eth0)).to.be.equal(depositAmount);
	});

	it('errors', async () => {
		const zapAmount = ethers.BigNumber.from(10 * 10 ** 6);
		await lockZap.setPriceProvider(priceProvider.address);
		await USDC.approve(lockZap.address, zapAmount);
	});
});
