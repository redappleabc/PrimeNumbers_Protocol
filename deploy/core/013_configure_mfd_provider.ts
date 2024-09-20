import {DeployStep} from '../../scripts/deploy/depfunc';

let step = new DeployStep({
	id: 'configure_mfd_provider',
	requireTags: ['prime'],
	runOnce: true,
});
let func = step.setFunction(async function () {
	const {get, read, executeFrom} = step;

	let owner = await read('MiddleFeeDistribution', 'owner');
	const aaveDataProvider = await get('AaveProtocolDataProvider');
	await executeFrom('MiddleFeeDistribution', owner, 'setProtocolDataProvider', aaveDataProvider.address);
});
export default func;
