import {DeployStep} from '../../scripts/deploy/depfunc';

let step = new DeployStep({
	id: 'configure_lockzap',
	requireTags: ['prime'],
	runOnce: true,
});
let func = step.setFunction(async function () {
	const {config, get, executeFromOwner} = step;

	const lockZap = await deployments.get('LockZap');
	const aaveOracle = await get('AaveOracle');

	let routerAddress;
	if (network.tags.mocks) {
		routerAddress = (await deployments.get('UniswapV2Router02')).address;
	} else {
		routerAddress = config.ROUTER_ADDR;
	}

	await executeFromOwner('PoolHelper', 'setLockZap', lockZap.address);
	await executeFromOwner('LockZap', 'setUniRouter', routerAddress);
	await executeFromOwner('LockZap', 'setAaveOracle', aaveOracle.address);
});
export default func;
