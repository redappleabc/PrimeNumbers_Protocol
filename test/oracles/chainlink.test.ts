import {ethers} from 'hardhat';
import {IChainlinkAggregator, ISequencerAggregator, IArbitrumSequencerUptimeFeed, PriceProvider} from '../../typechain';
import chai from 'chai';
import {solidity} from 'ethereum-waffle';
import {advanceTimeAndBlock} from '../shared/helpers';
import {DeployConfig} from '../../scripts/deploy/types';
import {getLatestBlockTimestamp} from '../../scripts/utils';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {getConfigForChain} from '../../config';
import {Deployment} from 'hardhat-deploy/types';

chai.use(solidity);
const {expect} = chai;

const hre = require('hardhat');
const {deployments, getNamedAccounts} = hre;
const {read, execute, deploy, fixture} = deployments;

describe('Chainlink Adapters', function () {
	let uptimeFeedAggregator: IChainlinkAggregator;
	let uptimeFeed: IArbitrumSequencerUptimeFeed;
	let deployer: SignerWithAddress;
	let heartbeat = 86400;
	let aggregator: Deployment;
	let mockPrice = 100000000;

	beforeEach(async function () {
		({deployer} = await getNamedAccounts());

		let usdc = await deploy('USDC', {
			contract: 'MockToken',
			from: deployer,
			args: ['USDC', 'USDC', 6],
		});

		aggregator = await deploy(`USDCAggregator`, {
			contract: 'MockChainlinkAggregator',
			from: deployer,
			args: [mockPrice],
		});

		await deploy('ValidatedChainlinkAdapterUSDC', {
			contract: 'ValidatedChainlinkAdapter',
			from: deployer,
			args: [aggregator.address, heartbeat],
		});

		let nowTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
		await execute('USDCAggregator', {from: deployer}, 'setUpdatedAt', nowTimestamp);
		await execute('USDCAggregator', {from: deployer}, 'setPrice', mockPrice);

		let price = await read('ValidatedChainlinkAdapterUSDC', 'latestAnswer');
		expect(price).eq(mockPrice);
	});

	it('RoundNotComplete when 0 update time', async function () {
		await execute('USDCAggregator', {from: deployer}, 'setUpdatedAt', 0);
		await expect(read('ValidatedChainlinkAdapterUSDC', 'latestAnswer')).to.be.revertedWith('RoundNotComplete');
	});

	it('InvalidPrice when 0 price', async function () {
		await execute('USDCAggregator', {from: deployer}, 'setPrice', 0);
		await expect(read('ValidatedChainlinkAdapterUSDC', 'latestAnswer')).to.be.revertedWith('InvalidPrice');
	});

	it('StalePrice when heartbeat elapsed', async function () {
		let hb = await read('ValidatedChainlinkAdapterUSDC', 'heartbeat');
		let buffer = await read('ValidatedChainlinkAdapterUSDC', 'HEART_BEAT_TOLERANCE');
		let toElapse = hb.add(buffer).toNumber();

		await advanceTimeAndBlock(toElapse);
		await expect(read('ValidatedChainlinkAdapterUSDC', 'latestAnswer')).to.be.revertedWith('StalePrice');
	});

	it('check sequencer status on Arbitrum', async function () {
		await fixture('sequencer');

		const {config} = getConfigForChain(await hre.getChainId());

		if (config.ARBITRUM_SEQUENCER_UPTIME_FEED_AGGREGATOR_PROXY) {
			uptimeFeedAggregator = <ISequencerAggregator>(
				await ethers.getContractAt(
					'ISequencerAggregator',
					config.ARBITRUM_SEQUENCER_UPTIME_FEED_AGGREGATOR_PROXY
				)
			);

			const latestRoundData = await uptimeFeedAggregator.latestRoundData();
			expect(latestRoundData.answer.toNumber()).to.be.equal(0);

			await deploy('ValidatedChainlinkAdapterUSDCWithSequencer', {
				contract: 'ValidatedChainlinkAdapterWithSequencer',
				from: deployer,
				args: [aggregator.address, heartbeat],
			});

			let nowTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
			await execute('USDCAggregator', {from: deployer}, 'setUpdatedAt', nowTimestamp);

			let price = await read('ValidatedChainlinkAdapterUSDCWithSequencer', 'latestAnswer');
			expect(price).eq(mockPrice);

			const uptimeFeedAddress = await uptimeFeedAggregator.aggregator();
			uptimeFeed = <IArbitrumSequencerUptimeFeed>(
				await ethers.getContractAt('IArbitrumSequencerUptimeFeed', uptimeFeedAddress)
			);
			const aliasedL1MessageSenderAddress = await uptimeFeed.aliasedL1MessageSender();
			await hre.network.provider.request({
				method: 'hardhat_impersonateAccount',
				params: [aliasedL1MessageSenderAddress],
			});
			const aliasedL1MessageSender = ethers.provider.getSigner(aliasedL1MessageSenderAddress);
			const timestamp = await getLatestBlockTimestamp();
			await uptimeFeed.connect(aliasedL1MessageSender).updateStatus(true, timestamp);

			const latestRoundData1 = await uptimeFeedAggregator.latestRoundData();
			const updatedStatus = latestRoundData1.answer.toNumber();
			expect(updatedStatus).to.be.equal(1);

			await expect(read('ValidatedChainlinkAdapterUSDCWithSequencer', 'latestAnswer')).to.be.revertedWith(
				'SequencerDown'
			);

			const timestamp1 = await getLatestBlockTimestamp();
			await uptimeFeed.connect(aliasedL1MessageSender).updateStatus(false, timestamp1);

			const latestRoundData2 = await uptimeFeedAggregator.latestRoundData();
			const updatedStatus2 = latestRoundData2.answer.toNumber();
			expect(updatedStatus2).to.be.equal(0);

			await expect(read('ValidatedChainlinkAdapterUSDCWithSequencer', 'latestAnswer')).to.be.revertedWith(
				'GracePeriodNotOver'
			);

			await advanceTimeAndBlock(3600);
			await expect(read('ValidatedChainlinkAdapterUSDCWithSequencer', 'latestAnswer')).to.be.not.reverted;
		}
	});
});
