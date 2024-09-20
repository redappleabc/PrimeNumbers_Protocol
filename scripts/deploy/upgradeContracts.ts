const hre = require('hardhat');
import {ethers} from 'hardhat';
const {deployments, getNamedAccounts, network} = hre;
import {getTxnOpts} from './helpers/getTxnOpts';
import {BountyManager, ChefIncentivesController, Leverager, LockZap, MiddleFeeDistribution} from '../../typechain';
import {Contract} from 'ethers';
import {assert} from 'console';
import ArbitrumConfig from '../../config/42161';
import {node_url} from '../../utils/network';

const proxyAbi = [
	{
		inputs: [
			{internalType: 'contract TransparentUpgradeableProxy', name: 'proxy', type: 'address'},
			{internalType: 'address', name: 'implementation', type: 'address'},
		],
		name: 'upgrade',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
];

enum Network {
	arbitrum = 0,
	bsc = 1,
}

interface ContractToUpgrade {
	contractName: string;
	admin: string;
	proxyAdmin: Contract;
}

(async () => {
	const {deploy, execute, read, get} = deployments;
	const txnOpts = await getTxnOpts(hre);
	const {deployer, dao, admin} = await getNamedAccounts();
	const network: Network = Network.arbitrum;
	const aaveOracle = await get('AaveOracle');

	// get .env value ETH_NODE_URI_ARBITRUM

	const provider = new ethers.providers.JsonRpcProvider(node_url('arbitrum'));

	const richGuy = '0x490b1e689ca23be864e55b46bf038e007b528208';
	const testUser = '0x53d7267FeC9F16233564efe01D69fd163CA2d96E';

	console.log('---RESETTING NODE---');
	await provider.send('hardhat_reset', [
		{
			forking: {
				jsonRpcUrl:
					'https://black-autumn-bush.arbitrum-mainnet.quiknode.pro/378c9248c6a64af89c198dff184e09664f56f7c7/',
				blockNumber: 130980338,
			},
		},
	]);
	// Wait for hardhat node to reset
	await new Promise((resolve) => setTimeout(resolve, 15000));

	console.log('---SETTING INTERVAL MINING---');
	await provider.send('evm_setIntervalMining', [5000]);

	// Wait for hardhat commands to finish
	await new Promise((resolve) => setTimeout(resolve, 10000));

	console.log('---FUND DEPLOYING ADDRESSES---');
	await provider.send('hardhat_impersonateAccount', [richGuy]);
	const defaultSigner = await provider.getSigner(richGuy);
	// Make sure the admin has some ETH to pay for transactions
	await defaultSigner.sendTransaction({
		to: deployer,
		value: hre.ethers.utils.parseEther('10'),
	});

	await defaultSigner.sendTransaction({
		to: dao,
		value: hre.ethers.utils.parseEther('10'),
	});

	await defaultSigner.sendTransaction({
		to: testUser,
		value: hre.ethers.utils.parseEther('100'),
	});
	// Wait for hardhat commands to finish
	await new Promise((resolve) => setTimeout(resolve, 10000));

	console.log('---UPGRADING CONTRACTS---');
	await provider.send('hardhat_impersonateAccount', [deployer]);
	// get the main proxy admin contract (is used for most contracts)
	const proxyAdminContract = await ethers.getContract('DefaultProxyAdmin');

	let contractsToUpgrade: ContractToUpgrade[] = [];
	if (network == Network.arbitrum) {
		contractsToUpgrade = [
			{contractName: 'BalancerPoolHelper', admin: deployer, proxyAdmin: proxyAdminContract},
			{contractName: 'BountyManager', admin: deployer, proxyAdmin: proxyAdminContract},
			{contractName: 'Compounder', admin: deployer, proxyAdmin: proxyAdminContract},
			{
				contractName: 'ChainlinkV3Adapter',
				admin: admin,
				proxyAdmin: await ethers.getContractAt(proxyAbi, '0x2d0E5168A8E3Fe90dB9f0Ae264272b3Aeb9AAe91'),
			},
			{contractName: 'ChefIncentivesController', admin: deployer, proxyAdmin: proxyAdminContract},
			{contractName: 'EligibilityDataProvider', admin: deployer, proxyAdmin: proxyAdminContract},
			{contractName: 'LockZap', admin: deployer, proxyAdmin: proxyAdminContract},
			{contractName: 'Leverager', admin: deployer, proxyAdmin: proxyAdminContract},
			{contractName: 'MiddleFeeDistribution', admin: deployer, proxyAdmin: proxyAdminContract},
			{contractName: 'MultiFeeDistribution', admin: deployer, proxyAdmin: proxyAdminContract},
			{contractName: 'PriceProvider', admin: deployer, proxyAdmin: proxyAdminContract},
			{contractName: 'StargateBorrow', admin: deployer, proxyAdmin: proxyAdminContract},
			{contractName: 'WSTETHOracle', admin: deployer, proxyAdmin: proxyAdminContract},
			// "LiquidityZap", // Not utilized on Arbitrum
		];
	} else if (network == Network.bsc) {
	}

	// Upgrade each contract
	for (let i = 0; i < contractsToUpgrade.length; i++) {
		let proxyAddress: string;
		const contractAdmin = contractsToUpgrade[i].admin;
		const contractToUpgrade = contractsToUpgrade[i].contractName;
		const proxyAdmin = contractsToUpgrade[i].proxyAdmin;
		if (contractToUpgrade == 'MultiFeeDistribution') {
			proxyAddress = (await ethers.getContract('MFD_Proxy')).address;
		} else if (contractToUpgrade == 'BalancerPoolHelper') {
			proxyAddress = (await ethers.getContract('PoolHelper_Proxy')).address;
		} else {
			proxyAddress = (await ethers.getContract(contractToUpgrade + '_Proxy')).address;
		}

		//Deploy implementation
		let implementationAddress = '';
		console.log('Deploying: ', contractToUpgrade);
		const implementationFactory = await ethers.getContractFactory(contractToUpgrade);
		implementationAddress = (await implementationFactory.deploy()).address;

		// Impersonate Owner
		const mfd_proxy = await ethers.getContractAt(contractToUpgrade, proxyAddress);
		const ownerBeforeUpgrade = await mfd_proxy.owner();
		await provider.send('hardhat_impersonateAccount', [contractAdmin]);
		const contractAdminSigner = await ethers.getSigner(contractAdmin);
		//Some contracts have a different owner...
		const alternateOwnerSigner = await ethers.getSigner(dao);

		//save the last storage state
		const previousState = await fetchLastStorageVariable(network, contractToUpgrade, mfd_proxy);

		// Upgrade proxy
		await proxyAdmin.connect(contractAdminSigner).upgrade(proxyAddress, implementationAddress);
		const ownerAfterUpgrade = await mfd_proxy.owner();
		assert(ownerBeforeUpgrade == ownerAfterUpgrade, 'Contract owner changed after upgrade');

		// Configure (if needed)
		if (contractToUpgrade == 'MiddleFeeDistribution') {
			const mfdProxy: MiddleFeeDistribution = (await ethers.getContractAt(
				'MiddleFeeDistribution',
				proxyAddress
			)) as MiddleFeeDistribution;
			await provider.send('hardhat_impersonateAccount', [dao]);
			const daoSigner = await ethers.getSigner(dao);
			const dataProviderAddress = (await ethers.getContract('AaveProtocolDataProvider')).address;
			await mfdProxy.connect(daoSigner).setProtocolDataProvider(dataProviderAddress);
		}
		if (contractToUpgrade == 'LockZap') {
			// LockZap utilizes the UniswapPoolHelper which needs to be deployed on Arbitrum
			const lockZapProxy: LockZap = (await ethers.getContractAt('LockZap', proxyAddress)) as LockZap;
			await provider.send('hardhat_impersonateAccount', [dao]);
			await lockZapProxy.connect(alternateOwnerSigner).setUniRouter(ArbitrumConfig.ROUTER_ADDR);
			await lockZapProxy.connect(alternateOwnerSigner).setAaveOracle(aaveOracle.address);
		}
		if (contractToUpgrade == 'Leverager') {
			const leveragerProxy: Leverager = (await ethers.getContractAt('Leverager', proxyAddress)) as Leverager;
			await provider.send('hardhat_impersonateAccount', [dao]);
			const cicProxy: ChefIncentivesController = (await ethers.getContractAt(
				'ChefIncentivesController',
				(
					await ethers.getContract('ChefIncentivesController')
				).address
			)) as ChefIncentivesController;
			await leveragerProxy.connect(contractAdminSigner).setChefIncentivesController(cicProxy.address);
			await cicProxy.connect(alternateOwnerSigner).setLeverager(leveragerProxy.address);
		}
		if (contractToUpgrade == 'BountyManager') {
			const bountyProxy: BountyManager = (await ethers.getContractAt(
				'BountyManager',
				proxyAddress
			)) as BountyManager;
			await provider.send('hardhat_impersonateAccount', [dao]);
			await bountyProxy.connect(alternateOwnerSigner).setBounties();
		}

		// Ensure no storage shifts have occurred
		const newState = await fetchLastStorageVariable(network, contractToUpgrade, mfd_proxy);
		assert(previousState === newState, 'Storage state changed after upgrade');
		await provider.send('hardhat_impersonateAccount', [dao]);
	}
})();

// We append to the contract owner address to the last storage variable to increase the chance of catching any storage shifts
async function fetchLastStorageVariable(network: Network, contractToUpgrade: string, proxy: any) {
	if (network == Network.arbitrum) {
		if (contractToUpgrade === 'BalancerPoolHelper') {
			return (await proxy.poolFactory()).toString() + (await proxy.owner()).toString();
		} else if (contractToUpgrade === 'BountyManager') {
			return (await proxy.whitelistActive()).toString() + (await proxy.owner()).toString();
		} else if (contractToUpgrade === 'Compounder') {
			return (
				(await proxy.rewardToBaseRoute('0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', 1)).toString() +
				(await proxy.owner()).toString()
			);
		} else if (contractToUpgrade === 'ChainlinkV3Adapter') {
			return (await proxy.tokenLatestTimestamp()).toString() + (await proxy.owner()).toString();
		} else if (contractToUpgrade === 'ChefIncentivesController') {
			return (await proxy.bountyManager()).toString() + (await proxy.owner()).toString();
		} else if (contractToUpgrade === 'EligibilityDataProvider') {
			return (
				(await proxy.lastEligibleStatus('0x2FE7827532FA9E353f217988A37504A2cb9919E5')).toString() +
				(await proxy.owner()).toString()
			);
		} else if (contractToUpgrade === 'Leverager') {
			return (await proxy.treasury()).toString() + (await proxy.owner()).toString();
		} else if (contractToUpgrade === 'LockZap') {
			return (await proxy.ethLPRatio()).toString() + (await proxy.owner()).toString();
		} else if (contractToUpgrade === 'MiddleFeeDistribution') {
			return (await proxy.admin()).toString() + (await proxy.owner()).toString();
		} else if (contractToUpgrade === 'MultiFeeDistribution') {
			return (await proxy.bountyManager()).toString() + (await proxy.owner()).toString();
		} else if (contractToUpgrade === 'PriceProvider') {
			return (await proxy.oracle()).toString() + (await proxy.owner()).toString();
		} else if (contractToUpgrade === 'StargateBorrow') {
			return (await proxy.xChainBorrowFeePercent()).toString() + (await proxy.owner()).toString();
		} else if (contractToUpgrade === 'StargateBorrow') {
			return (await proxy.stEthPerWstETHOracle()).toString() + (await proxy.owner()).toString();
		}
		return '0';
	}
}
