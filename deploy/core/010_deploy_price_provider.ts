import {DeployStep} from '../../scripts/deploy/depfunc';

let step = new DeployStep({
	id: 'deploy_price_provider',
	requireTags: ['prime'],
});
let func = step.setFunction(async function () {
	const {deploy, get} = step;

	const poolHelper = await get('PoolHelper');
	const ethClAdapter = await get('ChainlinkAdapterWETH');

	await deploy('PriceProvider', {
		proxy: {
			proxyContract: 'OpenZeppelinTransparentProxy',
			execute: {
				init: {
					methodName: 'initialize',
					args: [ethClAdapter.address, poolHelper.address],
				},
			},
		},
	});
});
export default func;
