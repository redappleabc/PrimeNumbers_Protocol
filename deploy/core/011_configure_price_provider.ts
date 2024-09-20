import {DeployStep} from '../../scripts/deploy/depfunc';

let step = new DeployStep({
	id: 'configure_price_provider',
	requireTags: ['prime'],
	runOnce: true,
});
let func = step.setFunction(async function () {
	const {get, execute, executeFromOwner, read} = step;

	const priceProvider = await get('PriceProvider');

	await executeFromOwner('PrimeToken', 'setPriceProvider', priceProvider.address);
	await executeFromOwner('LockZap', 'setPriceProvider', priceProvider.address);

	// TODO: failing on BSC, prob upgrade slot issue
	// await execute('LiquidityZap', 'setPriceProvider', priceProvider.address);
});
export default func;
