import {ethers} from 'hardhat';
import {DeployStep} from '../../scripts/deploy/depfunc';

let step = new DeployStep({
	id: 'disable_market_pause',
	requireTags: ['lending'],
	runOnce: true,
});
let func = step.setFunction(async function () {
	const {signer} = step;

	// TODO: better way to handle this proxy
	let lendingPoolAddressesProvider = await ethers.getContract('LendingPoolAddressesProvider');
	let LendingPoolConfiguratorImpl = await ethers.getContractFactory('LendingPoolConfigurator');
	const lendingPoolConfiguratorProxy = LendingPoolConfiguratorImpl.attach(
		await lendingPoolAddressesProvider.getLendingPoolConfigurator()
	);
	await (await lendingPoolConfiguratorProxy.connect(signer).setPoolPause(false)).wait();
});
export default func;
