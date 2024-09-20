import {DeployStep} from '../../scripts/deploy/depfunc';
import {LP_PROVIDER} from '../../scripts/deploy/types';

let step = new DeployStep({
	id: 'deploy_lp',
	requireTags: ['lp'],
	dependencies: ['weth'],
});
let func = step.setFunction(async function () {
	const {deploy, config, network, weth} = step;

	const primeToken = await deployments.get('PrimeToken');

	let useUniswapLpProvider = config.LP_PROVIDER === LP_PROVIDER.UNISWAP;

	if (useUniswapLpProvider) {
		let router;
		if (network.tags.mocks) {
			router = (await deployments.get('UniswapV2Router02')).address;
		} else {
			router = config.ROUTER_ADDR;
		}

		const liquidityZap = await deploy('LiquidityZap', {
			proxy: {
				proxyContract: 'OpenZeppelinTransparentProxy',
				execute: {
					init: {
						methodName: 'initialize',
						args: [],
					},
				},
			},
		});

		let phContract = 'UniswapPoolHelper';
		if (network.tags.testing) {
			phContract = 'TestUniswapPoolHelper';
		}

		await deploy('PoolHelper', {
			contract: phContract,
			proxy: {
				proxyContract: 'OpenZeppelinTransparentProxy',
				execute: {
					init: {
						methodName: 'initialize',
						args: [primeToken.address, weth.address, router, liquidityZap.address],
					},
				},
			},
		});
	} else {
		// Balancer
		await deploy('PoolHelper', {
			contract: 'BalancerPoolHelper',
			proxy: {
				proxyContract: 'OpenZeppelinTransparentProxy',
				execute: {
					init: {
						methodName: 'initialize',
						args: [
							weth.address,
							primeToken.address,
							weth.address,
							config.BAL_VAULT,
							config.BAL_WEIGHTED_POOL_FACTORY,
						],
					},
				},
			},
		});
	}
});
export default func;
