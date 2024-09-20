import {DeployStep} from '../../scripts/deploy/depfunc';

let step = new DeployStep({
	id: 'fund_cic',
	requireTags: ['fund_cic'],
	runOnce: true,
});
let func = step.setFunction(async function () {
	const {get, executeFrom, read, reserve} = step;

	const cic = await get('ChefIncentivesController');
	let amount = await read('PrimeToken', 'balanceOf', reserve);
	await executeFrom('PrimeToken', reserve, 'transfer', cic.address, amount);
	let owner = await read('ChefIncentivesController', 'owner');
	await executeFrom('ChefIncentivesController', owner, 'registerRewardDeposit', amount);
});
export default func;
