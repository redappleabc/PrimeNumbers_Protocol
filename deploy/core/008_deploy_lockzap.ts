import {DeployStep} from '../../scripts/deploy/depfunc';
import {LP_PROVIDER} from '../../scripts/deploy/types';

let step = new DeployStep({
	id: 'deploy_lockzap',
	requireTags: ['prime'],
});
let func = step.setFunction(async function () {
	const {deploy, read, config, get, weth} = step;

	const poolHelper = await get('PoolHelper');
	const aaveOracle = await get('AaveOracle');
	const lendingPool = await read('LendingPoolAddressesProvider', 'getLendingPool');
	const primeToken = await get('PrimeToken');

	let useUniswapLpProvider = config.LP_PROVIDER === LP_PROVIDER.UNISWAP;
	const ethLpRatio = useUniswapLpProvider ? 5000 : 2000;

	let lockzapContract = 'LockZap';
	if (hre.network.tags.mocks) {
		lockzapContract = 'TestnetLockZap';
	}

	let routerAddress;
	if (network.tags.mocks) {
		routerAddress = (await deployments.get('UniswapV2Router02')).address;
	} else {
		routerAddress = config.ROUTER_ADDR;
	}
	await deploy('LockZap', {
		contract: lockzapContract,
		proxy: {
			proxyContract: 'OpenZeppelinTransparentProxy',
			execute: {
				init: {
					methodName: 'initialize',
					args: [
						poolHelper.address,
						routerAddress,
						lendingPool,
						weth.address,
						primeToken.address,
						ethLpRatio,
						aaveOracle.address,
					],
				},
			},
		},
	});
});
export default func;
