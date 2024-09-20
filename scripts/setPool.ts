const hre = require('hardhat');
const {deployments, getNamedAccounts, network} = hre;

(async () => {
	const {get, execute, read} = deployments;
	const {deployer} = await getNamedAccounts();

	let owner = await read('PriceProvider', 'owner');
	await execute('PriceProvider', {from: owner, log: true}, 'setUsePool', true);
})();
