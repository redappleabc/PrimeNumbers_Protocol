import {DeployStep} from '../../scripts/deploy/depfunc';

let step = new DeployStep({
	id: 'configure_minters',
	requireTags: ['prime'],
	runOnce: true,
});
let func = step.setFunction(async function () {
	const {execute, read} = step;

	const cic = await deployments.get(`ChefIncentivesController`);
	const middleFeeDistribution = await deployments.get(`MiddleFeeDistribution`);
	const mintersSet = await read('MFD', 'mintersAreSet');

	const {vestManager, starfleet} = await getNamedAccounts();

	if (!mintersSet) {
		await execute('MFD', 'setMinters', [cic.address, middleFeeDistribution.address, vestManager]);
		await execute('MFD', 'setAddresses', cic.address, middleFeeDistribution.address, starfleet);
	}
});
export default func;
