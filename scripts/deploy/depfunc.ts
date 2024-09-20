import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {getTxnOpts} from './helpers/getTxnOpts';
import {getConfigForChain} from '../../config';
import {DeployConfig} from './types';
import {getWeth} from '../getDepenencies';
import {Contract} from 'ethers';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';

export class DeployStep {
	id: string;
	deploy: any;
	provider: any;
	tags: string[] | undefined;
	requireTags: string[] | undefined;
	config: DeployConfig | undefined;
	dependencies: string[] | undefined;
	dao: string | undefined;
	reserve: string | undefined;
	deployer: string | undefined;
	treasury: string | undefined;
	baseAssetWrapped: string;
	network: any;
	weth: any;
	deployments: any;
	signer: SignerWithAddress;
	baseAssetPrice: number;
	read: (name: string, funcName: string, args?: any[]) => Promise<string>;
	getContract: any;
	execute: any;
	executeFrom: any;
	executeFromOwner: any;
	get: any;
	runOnce: boolean;
	chainlinkEthUsd: string;
	admin: string;
	vestManager: string;
	starfleet: string;

	constructor(options: {
		id: string;
		tags?: string[];
		requireTags?: string[];
		dependencies?: string[];
		runOnce?: boolean;
	}) {
		this.id = options.id;
		this.tags = options.tags || [];
		this.requireTags = options.requireTags || [];
		this.tags?.push(this.id);
		this.dependencies = options.dependencies || [];
		this.runOnce = options.runOnce || false;
		if (this.id !== 'weth') {
			this.dependencies.push('weth');
		}
	}

	setFunction(func: Function) {
		let func2: DeployFunction = async (hre: HardhatRuntimeEnvironment): Promise<boolean | void> => {
			const {deployments, getNamedAccounts, network} = hre;

			console.log(` `);
			if (this.requireTags?.length) {
				let requirementsMet = true;
				for (const req of this.requireTags) {
					if (!network.tags[req]) {
						requirementsMet = false;
					}
				}
				if (!requirementsMet) {
					console.log(`- skipping ${this.id} -`);
					return;
				}
			}
			console.log(`--- ${this.id} ---`);

			this.provider = hre.ethers.provider;
			const {deploy, execute, read, get, catchUnknownSigner} = deployments;
			const {deployer, dao, treasury, admin, vestManager, starfleet, reserve} = await getNamedAccounts();
			const txnOpts = await getTxnOpts(hre);
			const {config} = getConfigForChain(await hre.getChainId());
			const {baseAssetWrapped} = getConfigForChain(await hre.getChainId());
			this.baseAssetWrapped = baseAssetWrapped;
			this.baseAssetPrice = baseAssetWrapped === 'WBNB' ? 300 : 2100;

			if (this.id !== 'weth') {
				this.weth = (await getWeth(hre)).weth;
				this.chainlinkEthUsd = (await getWeth(hre)).chainlinkEthUsd;
			}

			this.deployments = deployments;
			this.config = config;
			this.deployer = deployer;
			this.dao = dao;
			this.admin = admin;
			this.reserve = reserve;
			this.vestManager = vestManager;
			this.starfleet = starfleet;
			this.treasury = treasury;
			this.network = network;
			this.deploy = async function (name: string, opts: any) {
				const deployResult = (await deploy(name, {
					...txnOpts,
					...opts,
				}));
				const deployedContract = await get(name);
				console.log(`Address of ${name} is: ${deployedContract.address}`)
				return deployResult;
			};
			this.execute = async function (name: string, funcName: string, ...args: any[]) {
				const tx = (await execute(name, txnOpts, funcName, ...args));
				const deployedContract = await get(name);
				console.log(`Address of ${name} is: ${deployedContract.address}`)
				return tx;
			};
			this.executeFrom = async (name: string, from: string, funcName: string, ...args: any[]) => {
				let opts = txnOpts;
				opts.from = from;
				if (network.tags.impersonate) {
					await this.provider.send('hardhat_impersonateAccount', [from]);
				}
				const tx = (await execute(name, opts, funcName, ...args));
				const deployedContract = await get(name);
				console.log(`Address of ${name} is: ${deployedContract.address}`)
				return tx;
			};
			this.executeFromOwner = async (name: string, funcName: string, ...args: any[]) => {
				let opts = txnOpts;
				let from = await read(name, 'owner');
				opts.from = from;
				if (network.tags.impersonate) {
					await this.provider.send('hardhat_impersonateAccount', [from]);
				}
				const tx = (await execute(name, opts, funcName, ...args));
				const deployedContract = await get(name);
				console.log(`Address of ${name} is: ${deployedContract.address}`)
				return tx;
			};
			this.read = async function (name: string, funcName: string, ...args: any[]) {
				return (await read(name, funcName, ...args));
			};
			this.get = async function (name: string) {
				return (await get(name));
			};
			this.getContract = async function (name: string): Promise<Contract> {
				let deployment = await get(name);
				return (await hre.ethers.getContractAt(name, deployment.address));
			};

			if (network.tags.impersonate) {
				await hre.network.provider.request({
					method: 'hardhat_impersonateAccount',
					params: [deployer],
				});
				this.signer = await hre.ethers.getSigner(deployer);
			} else {
				this.signer = (await hre.ethers.getSigners())[0];
			}

			if (network.tags.impersonate) {
				await this.provider.send('hardhat_impersonateAccount', [deployer]);
			}

			await func();

			if (this.runOnce) {
				return true;
			}
		};

		func2.id = this.id;
		func2.tags = this.tags;
		func2.dependencies = this.dependencies;

		return func2;
	}
}
