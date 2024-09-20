import {DeployStep} from '../../scripts/deploy/depfunc';

let step = new DeployStep({
	id: 'deploy_prnt_oracle',
	requireTags: ['prime'],
});
let func = step.setFunction(async function () {
	const {deploy, execute, read, config, chainlinkEthUsd, get} = step;

	const stakingAddress = await read('PoolHelper', 'lpTokenAddr');
	let primeToken = await deployments.get('PrimeToken');

	let oracle;
	if (network.tags.oracle_v3) {
		const pair2 = '0x2334d412da299a21486b663d12c392185b313aaa';
		const fallbackPair = '0x24704aff49645d32655a76df6d407e02d146dafc';

		oracle = await deploy('UniV3TwapOracle', {
			contract: 'UniV3TwapOracle',
			proxy: {
				proxyContract: 'OpenZeppelinTransparentProxy',
				execute: {
					methodName: 'initialize',
					args: [pair2, primeToken.address, chainlinkEthUsd, 60],
				},
			},
		});
		let fallback = await deploy('UniV2TwapOracle', {
			proxy: {
				proxyContract: 'OpenZeppelinTransparentProxy',
				execute: {
					methodName: 'initialize',
					args: [fallbackPair, primeToken.address, chainlinkEthUsd, config.TWAP_PERIOD, 30, true],
				},
			},
		});
		if (fallback.newlyDeployed) {
			await execute('UniV3TwapOracle', 'setFallback', fallback.address);
			await execute('UniV2TwapOracle', 'update');
		}
	}

	if (network.tags.oracle_v2) {
		oracle = await deploy('UniV2TwapOracle', {
			contract: 'UniV2TwapOracle',
			proxy: {
				proxyContract: 'OpenZeppelinTransparentProxy',
				execute: {
					methodName: 'initialize',
					args: [stakingAddress, primeToken.address, chainlinkEthUsd, config.TWAP_PERIOD, 120, true],
				},
			},
		});
	}

	if (network.tags.oracle_cl) {
		let prntClAdapter = await get('ChainlinkAdapterPRNT');
		let ethClAdapter = await get('ChainlinkAdapterWETH');

		oracle = await deploy('PrimeChainlinkOracle', {
			proxy: {
				proxyContract: 'OpenZeppelinTransparentProxy',
				execute: {
					methodName: 'initialize',
					args: [ethClAdapter.address, prntClAdapter.address],
				},
			},
		});
	}
});
export default func;
