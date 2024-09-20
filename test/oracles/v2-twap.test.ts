import {ethers} from 'hardhat';
import _ from 'lodash';
import chai from 'chai';
import {solidity} from 'ethereum-waffle';
import {advanceTimeAndBlock} from '../shared/helpers';
import {MockChainlinkAggregator, PrimeToken, TestnetLockZap, UniV2TwapOracle, WETH} from '../../typechain';
import {targetPrice} from '../../config/BaseConfig';
import {BigNumber} from 'ethers';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {setupTest} from '../setup';
import {LP_PROVIDER} from '../../scripts/deploy/types';
const {deployments} = require('hardhat');

chai.use(solidity);
const {expect} = chai;

const priceToJsNum = (oracleAnswer: BigNumber) => {
	return parseFloat(ethers.utils.formatUnits(oracleAnswer, 8));
};

describe('Uni V2 TWAP', () => {
	const {deploy, execute, read} = deployments;

	let oracle: UniV2TwapOracle;
	let lockZap: TestnetLockZap;
	let prntToken: PrimeToken;
	let weth: WETH;
	let chainlinkEthFeed: MockChainlinkAggregator;
	let period: number;
	let startingPrntPrice = targetPrice;
	let nonAdminUser: SignerWithAddress;
	let dao: SignerWithAddress;
	let deployer: SignerWithAddress;
	let useUniswapLpProvider: boolean;

	before(async () => {
		const fixture = await setupTest();
		lockZap = fixture.lockZap;
		prntToken = fixture.prntToken;
		weth = fixture.weth;
		nonAdminUser = fixture.user2;
		dao = fixture.dao;
		deployer = fixture.deployer;
		useUniswapLpProvider = fixture.deployConfig.LP_PROVIDER === LP_PROVIDER.UNISWAP;

		period = fixture.deployConfig.TWAP_PERIOD;

		chainlinkEthFeed = <MockChainlinkAggregator>(
			await ethers.getContractAt(
				'MockChainlinkAggregator',
				fixture.deployConfig.CHAINLINK_ETH_USD_AGGREGATOR_PROXY
			)
		);

		let stakingAddress = await read('UniswapV2Factory', 'getPair', prntToken.address, weth.address);
		await deploy('UniV2TwapOracle', {
			contract: 'UniV2TwapOracle',
			from: deployer.address,
			log: true,
			proxy: {
				proxyContract: 'OpenZeppelinTransparentProxy',
				execute: {
					methodName: 'initialize',
					args: [stakingAddress, prntToken.address, chainlinkEthFeed.address, period, 120, true],
				},
			},
		});
		oracle = <UniV2TwapOracle>await ethers.getContract('UniV2TwapOracle');
	});

	it('can be updated', async () => {
		await advanceTimeAndBlock(period);

		const canUpdate = await oracle.canUpdate();
		expect(canUpdate).equals(true);

		await expect(oracle.update()).to.be.not.reverted;
	});

	it('returns price', async () => {
		await advanceTimeAndBlock(period);
		await oracle.update();

		const priceAnswer = await oracle.latestAnswer();
		expect(priceToJsNum(priceAnswer)).to.be.closeTo(startingPrntPrice, 0.1);
	});

	it('LP token change reflected in price after update', async () => {
		if (!useUniswapLpProvider) {
			console.log('skipping...');
			return;
		}

		const lots = ethers.utils.parseEther('100000000');
		await prntToken.connect(dao).approve(lockZap.address, lots);
		await lockZap.connect(dao).sell(lots);

		const priceAnswer = await oracle.latestAnswer();

		// hasnt updated yet, should be same
		expect(priceToJsNum(priceAnswer)).to.be.closeTo(startingPrntPrice, 0.1);

		await advanceTimeAndBlock(period);
		await oracle.update();

		const priceAnswerAfter = await oracle.latestAnswer();

		expect(priceToJsNum(priceAnswerAfter)).to.be.lt(startingPrntPrice / 2);
	});
});
