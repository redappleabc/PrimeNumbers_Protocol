import {ethers} from 'hardhat';
import {getConfigForChain} from '../config';
import HardhatDeployConfig from '../config/31337';
import {AaveOracle, LendingPool, PriceProvider, UniswapPoolHelper} from '../typechain';
import fs from 'fs';

const hre = require('hardhat');

(async () => {
	const pp = <PriceProvider>await ethers.getContract('PriceProvider');
	const ph = <UniswapPoolHelper>await ethers.getContract('PoolHelper');

	console.log(await ph.lpTokenAddr());
	// console.log(await ph.);

	const tokenPrice = await pp.getTokenPriceUsd();
	console.log(`price: ${tokenPrice}`);

	const lpPrice = await pp.getLpTokenPriceUsd();
	console.log(`lpPrice: ${lpPrice}`);
})();
