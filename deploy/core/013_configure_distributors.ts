import {DeployStep} from '../../scripts/deploy/depfunc';

let step = new DeployStep({
	id: 'configure_distributors',
	requireTags: ['prime'],
	runOnce: true,
});
let func = step.setFunction(async function () {
	const {config, get, treasury, execute, executeFromOwner} = step;

	const mfd = await get('MFD');

	await executeFromOwner('MiddleFeeDistribution', 'setOperationExpenses', treasury, config.OPEX_RATIO);
	await execute('LockZap', 'setMfd', mfd.address);
	await execute('MFD', 'setLockTypeInfo', config.LOCK_INFO.LOCK_PERIOD, config.LOCK_INFO.MULTIPLIER);
});
export default func;
