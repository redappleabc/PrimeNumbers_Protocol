import 'dotenv/config';
import {HardhatUserConfig} from 'hardhat/types';
import 'hardhat-deploy';
import '@nomiclabs/hardhat-ethers';
import 'hardhat-deploy-ethers';
import 'hardhat-gas-reporter';
import '@typechain/hardhat';
import 'solidity-coverage';
import 'hardhat-contract-sizer';
import {node_url} from './utils/network';
import '@openzeppelin/hardhat-upgrades';
import '@openzeppelin/hardhat-defender';
import 'hardhat-deploy-tenderly';
import './tasks';
import '@nomiclabs/hardhat-web3';
import {generateCompilerOverrides} from './utils/compilerOverrides';
import 'hardhat-ignore-warnings';
import 'hardhat-storage-layout-changes';
import {without} from 'lodash';

// import * as tdly from '@tenderly/hardhat-tenderly';
// tdly.setup();

let optimizerRuns = parseInt(process.env.OPTIMIZER_RUNS || '1000');

enum TAGS {
	// for an existing chain where PRNT CL used, disable it and usePool
	BypassCL = 'bypass_chainlink',
	// (testing) massively fund the CIC
	FundCIC = 'fund_cic',
	// use hardhat impersonation
	Impersonate = 'impersonate',
	// deploy aave
	Lending = 'lending',
	// deploy & configure LP
	LP = 'lp',
	// Deploy mock assets
	Mocks = 'mocks',
	// use univ2 oracle for prnt price
	OracleV2 = 'oracle_v2',
	// use univ3 oracle for prnt price
	OracleV3 = 'oracle_v3',
	// use CL oracle for prnt price
	OracleCL = 'oracle_cl',
	// (arb) deploy post-deploy assets arb & wsteth
	PostAssets = 'post_assets',
	// deploy or upgrade all Prime contracts
	Prime = 'prime',
	// enable sequencer checks
	Sequencer = 'sequencer',
	// dont wait X confirmations after deploying a contract
	SkipConfirmations = 'skip_confirmations',
	// Make transfers in a non-prod environment, like deployer -> dao post-mint
	Testing = 'testing',
	// deploy OFT & related
	Token = 'token',
	// use CL Adapters that dont validate CL update time
	UnvalidatedCL = 'unvalidated_chainlink',
}

const freshDeployTagSet = [
	TAGS.Mocks,
	TAGS.Testing,
	TAGS.Token,
	TAGS.Lending,
	TAGS.LP,
	TAGS.Prime,
	TAGS.OracleV2,
	TAGS.PostAssets,
	TAGS.UnvalidatedCL,
];

const testnetDeployTagSet = [
	TAGS.Testing,
	TAGS.Token,
	TAGS.Lending,
	TAGS.LP,
	TAGS.Prime,
	TAGS.OracleV2,
	TAGS.UnvalidatedCL,
];

const testSuiteTagSet = [...freshDeployTagSet, TAGS.Impersonate];
const upgradeTagSet = [TAGS.Prime, TAGS.OracleCL, TAGS.LP, TAGS.UnvalidatedCL];
const prodUpgradeTagSet = without(upgradeTagSet, TAGS.UnvalidatedCL);

const config: HardhatUserConfig = {
	namedAccounts: {
		deployer: {
			default: 0,
			1: '0x53d7267FeC9F16233564efe01D69fd163CA2d96E',
			97: '0xdE8023f05d831Fb7381486D041237ddEB06c1BA2',
			56: '0x225c6084086F83eCe4BC747403f292a7d324Fd2E',
			42161: '0x7759124915160e94c77ece5b96e8a7fcec44aa19',
		},
		dao: {
			default: 1,
			1: '0x53d7267FeC9F16233564efe01D69fd163CA2d96E',
			56: '0x23a06b7644405bE380ACC1be0Ff54eeBeEC69aEd',
			97: '0xdE8023f05d831Fb7381486D041237ddEB06c1BA2',
			42161: '0x111ceeee040739fd91d29c34c33e6b3e112f2177',
		},
		treasury: {
			default: 2,
			1: '0x53d7267FeC9F16233564efe01D69fd163CA2d96E',
			56: '0x769549Ab2765f2541FF6d5b6655B8bD36f99705E',
			97: '0xdE8023f05d831Fb7381486D041237ddEB06c1BA2',
			42161: '0x769549Ab2765f2541FF6d5b6655B8bD36f99705E',
		},
		admin: {
			default: 3,
			1: '0x53d7267FeC9F16233564efe01D69fd163CA2d96E',
			56: '0xE4714D6BD9a6c0F6194C1aa8602850b0a1cE1416',
			97: '0xdE8023f05d831Fb7381486D041237ddEB06c1BA2',
			42161: '0x091ffe38e101e8ac10832e74f059d1b33aefae99',
		},
		vestManager: {
			default: 4,
			1: '0x53d7267FeC9F16233564efe01D69fd163CA2d96E',
			56: '0xA90a20698ff30486A14B685eCdC0d86269C404EB',
			97: '0xdE8023f05d831Fb7381486D041237ddEB06c1BA2',
			42161: '0x1BAABe1e4128E76EdB1FF76EE528864e4772C17d',
		},
		starfleet: {
			default: 5,
			1: '0x53d7267FeC9F16233564efe01D69fd163CA2d96E',
			56: '0x99c57C94A5242237009B215F8a92dc7867a6ac7b',
			97: '0xdE8023f05d831Fb7381486D041237ddEB06c1BA2',
			42161: '0x5ea8c86d3e99412b856b800a035d8cfcab6f1589',
		},
		reserve: {
			default: 6,
			1: '0x53d7267FeC9F16233564efe01D69fd163CA2d96E',
			56: '0x769549Ab2765f2541FF6d5b6655B8bD36f99705E',
			97: '0xdE8023f05d831Fb7381486D041237ddEB06c1BA2',
			42161: '0x9d9e4a95765154a575555039e9e2a321256b5704',
		},
	},
	networks: {
		hardhat: {
			// chainId: 1,
			allowUnlimitedContractSize: false,
			autoImpersonate: true,
			initialBaseFeePerGas: 0,
			gasPrice: 0,
			// forking: {
			// url: node_url('arbitrum'),
			// blockNumber: 101749742,
			// },
			blockGasLimit: 30000000000000,
			tags: testSuiteTagSet,
		},
		localhost: {
			url: node_url('localhost'),
			autoImpersonate: true,
			timeout: 10000000000000,
			accounts: 'remote',
			// chainId: 42161,
			// tags: testSuiteTagSet,
			tags: [...upgradeTagSet, TAGS.Impersonate],
			// tags: [
			// 	...without(freshDeployTagSet, TAGS.OracleV2),
			// 	TAGS.OracleCL,
			// 	TAGS.Impersonate,
			// 	TAGS.SkipConfirmations,
			// 	TAGS.BypassCL,
			// ],
		},
		mainnet: {
			url: 'https://eth-mainnet.g.alchemy.com/v2/ss02Kd8vJ0Y_vmiGBO28_wOER1_F3YY2',
			accounts: [process.env.PRIVATE_KEY_MAINNET!],
		},
		tenderly_mainnet: {
			url: 'https://rpc.tenderly.co/fork/8e995eb0-accf-4247-a46a-c3141491e50f/',
			accounts: process.env.PRIVATE_KEY_MAINNET ? [process.env.PRIVATE_KEY_MAINNET] : [],
			tags: [...without(freshDeployTagSet, TAGS.OracleV2), TAGS.SkipConfirmations, TAGS.OracleCL, TAGS.BypassCL],
		},
		tenderly_arbitrum: {
			url: 'https://rpc.tenderly.co/fork/36fd592b-855d-417b-9657-ab735250e5dc/',
			autoImpersonate: true,
			accounts: 'remote',
			tags: [...upgradeTagSet, TAGS.SkipConfirmations],
		},
		tenderly_bsc: {
			url: 'https://rpc.tenderly.co/fork/0c6ecb34-ded3-4219-9d56-b0e0f7db56d8/',
			autoImpersonate: true,
			accounts: 'remote',
			tags: [...upgradeTagSet, TAGS.LP, TAGS.SkipConfirmations],
		},
		bsc: {
			url: node_url('bsc'),
			accounts: [process.env.PRIVATE_KEY_BSC || ''],
			tags: [...prodUpgradeTagSet, TAGS.LP],
		},
		bsc_testnet: {
			url: 'https://data-seed-prebsc-2-s1.binance.org:8545/',
			accounts: [process.env.PRIVATE_KEY_BSC_TESTNET!],
			tags: [...testnetDeployTagSet],
		},
		arbitrum: {
			url: node_url('arbitrum'),
			accounts: 'remote',
			verify: {
				etherscan: {
					apiKey: process.env.ETHERSCAN_API_KEY || '',
					apiUrl: 'https://api.arbiscan.io/',
				},
			},
			tags: [...prodUpgradeTagSet, TAGS.LP, TAGS.Sequencer],
		},
	},
	etherscan: {
		// Your API key for Etherscan
		// Obtain one at https://bscscan.com/
		apiKey: process.env.BSC_API_KEY,
	},
	solidity: {
		compilers: [
			{
				version: '0.8.19', // For LayerZero and Stargate contracts
				settings: {
					optimizer: {
						enabled: true,
						runs: 200,
					},
				},
			},
			{
				version: '0.8.12', // For contracts requiring Solidity 0.8.12
				settings: {
					optimizer: {
						enabled: true,
						runs: 200,
					},
				},
			},
			{
				version: '0.6.6', // For Uniswap contracts
				settings: {
					optimizer: {
						enabled: true,
						runs: 200,
					},
				},
			},
		],
		overrides: {
			
			// Override for Stargate contracts that require Solidity 0.8.12
			'@stargatefinance/stg-evm-v2/src/**/*.sol': {
				version: '0.8.12',
				settings: {
					optimizer: {
						enabled: true,
						runs: 1000,
					},
				},
			},
		},
	},
	paths: {
		sources: 'contracts',
		storageLayouts: '.storage-layouts',
	},
	storageLayoutConfig: {
		fullPath: false,
	},
	gasReporter: {
		currency: 'USD',
		gasPrice: 100,
		enabled: !!process.env.REPORT_GAS,
		coinmarketcap: process.env.COINMARKETCAP_API_KEY,
		maxMethodDiff: 10,
	},
	typechain: {
		outDir: 'typechain',
		target: 'ethers-v5',
	},
	mocha: {
		timeout: 1000000,
		bail: true,
	},
	external: process.env.HARDHAT_FORK
		? {
				deployments: {
					// process.env.HARDHAT_FORK will specify the network that the fork is made from.
					// these lines allow it to fetch the deployments from the network being forked from both for node and deploy task
					hardhat: ['deployments/' + process.env.HARDHAT_FORK],
					localhost: ['deployments/' + process.env.HARDHAT_FORK],
				},
		  }
		: undefined,

	tenderly: {
		// url: 'https://rpc.tenderly.co/fork/c21e99d1-e278-4765-9626-d9596f5297f7/',
		// forkId: 'bd9ac0f3-b240-43d3-90e1-6b2c810d69ca',
		username: process.env.TENDERLY_USERNAME || '',
		project: process.env.TENDERLY_PROJECT || '',
		privateVerification: false,
	},
	defender: {
		apiKey: process.env.DEFENDER_API_KEY || '',
		apiSecret: process.env.DEFENDER_API_SECRET || '',
	},
	warnings: {
		'contracts/dependencies/math/**/*': {
			default: 'off',
		},
		'contracts/dependencies/uniswap/contracts/**/*': {
			default: 'off',
		},
		'contracts/dependencies/openzeppelin/**/*': {
			default: 'off',
		},
		'contracts/lending/**/*': {
			default: 'off',
		},
		'@uniswap/v2-core/contracts/**/*': {
			default: 'off',
		},
	},
};

if (process.env.IS_CI === 'true') {
	if (config && config !== undefined) {
		if (config.hasOwnProperty('mocha') && config.mocha !== undefined) {
			config.mocha.reporter = 'json';
			config.mocha.reporterOptions = {
				output: 'test-results.json',
			};
		}
	}
}
export default config;
