import {ethers} from 'hardhat';
import {DeployStep} from '../../scripts/deploy/depfunc';
import {Console} from 'console';

let step = new DeployStep({
	id: 'configure_lending',
	requireTags: ['lending'],
	runOnce: true,
});
let func = step.setFunction(async function () {
	const {get, read, treasury, execute, deployer, getContract, provider, network, signer} = step;

	const lendingPoolAddressesProviderRegistry = await getContract('LendingPoolAddressesProviderRegistry');
	const lendingPoolAddressesProvider = await getContract('LendingPoolAddressesProvider');
	const configurator = await ethers.getContract('LendingPoolConfigurator');
	const lendingPool = await get('LendingPool');

	// Set the provider at the Registry
	await (
		await lendingPoolAddressesProviderRegistry
			.connect(signer)
			.registerAddressesProvider(lendingPoolAddressesProvider.address, '1')
	).wait();

	// let r1 = await lendingPoolAddressesProvider.getPoolAdmin();
	// await execute('LendingPoolAddressesProvider', 'setPoolAdmin', deployer);
	// await execute('LendingPoolAddressesProvider', 'setEmergencyAdmin', deployer);
	// await execute('LendingPoolAddressesProvider', 'setLiquidationFeeTo', treasury);
	// Set pool admins
	await (await lendingPoolAddressesProvider.connect(signer).setPoolAdmin(deployer)).wait();
	await (await lendingPoolAddressesProvider.connect(signer).setEmergencyAdmin(deployer)).wait();
	await (await lendingPoolAddressesProvider.connect(signer).setLiquidationFeeTo(treasury)).wait();

	await execute('LendingPool', 'initialize', lendingPoolAddressesProvider.address);
	// await execute('LendingPoolConfigurator', 'initialize', lendingPoolAddressesProvider.address);

	// await execute('LendingPoolAddressesProvider', 'setLendingPoolImpl', lendingPool.address);
	// await execute('LendingPoolAddressesProvider', 'setLendingPoolConfiguratorImpl', configurator.address);

	await (await lendingPoolAddressesProvider.connect(signer).setLendingPoolImpl(lendingPool.address)).wait();
	await (
		await lendingPoolAddressesProvider.connect(signer).setLendingPoolConfiguratorImpl(configurator.address)
	).wait();

	// // LendingPoolConfigurator (InitializableImmutableAdminUpgradeabilityProxy)
	const lendingPoolConfiguratorProxy = configurator.attach(
		await lendingPoolAddressesProvider.getLendingPoolConfigurator()
	);

	await (await lendingPoolConfiguratorProxy.connect(signer).setPoolPause(true)).wait();

	const pool = await read('LendingPoolAddressesProvider', 'getLendingPool');
	await execute('WETHGateway', 'authorizeLendingPool', pool);
});
export default func;
