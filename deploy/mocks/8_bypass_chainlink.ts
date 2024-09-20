import {DeployStep} from '../../scripts/deploy/depfunc';

let step = new DeployStep({
	id: 'bypass_chainlink',
	requireTags: ['bypass_chainlink'],
});
let func = step.setFunction(async function () {
	const {executeFrom, read} = step;
	let owner = await read('PriceProvider', 'owner');
	await executeFrom('PriceProvider', owner, 'setUsePool', true);
});
export default func;
