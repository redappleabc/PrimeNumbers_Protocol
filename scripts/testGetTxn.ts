import {ethers} from 'hardhat';
import {getConfigForChain} from '../config';
import HardhatDeployConfig from '../config/31337';
import {LendingPool} from '../typechain';
import fs from 'fs';

const hre = require('hardhat');

(async () => {
	// block 76387897
	const mfdTxn = '0x943f8006ae59a91a19a2a47ab150f0ee39aa12e6e85e3d13de3630aff7522da6';
	const otherTxn = '0xb1fdbe7ee40736f0f648b938dacbce3cddcf5dc7b47420c4d209230e1c481ff7';
	const tx = await hre.ethers.provider.getTransaction(mfdTxn);
	console.log(tx);
})();
