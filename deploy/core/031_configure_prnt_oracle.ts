import {DeployStep} from '../../scripts/deploy/depfunc';

let step = new DeployStep({
	id: 'configure_prnt_oracle',
	requireTags: ['prime'],
	runOnce: true,
});
let func = step.setFunction(async function () {
	const {get, execute, read, executeFrom} = step;

	let oracle;
	if (network.tags.oracle_v3) {
		oracle = await get('UniV3TwapOracle');
	} else if (network.tags.oracle_v2) {
		oracle = await get('UniV2TwapOracle');
	} else {
		oracle = await get('PrimeChainlinkOracle');
	}

	let owner = await read('LockZap', 'owner');
	await executeFrom('PriceProvider', owner, 'setUsePool', false);
	await executeFrom('PriceProvider', owner, 'setOracle', oracle.address);

	if (network.tags.oracle_v2) {
		await execute('UniV2TwapOracle', 'update');
	}
});
export default func;
