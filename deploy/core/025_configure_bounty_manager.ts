import {DeployStep} from '../../scripts/deploy/depfunc';

let step = new DeployStep({
	id: 'configure_bounty_manager',
	requireTags: ['prime'],
	runOnce: true,
});
let func = step.setFunction(async function () {
	const {get, config, execute} = step;

	const bountyManager = await get('BountyManager');

	await execute('PrimeToken', 'transfer', bountyManager.address, config.SUPPLY_DQ_RESERVE);

	await execute('BountyManager', 'setMinStakeAmount', config.MIN_STAKE_AMT);

	await execute('MFD', 'setBountyManager', bountyManager.address);

	await execute('ChefIncentivesController', 'setBountyManager', bountyManager.address);
	await execute('ChefIncentivesController', 'setEligibilityExempt', bountyManager.address, true);

	await execute('Compounder', 'setBountyManager', bountyManager.address);
});
export default func;
