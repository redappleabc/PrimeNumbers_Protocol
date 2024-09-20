import {ethers} from 'hardhat';
import {DeployStep} from '../../scripts/deploy/depfunc';
import {LP_PROVIDER} from '../../scripts/deploy/types';
import { getInitLpAmts } from '../../scripts/deploy/helpers/getInitLpAmts';

let step = new DeployStep({
	id: 'configure_lp',
	requireTags: ['lp'],
	dependencies: ['weth'],
	runOnce: true,
});
let func = step.setFunction(async function () {
	const {read, config, network, weth, execute, deployer, baseAssetWrapped} = step;
	const chainId = await hre.getChainId();
	let LP_INIT_ETH = config.LP_INIT_ETH;
	let LP_INIT_PRNT = config.LP_INIT_PRNT;
	if (chainId == '97') {
		let init_eth = 1;
		let init_prnt = getInitLpAmts(config.LP_PROVIDER, init_eth, 500, 9.1);
		LP_INIT_ETH = ethers.utils.parseUnits(init_eth.toString(), 18);
		LP_INIT_PRNT = ethers.utils.parseUnits(init_prnt.toString(), 18);
	}


	const poolHelper = await deployments.get('PoolHelper');
	const primeToken = await deployments.get('PrimeToken');

	let signer = await ethers.getSigner(deployer);
	let useUniswapLpProvider = config.LP_PROVIDER === LP_PROVIDER.UNISWAP;
	const poolHelperInitialized =
		(await read('PoolHelper', 'lpTokenAddr')) != '0x0000000000000000000000000000000000000000';

	// TODO: deduplicate logic, clean up
	if (!poolHelperInitialized) {
		if (useUniswapLpProvider) {
			// console.log(`WETH bal dep: ${deployer} | ${await weth.balanceOf(deployer)}`);
			// console.log(`WETH transfer: ${poolHelper.address} | ${config.LP_INIT_ETH}`);
			// await weth.connect(signer).deposit(config.LP_INIT_ETH);

			if (network.tags.mocks) {
				await execute(baseAssetWrapped, 'mint', LP_INIT_ETH);
				await execute(baseAssetWrapped, 'transfer', poolHelper.address, LP_INIT_ETH);
			} else {
				// TODO: if not enough WETH/WBNB, deposit
				const signerBalance = await weth.balanceOf(signer.address);
				if (signerBalance.lt(LP_INIT_ETH)) {
					await (await weth.connect(signer).deposit({
						value: LP_INIT_ETH,
					})).wait();
				}
				await (await weth.connect(signer).transfer(poolHelper.address, LP_INIT_ETH)).wait();
			}

			// console.log(`WETH bal dep post: ${deployer} | ${await weth.balanceOf(deployer)}`);

			await execute('PrimeToken', 'transfer', poolHelper.address, LP_INIT_PRNT);

			// console.log(await weth.balanceOf(poolHelper.address));
			// console.log(await read('PrimeToken', 'balanceOf', poolHelper.address));

			await execute('PoolHelper', 'initializePool');

			const lpTokenAddr = await read('PoolHelper', 'lpTokenAddr');
			await execute(
				'LiquidityZap',
				'initLiquidityZap',
				primeToken.address,
				weth.address,
				lpTokenAddr,
				poolHelper.address
			);
			await execute('LiquidityZap', 'setAcceptableRatio', config.ZAP_SLIPPAGE_LIMIT);
		} else {
			console.log(`WETH bal dep: ${deployer} | ${await weth.balanceOf(deployer)}`);
			console.log(`WETH transfer: ${poolHelper.address} | ${LP_INIT_ETH}`);
			// await weth.connect(signer).deposit(config.LP_INIT_ETH);
			if (network.tags.mocks) {
				await execute(baseAssetWrapped, 'mint', LP_INIT_ETH);
			} else {
				await weth.connect(signer).deposit({
					value: LP_INIT_ETH,
				});
			}

			console.log(`WETH bal dep post: ${deployer} | ${await weth.balanceOf(deployer)}`);

			await weth.connect(signer).transfer(poolHelper.address, LP_INIT_ETH);
			await execute('PrimeToken', 'transfer', poolHelper.address, LP_INIT_PRNT);

			console.log(await weth.balanceOf(poolHelper.address));
			console.log(await read('PrimeToken', 'balanceOf', poolHelper.address));

			await execute('PoolHelper', 'initializePool', 'PRNT-WETH', 'PRNT-WETH');
		}
	}
});
export default func;
