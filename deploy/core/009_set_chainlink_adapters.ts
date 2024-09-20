import {DeployStep} from '../../scripts/deploy/depfunc';

let step = new DeployStep({
	id: 'set_chainlink_adapters',
	requireTags: ['prime'],
	runOnce: true,
});
let func = step.setFunction(async function () {
	const {deploy, execute, get, read, config, weth, treasury, network} = step;

	let assets = [];
	let adapters = [];
	let enhancedTokensConfig = new Map<string, any>(config.TOKENS_CONFIG);

	if (network.tags.oracle_cl) {
		enhancedTokensConfig.set('PRNT', {
			heartbeat: 86400,
			chainlinkAggregator: config.PRNT_CL_FEED,
			assetAddress: (await get('PrimeToken')).address,
		});
	}

	for (const [assetName, value] of enhancedTokensConfig) {
		let heartbeat = value.heartbeat;

		let token, agg;
		if (network.tags.mocks && assetName !== 'PRNT') {
			token = (await deployments.get(assetName)).address;
			agg = (await deployments.get(`${assetName}Aggregator`)).address;
		} else {
			token = value.assetAddress;
			agg = value.chainlinkAggregator;
		}

		let clContract;
		if (network.tags.unvalidated_chainlink) {
			clContract = 'UnvalidatedChainlinkAdapter';
		} else {
			if (network.tags.sequencer) {
				clContract = 'ValidatedChainlinkAdapterWithSequencer';
			} else {
				clContract = 'ValidatedChainlinkAdapter';
			}
		}

		let clAdapter = await deploy(`ChainlinkAdapter${assetName}`, {
			contract: clContract,
			args: [agg, heartbeat],
		});

		// console.log(await read(`ChainlinkAdapter${assetName}`, 'latestAnswer'));

		assets.push(token);
		adapters.push(clAdapter.address);
	}

	await execute('AaveOracle', 'setAssetSources', assets, adapters);
});
export default func;
