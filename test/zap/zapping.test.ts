import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {ethers, upgrades} from 'hardhat';
import {zapIntoEligibility} from '../shared/helpers';
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

interface ZapState {
	userTokenBalance: BigNumber;
	mfdLPBalance: BigNumber;
	mfdUserLocks: BigNumber;
	lendingProtocolBalance: BigNumber;
	totalVesting: BigNumber;
}

interface ZapParams {
	isBorrowing: boolean;
	assetAddress: string;
	assetAmount: BigNumber;
	nativeTokenAmount: BigNumber;
	prntAmount: BigNumber;
	lockTypeIndex: number;
	slippage: number;
	isVesting: boolean;
}

// We use an empty string when making use of ETH instead of an ERC20
const ETHAddress = ethers.constants.AddressZero;
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
const MAX_SLIPPAGE = SLIPPAGE_DIVISOR.mul(8500).div(10000);

// Potential to change into variable and utilize it for fuzzing
const zapETHAmount = ethers.utils.parseEther('1');
const zapUSDCAmount = ethers.utils.parseUnits('2100', 6);
const zapPRNTAmount = ethers.utils.parseEther('100');

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
let liquidityZapAddress: string;
let liquidityZap: LiquidityZap;
let poolHelper: UniswapPoolHelper;
let priceProvider: PriceProvider;
let LP: MockToken;
let daoSigner: any;

describe('LockZap', function () {
	beforeEach(async function () {
		const {deploy} = deployments;
		const fixture = await setupTest();

		deployData = fixture.deployData;
		deployConfig = fixture.deployConfig;

		deployer = fixture.deployer;
		user2 = fixture.user2;
		user3 = fixture.user3;
		user4 = fixture.user4;
		daoSigner = fixture.dao;

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

		LP = await ethers.getContractAt('MockToken', deployData.stakingToken);

		poolHelper = fixture.poolHelper;
		priceProvider = fixture.priceProvider;
		if (fixture.liquidityZap) {
			liquidityZap = fixture.liquidityZap;
		}
	});

	describe('Zap ETH', async () => {
		it('Zap ETH', async function () {
			const initialState = await getPreZapState(user2.address, ETHAddress);

			const zapParams: ZapParams = {
				isBorrowing: false,
				assetAddress: ethers.constants.AddressZero,
				assetAmount: ethers.constants.Zero,
				nativeTokenAmount: zapETHAmount,
				prntAmount: ethers.constants.Zero,
				lockTypeIndex: 0,
				slippage: 0,
				isVesting: false,
			};
			await zap(user2, zapParams);

			await validateZapStateChange(initialState, zapParams, user2.address);
		});

		it('Zap ETH with PRNT', async function () {
			const initialState = await getPreZapState(user2.address, ETHAddress);

			await prime.connect(daoSigner).transfer(user2.address, zapPRNTAmount);
			await prime.connect(user2).approve(lockZap.address, zapPRNTAmount);
			const ethRequired = await lockZap.quoteFromToken(wethAddress, zapPRNTAmount);

			const zapParams: ZapParams = {
				isBorrowing: false,
				assetAddress: ethers.constants.AddressZero,
				assetAmount: ethers.constants.Zero,
				nativeTokenAmount: ethRequired,
				prntAmount: zapPRNTAmount,
				lockTypeIndex: 0,
				slippage: 9900,
				isVesting: false,
			};
			await zap(user2, zapParams);

			await validateZapStateChange(initialState, zapParams, user2.address);
		});

		it('zap ETH fails with high slippage', async function () {
			// Value should be derived from AMM used during tests
			const stupidlyLargeAmount = ethers.utils.parseEther('10000');
			const zapParams: ZapParams = {
				isBorrowing: false,
				assetAddress: ethers.constants.AddressZero,
				assetAmount: ethers.constants.Zero,
				nativeTokenAmount: stupidlyLargeAmount,
				prntAmount: ethers.constants.Zero,
				lockTypeIndex: 0,
				slippage: 9900,
				isVesting: false,
			};
			await zap(user2, zapParams, 'SlippageTooHigh');
		});

		it('zap ETH input validation', async function () {
			let zapParams: ZapParams = {
				isBorrowing: false,
				assetAddress: ethers.constants.AddressZero,
				assetAmount: ethers.constants.Zero,
				nativeTokenAmount: ethers.constants.Zero,
				prntAmount: ethers.constants.Zero,
				lockTypeIndex: 0,
				slippage: 9900,
				isVesting: false,
			};
			await zap(user2, zapParams, 'AmountZero');

			zapParams = {
				isBorrowing: true,
				assetAddress: ethers.constants.AddressZero,
				assetAmount: ethers.constants.Zero,
				nativeTokenAmount: zapETHAmount,
				prntAmount: ethers.constants.Zero,
				lockTypeIndex: 0,
				slippage: 9900,
				isVesting: false,
			};
			await zap(user2, zapParams, 'InvalidZapETHSource');

			zapParams = {
				isBorrowing: false,
				assetAddress: ethers.constants.AddressZero,
				assetAmount: ethers.constants.Zero,
				nativeTokenAmount: zapETHAmount,
				prntAmount: ethers.constants.Zero,
				lockTypeIndex: 0,
				slippage: Number(MAX_SLIPPAGE.sub('1').toString()),
				isVesting: false,
			};
			await zap(user2, zapParams, 'SpecifiedSlippageExceedLimit');

			zapParams = {
				isBorrowing: true,
				assetAddress: usdcAddress,
				assetAmount: ethers.constants.Zero,
				nativeTokenAmount: zapETHAmount,
				prntAmount: ethers.constants.Zero,
				lockTypeIndex: 0,
				slippage: 9900,
				isVesting: false,
			};
			await zap(user2, zapParams, 'ReceivedETHOnAlternativeAssetZap');
		});
	});

	describe('Zap WETH', async () => {
		it('can zap WETH as Default', async function () {
			await WETH.connect(user2).deposit({
				value: zapETHAmount,
			});
			await WETH.connect(user2).approve(lockZap.address, zapETHAmount);

			const initialState = await getPreZapState(user2.address, wethAddress);

			// Zap using 0 as the assetAddress, thus using WETH as a default
			let zapParams: ZapParams = {
				isBorrowing: false,
				assetAddress: ethers.constants.AddressZero,
				assetAmount: zapETHAmount,
				nativeTokenAmount: ethers.constants.Zero,
				prntAmount: ethers.constants.Zero,
				lockTypeIndex: 0,
				slippage: 9900,
				isVesting: false,
			};
			await zap(user2, zapParams);

			await validateZapStateChange(initialState, zapParams, user2.address);
		});

		it('can zap WETH when specified', async function () {
			await WETH.connect(user2).deposit({
				value: zapETHAmount,
			});
			await WETH.connect(user2).approve(lockZap.address, zapETHAmount);

			const initialState = await getPreZapState(user2.address, wethAddress);

			// Zap using the explicit WETH address
			const zapParams: ZapParams = {
				isBorrowing: false,
				assetAddress: wethAddress,
				assetAmount: zapETHAmount,
				nativeTokenAmount: ethers.constants.Zero,
				prntAmount: ethers.constants.Zero,
				lockTypeIndex: 0,
				slippage: 0,
				isVesting: false,
			};
			await zap(user2, zapParams);

			await validateZapStateChange(initialState, zapParams, user2.address);
		});
	});

	describe('Zap USDC', async () => {
		it('can zap USDC', async function () {
			await USDC.mint(user2.address, zapUSDCAmount);
			await USDC.connect(user2).approve(lockZap.address, zapUSDCAmount);

			const initialState = await getPreZapState(user2.address, usdcAddress);

			// Zap using 0 as the asset address, thus using WETH as a default
			const zapParams: ZapParams = {
				isBorrowing: false,
				assetAddress: usdcAddress,
				assetAmount: zapUSDCAmount,
				nativeTokenAmount: ethers.constants.Zero,
				prntAmount: ethers.constants.Zero,
				lockTypeIndex: 0,
				slippage: 0,
				isVesting: false,
			};
			await zap(user2, zapParams);

			await validateZapStateChange(initialState, zapParams, user2.address);
		});

		it('USDC zap fails with high slippage', async () => {
			// await USDC.approve(lockZap.address, zapAmount);
			// await expect(lockZap.zap(false, usdcAddress, zapAmount, 0, 1, 9999)).to.be.revertedWith('SlippageTooHigh');
		});
	});

	describe('Zap Borrows', async () => {
		it('can Zap WETH from Borrow', async function () {
			const wethAmountRequired = zapETHAmount.mul(2);

			// Deposit assets that can be borrowed for the Zap
			await WETH.connect(user2).deposit({
				value: wethAmountRequired,
			});
			await WETH.connect(user2).approve(lendingPool.address, ethers.constants.MaxUint256);
			const debtTokenAddress = await lockZap.getVDebtToken(wethAddress);
			vdWETH = <VariableDebtToken>await ethers.getContractAt('VariableDebtToken', debtTokenAddress);
			await vdWETH.connect(user2).approveDelegation(lockZap.address, ethers.constants.MaxUint256);
			await lendingPool.connect(user2).deposit(wethAddress, wethAmountRequired, user2.address, 0);

			const initialState = await getPreZapState(user2.address, wethAddress);

			const zapParams: ZapParams = {
				isBorrowing: true,
				assetAddress: ethers.constants.AddressZero,
				assetAmount: zapETHAmount,
				nativeTokenAmount: ethers.constants.Zero,
				prntAmount: ethers.constants.Zero,
				lockTypeIndex: 0,
				slippage: 0,
				isVesting: false,
			};
			await zap(user2, zapParams);

			await validateZapStateChange(initialState, zapParams, user2.address);
		});

		it('can Zap WETH from Borrow with PRNT', async function () {
			const wethToZap = await lockZap.quoteFromToken(wethAddress, zapPRNTAmount);
			const wethAmountRequired = wethToZap.mul(2);

			// Deposit assets that can be borrowed for the Zap
			await WETH.connect(user2).deposit({
				value: wethAmountRequired,
			});
			await WETH.connect(user2).approve(lendingPool.address, ethers.constants.MaxUint256);
			const debtTokenAddress = await lockZap.getVDebtToken(wethAddress);
			vdWETH = <VariableDebtToken>await ethers.getContractAt('VariableDebtToken', debtTokenAddress);
			await vdWETH.connect(user2).approveDelegation(lockZap.address, ethers.constants.MaxUint256);
			await lendingPool.connect(user2).deposit(wethAddress, wethAmountRequired, user2.address, 0);

			// Approve prnt transfer to lockZap
			await prime.connect(daoSigner).transfer(user2.address, zapPRNTAmount);
			await prime.connect(user2).approve(lockZap.address, zapPRNTAmount);

			const initialState = await getPreZapState(user2.address, wethAddress);

			const zapParams: ZapParams = {
				isBorrowing: true,
				assetAddress: ethers.constants.AddressZero,
				assetAmount: wethToZap,
				nativeTokenAmount: ethers.constants.Zero,
				prntAmount: zapPRNTAmount,
				lockTypeIndex: 0,
				slippage: 0,
				isVesting: false,
			};
			await zap(user2, zapParams);

			await validateZapStateChange(initialState, zapParams, user2.address);
		});

		it('can Zap USDC from Borrow', async function () {
			const assetAmountRequired = zapUSDCAmount.mul(2);

			// Deposit USDC into Lending Protocol
			await USDC.mint(user2.address, assetAmountRequired);
			await USDC.connect(user2).approve(lendingPool.address, ethers.constants.MaxUint256);
			const debtTokenAddress = await lockZap.getVDebtToken(usdcAddress);
			const vdUSDC = <VariableDebtToken>await ethers.getContractAt('VariableDebtToken', debtTokenAddress);
			await vdUSDC.connect(user2).approveDelegation(lockZap.address, ethers.constants.MaxUint256);

			await lendingPool.connect(user2).deposit(usdcAddress, assetAmountRequired, user2.address, 0);

			const initialState = await getPreZapState(user2.address, usdcAddress);

			const zapParams: ZapParams = {
				isBorrowing: true,
				assetAddress: usdcAddress,
				assetAmount: zapUSDCAmount,
				nativeTokenAmount: ethers.constants.Zero,
				prntAmount: ethers.constants.Zero,
				lockTypeIndex: 0,
				slippage: 0,
				isVesting: false,
			};
			await zap(user2, zapParams);

			await validateZapStateChange(initialState, zapParams, user2.address);
		});

		it('can Zap USDC from Borrow with PRNT', async function () {
			const usdcToZap = await lockZap.quoteFromToken(usdcAddress, zapPRNTAmount);
			const assetAmountRequired = usdcToZap.mul(2);

			// Deposit USDC into Lending Protocol
			await USDC.mint(user2.address, assetAmountRequired);
			await USDC.connect(user2).approve(lendingPool.address, ethers.constants.MaxUint256);
			const debtTokenAddress = await lockZap.getVDebtToken(usdcAddress);
			const vdUSDC = <VariableDebtToken>await ethers.getContractAt('VariableDebtToken', debtTokenAddress);
			await vdUSDC.connect(user2).approveDelegation(lockZap.address, ethers.constants.MaxUint256);
			await lendingPool.connect(user2).deposit(usdcAddress, assetAmountRequired, user2.address, 0);

			// Approve prnt transfer to lockZap
			await prime.connect(daoSigner).transfer(user2.address, zapPRNTAmount);
			await prime.connect(user2).approve(lockZap.address, zapPRNTAmount);

			const initialState = await getPreZapState(user2.address, usdcAddress);

			const zapParams: ZapParams = {
				isBorrowing: true,
				assetAddress: usdcAddress,
				assetAmount: usdcToZap,
				nativeTokenAmount: ethers.constants.Zero,
				prntAmount: zapPRNTAmount,
				lockTypeIndex: 0,
				slippage: 0,
				isVesting: false,
			};
			await zap(user2, zapParams);

			await validateZapStateChange(initialState, zapParams, user2.address);
		});

		it('cannot borrow higher amount then users borrowing power', async function () {
			const assetAmountRequired = zapUSDCAmount; // Deposit same amount as we intend to borrow, which won't be enough

			// Deposit USDC into Lending Protocol
			await USDC.mint(user2.address, assetAmountRequired);
			await USDC.connect(user2).approve(lendingPool.address, ethers.constants.MaxUint256);
			const debtTokenAddress = await lockZap.getVDebtToken(usdcAddress);
			const vdUSDC = <VariableDebtToken>await ethers.getContractAt('VariableDebtToken', debtTokenAddress);
			await vdUSDC.connect(user2).approveDelegation(lockZap.address, ethers.constants.MaxUint256);

			await lendingPool.connect(user2).deposit(usdcAddress, assetAmountRequired, user2.address, 0);

			const zapParams: ZapParams = {
				isBorrowing: true,
				assetAddress: usdcAddress,
				assetAmount: zapUSDCAmount,
				nativeTokenAmount: ethers.constants.Zero,
				prntAmount: ethers.constants.Zero,
				lockTypeIndex: 0,
				slippage: 0,
				isVesting: false,
			};
			await zap(user2, zapParams, '11'); // Aave error code, see Errors.sol
		});
	});

	describe('Zap from Vesting', async () => {
		it('can zap ETH from Vesting', async function () {
			// Create some vesting tokens for the user
			await lockZap.connect(user2).zap(false, ethers.constants.AddressZero, 0, 0, 0, 0, {
				value: zapETHAmount,
			});
			await USDC.mint(user2.address, zapUSDCAmount);
			await USDC.connect(user2).approve(lendingPool.address, ethers.constants.MaxUint256);
			await lendingPool.connect(user2).deposit(usdcAddress, zapUSDCAmount, user2.address, 0);
			// Advance time so that PRNT can be vested
			await advanceTimeAndBlock(1000);
			await chefIncentivesController.claimAll(user2.address);

			const initialState = await getPreZapState(user2.address, wethAddress);
			const wethRequired = await poolHelper.connect(user2).quoteFromToken(initialState.totalVesting);

			const zapParams: ZapParams = {
				isBorrowing: false,
				assetAddress: ethers.constants.AddressZero,
				assetAmount: ethers.constants.Zero,
				nativeTokenAmount: wethRequired,
				prntAmount: ethers.constants.Zero,
				lockTypeIndex: 2,
				slippage: 0,
				isVesting: true,
			};
			await zap(user2, zapParams);

			await validateZapStateChange(initialState, zapParams, user2.address);
		});

		it('can zap ETH from Vesting with Borrow', async function () {
			//----------Create some vesting tokens for the user---------------

			await lockZap.connect(user2).zap(false, ethers.constants.AddressZero, 0, 0, 0, 0, {
				value: zapETHAmount,
			});
			await USDC.mint(user2.address, zapUSDCAmount);
			await USDC.connect(user2).approve(lendingPool.address, ethers.constants.MaxUint256);
			await lendingPool.connect(user2).deposit(usdcAddress, zapUSDCAmount, user2.address, 0);
			// Advance time so that PRNT can be vested
			await advanceTimeAndBlock(1000);
			await chefIncentivesController.claimAll(user2.address);

			//----------Deposit Collateral---------------

			const wethAmountRequired = zapETHAmount.mul(2);
			await WETH.connect(user2).deposit({
				value: wethAmountRequired,
			});
			await WETH.connect(user2).approve(lendingPool.address, ethers.constants.MaxUint256);
			const debtTokenAddress = await lockZap.getVDebtToken(wethAddress);
			vdWETH = <VariableDebtToken>await ethers.getContractAt('VariableDebtToken', debtTokenAddress);
			await vdWETH.connect(user2).approveDelegation(lockZap.address, ethers.constants.MaxUint256);
			await lendingPool.connect(user2).deposit(wethAddress, wethAmountRequired, user2.address, 0);

			//-------------Zap---------------

			const initialState = await getPreZapState(user2.address, wethAddress);
			const wethRequired = await poolHelper.connect(user2).quoteFromToken(initialState.totalVesting);

			const zapParams: ZapParams = {
				isBorrowing: true,
				assetAddress: ethers.constants.AddressZero,
				assetAmount: wethRequired,
				nativeTokenAmount: ethers.constants.Zero,
				prntAmount: ethers.constants.Zero,
				lockTypeIndex: 2,
				slippage: 0,
				isVesting: true,
			};
			await zap(user2, zapParams);

			await validateZapStateChange(initialState, zapParams, user2.address);
		});

		it('can zap USDC from Vesting with Borrow', async function () {
			//----------Create some vesting tokens for the user---------------

			await lockZap.connect(user2).zap(false, ethers.constants.AddressZero, 0, 0, 0, 0, {
				value: zapETHAmount,
			});
			await USDC.mint(user2.address, zapUSDCAmount);
			await USDC.connect(user2).approve(lendingPool.address, ethers.constants.MaxUint256);
			await lendingPool.connect(user2).deposit(usdcAddress, zapUSDCAmount, user2.address, 0);
			// Advance time so that PRNT can be vested
			await advanceTimeAndBlock(1000);
			await chefIncentivesController.claimAll(user2.address);

			//----------Deposit Collateral---------------

			const usdcAmountRequired = zapUSDCAmount.mul(2);
			await USDC.mint(user2.address, usdcAmountRequired);
			await USDC.connect(user2).approve(lendingPool.address, ethers.constants.MaxUint256);
			const debtTokenAddress = await lockZap.getVDebtToken(usdcAddress);
			const vdUSDC = <VariableDebtToken>await ethers.getContractAt('VariableDebtToken', debtTokenAddress);
			await vdUSDC.connect(user2).approveDelegation(lockZap.address, ethers.constants.MaxUint256);

			//-------------Zap---------------

			const initialState = await getPreZapState(user2.address, usdcAddress);
			const usdcRequired = await lockZap.connect(user2).quoteFromToken(usdcAddress,initialState.totalVesting);

			const zapParams: ZapParams = {
				isBorrowing: true,
				assetAddress: usdcAddress,
				assetAmount: usdcRequired,
				nativeTokenAmount: ethers.constants.Zero,
				prntAmount: ethers.constants.Zero,
				lockTypeIndex: 2,
				slippage: 0,
				isVesting: true,
			};
			await zap(user2, zapParams);

			await validateZapStateChange(initialState, zapParams, user2.address);
		});

		//////////////////////
		//     Old Tests    //
		//////////////////////

		it('zap from Vesting fails with high slippage', async function () {
			await lockZap.setPriceProvider(priceProvider.address);

			// Become eligilble for rewards;
			await lockZap.connect(user4).zap(false, ethers.constants.AddressZero, 0, 0, 0, 0, {
				value: wethPerAccount,
			});

			await WETH.connect(user4).deposit({
				value: wethPerAccount,
			});

			await WETH.connect(user4).approve(lockZap.address, ethers.constants.MaxUint256);

			await WETH.connect(user4).approve(lendingPool.address, ethers.constants.MaxUint256);

			const debtTokenAddress = await lockZap.getVDebtToken(wethAddress);
			vdWETH = <VariableDebtToken>await ethers.getContractAt('VariableDebtToken', debtTokenAddress);
			await vdWETH.connect(user4).approveDelegation(lockZap.address, ethers.constants.MaxUint256);

			await lendingPool.connect(user4).deposit(wethAddress, depositAmtWeth.mul(5), user4.address, 0);

			await advanceTimeAndBlock(100000);

			await chefIncentivesController.claim(user4.address, [rWETHAddress]);

			await lendingPool.connect(user4).borrow(wethAddress, depositAmtWeth.mul(4), 2, 0, user4.address);

			await lendingPool.connect(user4).deposit(wethAddress, depositAmtWeth.mul(5), user4.address, 0);

			await expect(
				lockZap.connect(user4).zapFromVesting(true, ethers.constants.AddressZero, depositAmtWeth, 2, 10000)
			).to.be.revertedWith('SlippageTooHigh');
		});

		it('can early exit after zapping vesting w/ borrow', async function () {
			await WETH.connect(user4).deposit({
				value: wethPerAccount,
			});

			await WETH.connect(user4).approve(lockZap.address, ethers.constants.MaxUint256);

			await WETH.connect(user4).approve(lendingPool.address, ethers.constants.MaxUint256);

			const debtTokenAddress = await lockZap.getVDebtToken(wethAddress);
			vdWETH = <VariableDebtToken>await ethers.getContractAt('VariableDebtToken', debtTokenAddress);
			await vdWETH.connect(user4).approveDelegation(lockZap.address, ethers.constants.MaxUint256);

			await lendingPool.connect(user4).deposit(wethAddress, depositAmtWeth, user4.address, 0);

			expect((await lendingPool.getUserAccountData(user4.address)).totalCollateralETH).to.be.gt(
				BigNumber.from(0)
			);
			expect((await lendingPool.getUserAccountData(user4.address)).totalDebtETH).to.equal(BigNumber.from(0));

			// Become eligilble for rewards;
			await lockZap.connect(user4).zap(false, ethers.constants.AddressZero, 0, 0, 0, 0, {
				value: depositAmtWeth,
			});

			const lockedLpBal1 = (await mfd.lockedBalances(user4.address)).locked;

			expect(await eligibilityProvider.isEligibleForRewards(user4.address)).to.be.equal(true);

			await advanceTimeAndBlock(100000);

			await chefIncentivesController.claim(user4.address, [rWETHAddress]);

			let totalVesting = (await mfd.earnedBalances(user4.address)).totalVesting;
			const wethToMatchPrnt = await lockZap.quoteFromToken(WETH.address, totalVesting);

			await lockZap.connect(user4).zapFromVesting(true, ethers.constants.AddressZero, wethToMatchPrnt, 2, 0);

			totalVesting = (await mfd.earnedBalances(user4.address)).totalVesting;

			const lockedLpBal2 = (await mfd.lockedBalances(user4.address)).locked;
			expect(lockedLpBal2).to.be.gt(lockedLpBal1);
			expect(totalVesting).to.be.equal(0);
			expect((await lendingPool.getUserAccountData(user4.address)).totalDebtETH).to.be.gt(BigNumber.from(0));

			await chefIncentivesController.claim(user4.address, [rWETHAddress]);
			expect((await mfd.earnedBalances(user4.address)).totalVesting).to.be.gt(BigNumber.from(0));

			const prntBal1 = await prime.balanceOf(user4.address);
			await mfd.connect(user4).exit(false);
			const prntBal2 = await prime.balanceOf(user4.address);
			expect(prntBal2).to.be.gt(prntBal1);
		});
	});

	describe('Quoting Prices', async () => {
		it('ETH quote', async () => {
			await lockZap.setPriceProvider(priceProvider.address);
			const minAcceptedSlippage = 9500;
			const prntAmountToLock = ethers.utils.parseUnits('100', 18);

			// Calc the value of the deposited tokens
			const quotedUSDCRequiredToZap = await lockZap.quoteFromToken(usdcAddress, prntAmountToLock);
			const quotedUSDCPrice = await aaveOracle.getAssetPrice(usdcAddress);
			const quotedUSDCValueUsd = quotedUSDCPrice.mul(quotedUSDCRequiredToZap).div(10 ** (await USDC.decimals()));

			await USDC.approve(lockZap.address, quotedUSDCRequiredToZap);
			const lockedLpBalanceBefore = (await mfd.lockedBalances(deployer.address)).locked;
			await lockZap.zap(false, usdcAddress, quotedUSDCRequiredToZap, 0, 1, minAcceptedSlippage);
			const lockedLpBalanceAfter = (await mfd.lockedBalances(deployer.address)).locked;
			const lockedLpBalanceGained = lockedLpBalanceAfter.sub(lockedLpBalanceBefore);

			// Calc the value of the gained locked LP tokens
			const lpTokenPriceUsd = await priceProvider.getLpTokenPriceUsd();
			const lpValueGained = lockedLpBalanceGained.mul(lpTokenPriceUsd).div(ethers.utils.parseEther('1'));

			// Ensure the locked value is equal to the deposited assets (with some margin for slippage)
			const minLockedValue = quotedUSDCValueUsd.mul(minAcceptedSlippage).div(10000);
			expect(lpValueGained).to.be.gte(minLockedValue);
		});
	});

	describe('LiquidityZap', async () => {
		if (liquidityZap) {
			it('initLiquidityZap again fails', async () => {
				if (liquidityZap) {
					await expect(liquidityZap.initialize()).to.be.revertedWith(
						'Contract instance has already been initialized'
					);

					await expect(
						liquidityZap.initLiquidityZap(
							ethers.constants.AddressZero,
							ethers.constants.AddressZero,
							ethers.constants.AddressZero,
							ethers.constants.AddressZero
						)
					).to.be.reverted;
				}
			});

			it('fallback', async () => {
				if (liquidityZap) {
					await expect(
						deployer.sendTransaction({
							to: liquidityZap.address,
							value: ethers.utils.parseEther('1'),
						})
					).to.be.not.reverted;
				}
			});

			it('zapEth validation', async () => {
				if (liquidityZap) {
					await expect(liquidityZap.zapETH(user2.address)).to.be.revertedWith('InvalidETHAmount');
					await liquidityZap.connect(user2).zapETH(user2.address, {value: ethers.utils.parseEther('1')});
				}
			});

			it('zapEth validation', async () => {
				if (liquidityZap) {
					await expect(
						liquidityZap.addLiquidityETHOnly(ethers.constants.AddressZero, {
							value: ethers.utils.parseEther('1'),
						})
					).to.be.revertedWith('AddressZero');

					await expect(
						liquidityZap.addLiquidityETHOnly(ethers.constants.AddressZero, {
							value: ethers.utils.parseEther('1'),
						})
					).to.be.revertedWith('AddressZero');

					await expect(liquidityZap.addLiquidityETHOnly(user2.address)).to.be.revertedWith(
						'InvalidETHAmount'
					);

					expect(await liquidityZap.quote(ethers.utils.parseEther('1'))).to.be.gt(0);
					expect(await liquidityZap.getLPTokenPerEthUnit(ethers.utils.parseEther('1'))).to.be.gt(0);
				}
			});

			it('addLiquidityWETHOnly validation', async () => {
				if (liquidityZap) {
					await expect(liquidityZap.addLiquidityWETHOnly(10, deployer.address)).to.be.revertedWith(
						'InsufficientPermission'
					);
				}
			});
		}
	});
});

async function zap(sender: SignerWithAddress, zapParams: ZapParams, error?: string) {
	if (zapParams.isVesting) {
		if (error) {
			await expect(
				lockZap
					.connect(sender)
					.zapFromVesting(
						zapParams.isBorrowing,
						zapParams.assetAddress,
						zapParams.assetAmount,
						zapParams.lockTypeIndex,
						zapParams.slippage,
						{
							value: zapParams.nativeTokenAmount,
						}
					)
			).to.be.revertedWith(error);
		} else {
			await lockZap
				.connect(sender)
				.zapFromVesting(
					zapParams.isBorrowing,
					zapParams.assetAddress,
					zapParams.assetAmount,
					zapParams.lockTypeIndex,
					zapParams.slippage,
					{
						value: zapParams.nativeTokenAmount,
					}
				);
		}
	} else {
		if (error) {
			await expect(
				lockZap
					.connect(sender)
					.zap(
						zapParams.isBorrowing,
						zapParams.assetAddress,
						zapParams.assetAmount,
						zapParams.prntAmount,
						zapParams.lockTypeIndex,
						zapParams.slippage,
						{
							value: zapParams.nativeTokenAmount,
						}
					)
			).to.be.revertedWith(error);
		} else {
			await lockZap
				.connect(sender)
				.zap(
					zapParams.isBorrowing,
					zapParams.assetAddress,
					zapParams.assetAmount,
					zapParams.prntAmount,
					zapParams.lockTypeIndex,
					zapParams.slippage,
					{
						value: zapParams.nativeTokenAmount,
					}
				);
		}
	}
}

async function getPreZapState(userAddress: string, assetAddress: string): Promise<ZapState> {
	let userTokenBalance;
	let lendingProtocolBalance;
	if (assetAddress == ETHAddress) {
		assetAddress = wethAddress;
		userTokenBalance = await ethers.provider.getBalance(userAddress);
	}
	const erc20Token = await ethers.getContractAt('MockToken', assetAddress);
	userTokenBalance = await erc20Token.balanceOf(userAddress);

	const rTokenAddress = (await lendingPool.getReserveData(assetAddress)).aTokenAddress;
	lendingProtocolBalance = await erc20Token.balanceOf(rTokenAddress);

	const mfdLPBalance = await LP.balanceOf(mfd.address);
	const mfdUserLocks = (await mfd.lockedBalances(userAddress)).total;
	const totalVesting = (await mfd.earnedBalances(userAddress)).totalVesting;

	return {userTokenBalance, mfdLPBalance, mfdUserLocks, lendingProtocolBalance, totalVesting};
}

async function validateZapStateChange(
	initialState: ZapState,
	zapParams: ZapParams,
	userAddress: string
): Promise<ZapState> {
	let userTokenBalance: BigNumber;
	let lendingProtocolBalance: BigNumber;
	let assetDecimals;

	if (zapParams.assetAddress == ETHAddress && zapParams.nativeTokenAmount != ethers.constants.Zero) {
		zapParams.assetAddress = wethAddress;
		zapParams.assetAmount = zapParams.nativeTokenAmount;
		assetDecimals = 18;
		userTokenBalance = await ethers.provider.getBalance(userAddress);
	} else if (zapParams.assetAddress == ETHAddress) {
		const erc20Token = await ethers.getContractAt('MockToken', wethAddress);
		zapParams.assetAddress = wethAddress;
		userTokenBalance = await erc20Token.balanceOf(userAddress);
		assetDecimals = await erc20Token.decimals();
	} else {
		const erc20Token = await ethers.getContractAt('MockToken', zapParams.assetAddress);
		userTokenBalance = await erc20Token.balanceOf(userAddress);
		assetDecimals = await erc20Token.decimals();
	}

	// MFD LP balance should be increased by the value of the zapped ETH amount
	const mfdLPBalance = await LP.balanceOf(mfd.address);
	const lpDecimals = await LP.decimals();
	const lpPriceUSD = await priceProvider.getLpTokenPriceUsd(); // 8 decimals
	// Get token price
	let assetPrice;
	assetPrice = await aaveOracle.getAssetPrice(zapParams.assetAddress);

	let expectedZapLpAmount;
	// If prnt is provided, the expected lp amount is calculated based on a combination of the provided PRNT and assetAddress
	if (zapParams.prntAmount != ethers.constants.Zero) {
		const prntPrice = await priceProvider.getTokenPriceUsd(); // 8 decimals
		const zapAssetValue = zapParams.assetAmount.mul(assetPrice).div(ethers.utils.parseUnits('1', assetDecimals));
		const zapPRNTValue = zapParams.prntAmount.mul(prntPrice).div(ethers.utils.parseUnits('1', 18));
		const dLPAmountFromAsset = zapAssetValue.mul(ethers.utils.parseUnits('1', lpDecimals)).div(lpPriceUSD);
		const dLPAmountFromPRNT = zapPRNTValue.mul(ethers.utils.parseUnits('1', 18)).div(lpPriceUSD);
		expectedZapLpAmount = dLPAmountFromAsset.add(dLPAmountFromPRNT);
		// If the prime is provided from the vesting balance, then the expected dLP value is calculated based on the ETH ratio of the LP pool. (Which is 20% with balancer)
	} else if (zapParams.isVesting) {
		const zapAssetValue = zapParams.assetAmount.mul(assetPrice).div(ethers.utils.parseUnits('1', assetDecimals));
		const zapAssetAndVestingPrntValue = zapAssetValue
			.mul(await lockZap.RATIO_DIVISOR())
			.div(await lockZap.ethLPRatio());
		expectedZapLpAmount = zapAssetAndVestingPrntValue.mul(ethers.utils.parseUnits('1', lpDecimals)).div(lpPriceUSD);
	} else {
		const zapAssetValue = zapParams.assetAmount.mul(assetPrice).div(ethers.utils.parseUnits('1', assetDecimals));
		expectedZapLpAmount = zapAssetValue.mul(ethers.utils.parseUnits('1', lpDecimals)).div(lpPriceUSD);
	}
	
	// We consider the possibility for slippage
	// ToDo, the expected amount should be read from the AMM
	// RN we accept a 5% margin in either direction
	const expectedZapLPAmountWithMarginFloor = expectedZapLpAmount.sub(
		expectedZapLpAmount
			.mul(ethers.utils.parseUnits('0.05', lpDecimals))
			.div(ethers.utils.parseUnits('1', lpDecimals))
	);
	const expectedZapLPAmountWithMarginCeiling = expectedZapLpAmount.add(
		expectedZapLpAmount
			.mul(ethers.utils.parseUnits('0.05', lpDecimals))
			.div(ethers.utils.parseUnits('1', lpDecimals))
	);

	// MFD LP balance should be increased by the expected amount
	expect(mfdLPBalance).to.be.gte(initialState.mfdLPBalance.add(expectedZapLPAmountWithMarginFloor));
	expect(mfdLPBalance).to.be.lte(initialState.mfdLPBalance.add(expectedZapLPAmountWithMarginCeiling));
	// MFD lock balance should be increased by the received LP token amount
	const mfdLPBalanceDelta = mfdLPBalance.sub(initialState.mfdLPBalance);
	const mfdUserLocks = (await mfd.lockedBalances(user2.address)).total;
	expect(mfdUserLocks).to.be.eq(initialState.mfdLPBalance.add(mfdLPBalanceDelta));
	
	// Either users wallet balance or the lending protocols balance should be decreased by the ZAP value
	if (zapParams.isBorrowing) {
		const borrowedToken = await ethers.getContractAt('MockToken', zapParams.assetAddress);
		const rTokenAddress = (await lendingPool.getReserveData(zapParams.assetAddress)).aTokenAddress;
		lendingProtocolBalance = await borrowedToken.balanceOf(rTokenAddress);
		expect(lendingProtocolBalance).to.be.eq(initialState.lendingProtocolBalance.sub(zapParams.assetAmount));
		// We might get some weth dust refunded
		expect(userTokenBalance).to.gte(initialState.userTokenBalance);
	} else {
		if (zapParams.assetAddress == wethAddress) {
			// We might get some weth dust refunded
			expect(userTokenBalance).to.gte(initialState.userTokenBalance.sub(zapParams.assetAmount));
		} else {
			expect(userTokenBalance).to.eq(initialState.userTokenBalance.sub(zapParams.assetAmount));
		}
		// No lending should have taken place
		const borrowedToken = await ethers.getContractAt('MockToken', zapParams.assetAddress);
		const rTokenAddress = (await lendingPool.getReserveData(zapParams.assetAddress)).aTokenAddress;
		lendingProtocolBalance = await borrowedToken.balanceOf(rTokenAddress);
		expect(lendingProtocolBalance).to.be.eq(initialState.lendingProtocolBalance);
	}
	// If we zap from vesting, the user should have 0 vesting tokens left
	let totalVesting = ethers.constants.Zero;
	if (zapParams.isVesting) {
		totalVesting = (await mfd.earnedBalances(user2.address)).totalVesting;
		expect(totalVesting).to.be.eq(ethers.constants.Zero);
	}

	return {
		userTokenBalance,
		mfdLPBalance,
		mfdUserLocks,
		lendingProtocolBalance,
		totalVesting,
	};
}
