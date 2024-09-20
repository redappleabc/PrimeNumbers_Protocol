import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import { getTxnOpts } from '../../scripts/deploy/helpers/getTxnOpts';
import fs, { readFileSync } from 'fs';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
	const {deployments} = hre;
	const {deploy} = deployments;
	const txnOpts = await getTxnOpts(hre);
	const contractName = 'LockerList';

	await deploy(contractName, txnOpts);

	return true;
};
export default func;
func.id = 'locker_list';
func.tags = ['locker_list'];
