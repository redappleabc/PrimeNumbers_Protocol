import {ethers} from 'hardhat';
import {DeployStep} from '../../scripts/deploy/depfunc';
import {advanceTimeAndBlock} from '../../test/shared/helpers';

let step = new DeployStep({
	id: 'sequencer',
});
let func = step.setFunction(async function () {
	const {deploy, network, config} = step;
	if (network.tags.mocks && !network.tags.fork && config && config.ARBITRUM_SEQUENCER_UPTIME_FEED_AGGREGATOR_PROXY) {
		const uptimeFeed = await deploy(`MockArbitrumSequencerUptimeFeed`, {
			args: [],
		});

		const MockSequencerAggregator = await ethers.getContractFactory('MockSequencerAggregator');
		const sequencer = await MockSequencerAggregator.deploy();
		await sequencer.deployed();

		const byteCode = await network.provider.send('eth_getCode', [sequencer.address]);
		await network.provider.send('hardhat_setCode', ['0xFdB631F5EE196F0ed6FAa767959853A9F217697D', byteCode]);
		const sequencerAggregator = MockSequencerAggregator.attach('0xFdB631F5EE196F0ed6FAa767959853A9F217697D');
		const initTx = await sequencerAggregator.init(uptimeFeed.address);
		await initTx.wait();
		await advanceTimeAndBlock(3600);
	}
});
export default func;
