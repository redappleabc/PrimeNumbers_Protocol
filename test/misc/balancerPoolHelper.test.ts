import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import hre, {ethers, upgrades} from 'hardhat';
import {BalancerPoolHelper, PrimeToken, WETH} from '../../typechain';
import {DeployConfig} from '../../scripts/deploy/types';
import {getConfigForChain} from '../../scripts/deploy/helpers/getConfig';
import chai from 'chai';
import {solidity} from 'ethereum-waffle';
import {BigNumber} from 'ethers';
chai.use(solidity);
const {expect} = chai;

async function deployContract(contractName: string, opts: any, ...args: any) {
	const factory = await ethers.getContractFactory(contractName, opts);
	const contract = await factory.deploy(...args);
	await contract.deployed();
	return contract;
}

describe('Balancer Pool Helper', function () {
	if (hre.network.tags.fork) {
		let preTestSnapshotID: any;
		let deployConfig: DeployConfig;

		let deployer: SignerWithAddress;
		let dao: SignerWithAddress;
		let treasury: SignerWithAddress;

		let poolHelper: BalancerPoolHelper;
		let wethContract: WETH;
		let primeToken: PrimeToken;

		const pool1EthAmt = 5000;
		const pool1OtherAmt = pool1EthAmt * 4;

		const ethAmt = ethers.utils.parseUnits('1', 18);
		const prntAmt = ethers.utils.parseUnits('40', 18);
		const eightyPercent = ethers.BigNumber.from('800000000000000000');
		const twentyPercent = ethers.BigNumber.from('200000000000000000');
		const tokenWeights = [eightyPercent, twentyPercent];

		beforeEach(async function () {
			preTestSnapshotID = await hre.network.provider.send('evm_snapshot');

			const {chainId} = await ethers.provider.getNetwork();
			deployConfig = getConfigForChain(chainId);

			[deployer, dao, treasury] = await ethers.getSigners();

			wethContract = <WETH>await deployContract('WETH', {});

			primeToken = <PrimeToken>(
				await deployContract(
					'PrimeToken',
					{},
					deployConfig.TOKEN_NAME,
					deployConfig.SYMBOL,
					deployConfig.LZ_ENDPOINT,
					dao.address,
					treasury.address,
					deployConfig.MINT_AMT
				)
			);

			const poolHelperFactory = await ethers.getContractFactory('BalancerPoolHelper');
			poolHelper = <BalancerPoolHelper>(
				await upgrades.deployProxy(
					poolHelperFactory,
					[
						wethContract.address,
						primeToken.address,
						wethContract.address,
						deployConfig.BAL_VAULT,
						deployConfig.BAL_WEIGHTED_POOL_FACTORY,
					],
					{initializer: 'initialize', unsafeAllow: ['constructor']}
				)
			);
			await poolHelper.deployed();
			await wethContract.deposit({
				value: ethAmt,
			});

			await wethContract.transfer(poolHelper.address, ethAmt);

			await primeToken.connect(dao).transfer(poolHelper.address, prntAmt);
			await primeToken.connect(dao).transfer(deployer.address, deployConfig.LP_INIT_PRNT);

			await poolHelper.initializePool('PRNT-WETH', 'PRNTLP');
			await poolHelper.setLockZap(deployer.address);

			await wethContract.approve(poolHelper.address, ethers.constants.MaxUint256);
			await primeToken.approve(poolHelper.address, ethers.constants.MaxUint256);
		});

		describe('initializePool', async () => {
			it('initializePool with different order', async () => {
				const poolHelperFactory = await ethers.getContractFactory('BalancerPoolHelper');
				const newPoolHelper = <BalancerPoolHelper>(
					await upgrades.deployProxy(
						poolHelperFactory,
						[
							wethContract.address,
							primeToken.address,
							wethContract.address,
							deployConfig.BAL_VAULT,
							deployConfig.BAL_WEIGHTED_POOL_FACTORY,
						],
						{initializer: 'initialize', unsafeAllow: ['constructor']}
					)
				);
				await newPoolHelper.deployed();

				await wethContract.deposit({
					value: deployConfig.LP_INIT_ETH,
				});
				await wethContract.transfer(newPoolHelper.address, deployConfig.LP_INIT_ETH);
				await primeToken.connect(dao).transfer(newPoolHelper.address, deployConfig.LP_INIT_PRNT);

				await newPoolHelper.initializePool('PRNT-WETH', 'PRNTLP');
				await newPoolHelper.setLockZap(deployer.address);

				const amount = ethers.utils.parseUnits('1', 18);
				await wethContract.deposit({
					value: amount.mul(10),
				});
				await wethContract.approve(newPoolHelper.address, ethers.constants.MaxUint256);
				await primeToken.connect(dao).transfer(newPoolHelper.address, ethers.utils.parseUnits('100000', 18));
				await newPoolHelper.zapWETH(amount);
			});

			it('Only owner can initialize', async () => {
				const poolHelperFactory = await ethers.getContractFactory('BalancerPoolHelper');
				// Deploy
				const newPoolHelper = <BalancerPoolHelper>(
					await upgrades.deployProxy(
						poolHelperFactory,
						[
							wethContract.address,
							primeToken.address,
							wethContract.address,
							deployConfig.BAL_VAULT,
							deployConfig.BAL_WEIGHTED_POOL_FACTORY,
						],
						{initializer: 'initialize', unsafeAllow: ['constructor']}
					)
				);

				await expect(newPoolHelper.connect(dao).initializePool('PRNT-WETH', 'PRNTLP')).to.be.revertedWith(
					'Ownable: caller is not the owner'
				);
			});

			it('sortTokens: IDENTICAL_ADDRESSES', async () => {
				const poolHelperFactory = await ethers.getContractFactory('BalancerPoolHelper');
				poolHelper = <BalancerPoolHelper>(
					await upgrades.deployProxy(
						poolHelperFactory,
						[
							primeToken.address,
							primeToken.address,
							wethContract.address,
							deployConfig.BAL_VAULT,
							deployConfig.BAL_WEIGHTED_POOL_FACTORY,
						],
						{initializer: 'initialize', unsafeAllow: ['constructor']}
					)
				);
				await poolHelper.deployed();
				await expect(poolHelper.initializePool('PRNT-WETH', 'PRNTLP')).to.be.revertedWith('IdenticalAddresses');
			});

			it('sortTokens: ZERO_ADDRESS', async () => {
				const poolHelperFactory = await ethers.getContractFactory('BalancerPoolHelper');
				await expect(
					upgrades.deployProxy(
						poolHelperFactory,
						[
							ethers.constants.AddressZero,
							primeToken.address,
							wethContract.address,
							deployConfig.BAL_VAULT,
							deployConfig.BAL_WEIGHTED_POOL_FACTORY,
						],
						{initializer: 'initialize', unsafeAllow: ['constructor']}
					)
				).to.be.revertedWith('AddressZero');
				await poolHelper.deployed();
			});

			it('sortTokens: IDENTICAL_ADDRESSES', async () => {
				const poolHelperFactory = await ethers.getContractFactory('BalancerPoolHelper');
				poolHelper = <BalancerPoolHelper>(
					await upgrades.deployProxy(
						poolHelperFactory,
						[
							primeToken.address,
							primeToken.address,
							wethContract.address,
							deployConfig.BAL_VAULT,
							deployConfig.BAL_WEIGHTED_POOL_FACTORY,
						],
						{initializer: 'initialize', unsafeAllow: ['constructor']}
					)
				);
				await poolHelper.deployed();
				await expect(poolHelper.initializePool('PRNT-WETH', 'PRNTLP')).to.be.revertedWith('IdenticalAddresses');
			});

			it('initializePool with different order 2', async () => {
				const poolHelperFactory = await ethers.getContractFactory('BalancerPoolHelper');
				const newPoolHelper = <BalancerPoolHelper>(
					await upgrades.deployProxy(
						poolHelperFactory,
						[
							primeToken.address,
							wethContract.address,
							wethContract.address,
							deployConfig.BAL_VAULT,
							deployConfig.BAL_WEIGHTED_POOL_FACTORY,
						],
						{initializer: 'initialize', unsafeAllow: ['constructor']}
					)
				);
				await newPoolHelper.deployed();

				await wethContract.deposit({
					value: deployConfig.LP_INIT_ETH,
				});
				await wethContract.transfer(newPoolHelper.address, deployConfig.LP_INIT_ETH);
				await primeToken.connect(dao).transfer(newPoolHelper.address, deployConfig.LP_INIT_PRNT);

				await newPoolHelper.initializePool('PRNT-WETH', 'PRNTLP');
				await newPoolHelper.setLockZap(deployer.address);

				const amount = ethers.utils.parseUnits('1', 18);
				await wethContract.deposit({
					value: amount.mul(10),
				});
				await wethContract.approve(newPoolHelper.address, ethers.constants.MaxUint256);
				await primeToken.connect(dao).transfer(newPoolHelper.address, ethers.utils.parseUnits('100000', 18));
				await newPoolHelper.zapWETH(amount);
			});
		});

		it('init params validation', async () => {
			const poolHelperFactory = await ethers.getContractFactory('BalancerPoolHelper');
			await expect(
				poolHelper.initialize(
					wethContract.address,
					primeToken.address,
					wethContract.address,
					deployConfig.BAL_VAULT!,
					deployConfig.BAL_WEIGHTED_POOL_FACTORY!
				)
			).to.be.revertedWith('Initializable: contract is already initialized');
			await expect(
				upgrades.deployProxy(
					poolHelperFactory,
					[
						ethers.constants.AddressZero,
						primeToken.address,
						wethContract.address,
						deployConfig.BAL_VAULT!,
						deployConfig.BAL_WEIGHTED_POOL_FACTORY!,
					],
					{initializer: 'initialize', unsafeAllow: ['constructor']}
				)
			).to.be.revertedWith('AddressZero');
			await expect(
				upgrades.deployProxy(
					poolHelperFactory,
					[
						wethContract.address,
						ethers.constants.AddressZero,
						wethContract.address,
						deployConfig.BAL_VAULT!,
						deployConfig.BAL_WEIGHTED_POOL_FACTORY!,
					],
					{initializer: 'initialize', unsafeAllow: ['constructor']}
				)
			).to.be.revertedWith('AddressZero');
			await expect(
				upgrades.deployProxy(
					poolHelperFactory,
					[
						wethContract.address,
						primeToken.address,
						ethers.constants.AddressZero,
						deployConfig.BAL_VAULT!,
						deployConfig.BAL_WEIGHTED_POOL_FACTORY!,
					],
					{initializer: 'initialize', unsafeAllow: ['constructor']}
				)
			).to.be.revertedWith('AddressZero');
			await expect(
				upgrades.deployProxy(
					poolHelperFactory,
					[
						wethContract.address,
						primeToken.address,
						wethContract.address,
						ethers.constants.AddressZero,
						deployConfig.BAL_WEIGHTED_POOL_FACTORY!,
					],
					{initializer: 'initialize', unsafeAllow: ['constructor']}
				)
			).to.be.revertedWith('AddressZero');
		});

		it('setLockZap', async function () {
			await expect(poolHelper.connect(dao).setLockZap(deployer.address)).to.be.revertedWith(
				'Ownable: caller is not the owner'
			);
			await expect(poolHelper.setLockZap(ethers.constants.AddressZero)).to.be.revertedWith('AddressZero');
		});

		it('swapToWeth', async function () {
			await expect(
				poolHelper.connect(deployer).swapToWeth(ethers.constants.AddressZero, 10, 10)
			).to.be.revertedWith('AddressZero');
			await expect(poolHelper.connect(deployer).swapToWeth(deployer.address, 0, 10)).to.be.revertedWith(
				'ZeroAmount'
			);
		});

		it('set/get SwapFeePercentage', async function () {
			await expect(poolHelper.connect(dao).setSwapFeePercentage(100)).to.be.revertedWith(
				'Ownable: caller is not the owner'
			);
			await expect(poolHelper.setSwapFeePercentage(100)).to.be.reverted;
			await poolHelper.setSwapFeePercentage(BigNumber.from('1000000000000000'));
			expect(await poolHelper.getSwapFeePercentage()).to.be.eq(BigNumber.from('1000000000000000'));
		});

		it('view functions', async function () {
			await poolHelper.getLpPrice(100000);
			await poolHelper.getPrice();
		});

		it('check LP Price', async () => {
			const lpAddr = await poolHelper.lpTokenAddr();
			const lpToken = await ethers.getContractAt('ERC20', lpAddr);
			const lpSupply = await lpToken.totalSupply();

			const prntPriceInEth = BigNumber.from('10000000');
			const ethPriceInEth = BigNumber.from('100000000');

			const lpPrice = await poolHelper.getLpPrice(prntPriceInEth);

			const expectedPrice = prntPriceInEth.mul(prntAmt).add(ethPriceInEth.mul(ethAmt)).div(lpSupply);
			expect(lpPrice).to.be.equal(expectedPrice);
		});

		it('Other functions work', async () => {
			expect(await poolHelper.quoteFromToken('100000000000000')).to.be.gt(0);

			const amount = ethers.utils.parseUnits('1', 18);

			await wethContract.deposit({
				value: amount.mul(10),
			});
			await expect(poolHelper.connect(dao).zapWETH(amount)).to.be.revertedWith('InsufficientPermission');
			await poolHelper.zapWETH(amount);
			await expect(poolHelper.connect(dao).zapTokens(amount, amount)).to.be.revertedWith(
				'InsufficientPermission'
			);
			await poolHelper.zapTokens(amount, amount);
		});

		afterEach(async () => {
			await hre.network.provider.send('evm_revert', [preTestSnapshotID]);
		});
	}
});
