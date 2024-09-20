import {ethers} from 'hardhat';
import {DeployStep} from '../../scripts/deploy/depfunc';

let step = new DeployStep({
	id: 'deploy_token',
	requireTags: ['token'],
	dependencies: ['weth', 'uniswap', 'layerzero'],
});
let func = step.setFunction(async function () {
		const {deploy, config, network, dao, treasury, execute, executeFrom, deployer} = step;

	let lzEndpoint = config?.LZ_ENDPOINT;
	if (network.tags.mocks) {
		lzEndpoint = (await ethers.getContract('LZEndpointSrcMock')).address;
	}

	let prnt;

	if (network.tags.testing) {
		const FAUCET_AMOUNT = ethers.BigNumber.from("10").pow("18").mul("100");

		prnt = await deploy('MockPrimeToken', {
			args: [config?.TOKEN_NAME, config?.SYMBOL, lzEndpoint, dao, treasury, config?.MINT_AMT, FAUCET_AMOUNT],
		});
	} else {
		prnt = await deploy('PrimeToken', {
			args: [config?.TOKEN_NAME, config?.SYMBOL, lzEndpoint, dao, treasury, config?.MINT_AMT],
		});
	}

	let prntRequired = config.LP_INIT_PRNT.add(config.SUPPLY_CIC_RESERVE).add(config.SUPPLY_DQ_RESERVE);

	if (!!config.SUPPLY_MIGRATION_MINT) {
		prntRequired = prntRequired.add(config.SUPPLY_MIGRATION_MINT);
	}

	// console.log(`=== Deployer will need PRNT: `, ethers.utils.formatEther(prntRequired));
	// console.log(`Has: ${await read('PrimeToken', 'balanceOf', deployer)}`);
	// console.log(`DAO Has: ${await read('PrimeToken', 'balanceOf', dao)}`);

	if (prnt.newlyDeployed) {
		await execute('PrimeToken', 'setFeeRatio', config.FEE_BRIDGING);
		if (network.tags.testing && network.tags.impersonate) {
			await executeFrom('PrimeToken', dao, 'transfer', deployer, prntRequired);
		}
	}
});
export default func;
