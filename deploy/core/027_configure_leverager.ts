import {DeployStep} from '../../scripts/deploy/depfunc';

let step = new DeployStep({
	id: 'configure_leverager',
	requireTags: ['prime'],
	runOnce: true,
});
let func = step.setFunction(async function () {
	const {get, execute, read, executeFrom} = step;

	const leverager = await get(`Leverager`);
	const cic = await get(`ChefIncentivesController`);

	let cicOwner = await read('ChefIncentivesController', 'owner');

	await execute('Leverager', 'setChefIncentivesController', cic.address);
	await executeFrom('ChefIncentivesController', cicOwner, 'setLeverager', leverager.address);
});
export default func;
