import {ethers} from 'hardhat';
import {getConfigForChain} from '../config';
import HardhatDeployConfig from '../config/31337';
import {AaveOracle, LendingPool} from '../typechain';
import fs from 'fs';

const hre = require('hardhat');

(async () => {
	const oracle = <AaveOracle>await ethers.getContract('AaveOracle');
	const asset = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8';

	const source = await oracle.getSourceOfAsset(asset);
	console.log(`source: ${source}`);
	const price = await oracle.getAssetPrice(asset);
	console.log(`price: ${price}`);
})();
