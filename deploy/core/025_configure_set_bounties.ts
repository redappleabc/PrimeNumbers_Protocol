import {DeployStep} from '../../scripts/deploy/depfunc';

let step = new DeployStep({
	id: 'configure_set_bounties',
	requireTags: ['prime'],
});
let func = step.setFunction(async function () {
	const {executeFromOwner} = step;
	await executeFromOwner('BountyManager', 'setBounties');
});
export default func;
