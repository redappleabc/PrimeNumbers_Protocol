const hre = require('hardhat');
const {deployments, getNamedAccounts, network} = hre;

(async () => {
	const {get, execute} = deployments;
	const {deployer} = await getNamedAccounts();
	const pp = await get('PriceProvider');
	await execute('PrimeToken', {from: deployer, log: true}, 'setFeeRatio', '50');
	await execute('PrimeToken', {from: deployer, log: true}, 'setPriceProvider', pp.address);
})();
