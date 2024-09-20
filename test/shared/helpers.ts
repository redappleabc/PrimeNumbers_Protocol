/* eslint-disable no-await-in-loop */
import {BigNumber, BigNumberish} from 'ethers';
import hre, {ethers} from 'hardhat';
import {DeployConfigOverride, DeployData} from '../../scripts/deploy/types';
import {
	AToken,
	ChefIncentivesController,
	LendingPool,
	MockToken,
	MultiFeeDistribution,
	PriceProvider,
	PrimeToken,
	TestnetLockZap,
	VariableDebtToken,
	WBNB,
	WETH,
} from '../../typechain';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {MINUTE} from '../../config/constants';

export async function mineBlock(): Promise<void> {
	await hre.network.provider.request({
		method: 'evm_mine',
	});
}

export async function setNextBlockTimestamp(timestamp: number): Promise<void> {
	await hre.network.provider.request({
		method: 'evm_setNextBlockTimestamp',
		params: [timestamp],
	});
}

export async function getLatestBlockTimestamp(): Promise<number> {
	return (await ethers.provider.getBlock('latest')).timestamp;
}

export async function getTimeForBlock(blockNum): Promise<number> {
	return (await ethers.provider.getBlock(blockNum)).timestamp;
}

export async function mineBlockTo(blockNumber: number): Promise<void> {
	for (let i = await ethers.provider.getBlockNumber(); i < blockNumber; i += 1) {
		await mineBlock();
	}
}

export async function latest(): Promise<BigNumber> {
	const block = await ethers.provider.getBlock('latest');
	return BigNumber.from(block.timestamp);
}

export async function advanceTime(time: number): Promise<void> {
	await ethers.provider.send('evm_increaseTime', [time]);
}

export async function advanceTimeAndBlock(time: number): Promise<void> {
	await advanceTime(time);
	await mineBlock();
}

export const duration = {
	seconds(val: BigNumberish): BigNumber {
		return BigNumber.from(val);
	},
	minutes(val: BigNumberish): BigNumber {
		return BigNumber.from(val).mul(this.seconds('60'));
	},
	hours(val: BigNumberish): BigNumber {
		return BigNumber.from(val).mul(this.minutes('60'));
	},
	days(val: BigNumberish): BigNumber {
		return BigNumber.from(val).mul(this.hours('24'));
	},
	weeks(val: BigNumberish): BigNumber {
		return BigNumber.from(val).mul(this.days('7'));
	},
	years(val: BigNumberish): BigNumber {
		return BigNumber.from(val).mul(this.days('365'));
	},
};

// Defaults to e18 using amount * 10^18
export function getBigNumber(amount: BigNumberish, decimals = 18): BigNumber {
	return BigNumber.from(amount).mul(BigNumber.from(10).pow(decimals));
}

export const approxEqual = (
	val1: BigNumber,
	val2: BigNumber,
	threshold: number = 0.1,
	decimals: string = '1000000000000000000'
) => {
	let diff = val1.gt(val2) ? val1.sub(val2) : val2.sub(val1);
	let diff2 = diff.mul(10 ** 8).div(BigNumber.from(decimals));
	let diff3 = diff2.toNumber() / 10 ** 8;
	return diff3 <= threshold;
};

export const getUsdVal = (val: BigNumber, decis = 8) => {
	return ethers.utils.formatUnits(val.toString(), decis);
};

export const depositPrimeToCic = async (
	prnt: PrimeToken,
	user: SignerWithAddress,
	cic: ChefIncentivesController,
	amount: BigNumberish
) => {
	const currentBal = await prnt.balanceOf(user.address);
	await prnt.connect(user).approve(cic.address, amount);
	await cic.addRewards(user, currentBal);
};

export const getPrntBal = async (prnt: PrimeToken, user) => {
	return await prnt.balanceOf(user.address);
};

export const getTotalPendingRewards = async (address: string, chef: ChefIncentivesController) => {
	const pendingRewards = await chef.allPendingRewards(address);
	return pendingRewards;
};

export const getTotalRewards = async (address: string, chef: ChefIncentivesController) => {
	const pendingRewards = await chef.allPendingRewards(address);
	const base = await chef.userBaseClaimable(address);
	return pendingRewards.add(base);
};

export async function setAllocPoints(chef: ChefIncentivesController, data: any) {
	const allocInfo: {[key: string]: number} = {
		pWBTC: 0,
		vdWBTC: 0,
		pWETH: 0,
		vdWETH: 0,
		pUSDC: 1,
		vdUSDC: 0,
		pUSDT: 0,
		vdUSDT: 0,
		pDAI: 0,
		vdDAI: 0,
	};
	const tokens = [];
	const allocPoints = [];
	for (const key in allocInfo) {
		if (!data.allTokens[key]) {
			return;
		}
		tokens.push(data.allTokens[key]);
		allocPoints.push(allocInfo[key]);
	}

	const receipt = await chef.batchUpdateAllocPoint(tokens, allocPoints);
	await receipt.wait();
	return receipt.hash;
}

export const sellPrnt = async (
	amt: string,
	user: SignerWithAddress,
	prime: PrimeToken,
	lockZap: TestnetLockZap,
	priceProvider: PriceProvider,
	stakingToken: string
) => {
	const lp = await ethers.getContractAt('UniswapV2Pair', stakingToken);
	const {_reserve0, _reserve1} = await lp.getReserves();
	const token0 = await lp.token0();
	const wethReserve = token0 == prime.address ? _reserve1 : _reserve0;

	let prntPrice = await priceProvider.getTokenPrice();

	// not very accurate, but works. sell for 50% of eth in there
	let partEth = wethReserve.div(2);
	let inPrnt = partEth.mul(BigNumber.from(10).pow(await priceProvider.decimals())).div(prntPrice);
	const maxSell = inPrnt.mul(5);

	let amount;
	if (amt === 'max') {
		let userBal = await prime.balanceOf(user.address);
		if (userBal > maxSell) {
			amount = maxSell;
		} else {
			amount = userBal;
		}
	} else {
		amount = ethers.utils.parseEther(amt);
		if (amount.gt(maxSell)) {
			amount = maxSell;
		}
	}
	await prime.connect(user).approve(lockZap.address, ethers.constants.MaxUint256);
	return (await lockZap.connect(user).sell(amount)).hash;
};

export const zapIntoEligibility = async (
	user: SignerWithAddress,
	deployData: DeployData,
	amountEth: string = '10',
	lockLengthIndex: number = 0,
	borrow = false
) => {
	let lockZap = await ethers.getContractAt('TestnetLockZap', deployData.lockZap);

	let debtTokenAddress = await lockZap.getVDebtToken(deployData.baseAssetWrappedAddress);
	const vdWETH = <VariableDebtToken>await ethers.getContractAt('VariableDebtToken', debtTokenAddress);
	await (await vdWETH.connect(user).approveDelegation(lockZap.address, ethers.constants.MaxUint256)).wait();
	await delay2();
	if (borrow) {
		await (await lockZap.connect(user).zap(borrow, ethers.constants.AddressZero, amountEth, 0, lockLengthIndex, 0)).wait();
	} else {
		await lockZap.connect(user).zap(borrow, ethers.constants.AddressZero, 0, 0, lockLengthIndex, 0, {
			value: ethers.utils.parseEther(amountEth),
		});
	}
};

function delay2() {
	return new Promise((res, rej) => {
		setTimeout(res, 1 * 1000);
	});
}

export const depositAndBorrowAll = async (
	user: SignerWithAddress,
	amounts: string[],
	deployData: DeployData,
	delay: boolean = false
) => {
	let dao: SignerWithAddress;
	[dao] = await ethers.getSigners();
	// console.log("allTokens: ", deployData.allTokens)
	const keys = Object.keys(deployData.allTokens).filter((k) => k.charAt(0) == 'r');

	for (let i = 0; i < keys.length; i++) {
		const ticker = keys[i];
		let amount;
		if (ticker == 'pWBTC') {
			amount = amounts[0];
		} else if (ticker == 'pWETH') {
			amount = amounts[0];
		} else if (ticker == 'rwstETH' || ticker == 'rMAGIC') {
			continue;
		} else {
			amount = amounts[1];
		}

		if (amount == '0') {
			console.log('skipping');
			continue;
		}

		const token = <AToken>await ethers.getContractAt('AToken', deployData.allTokens[ticker]);
		const lendingPool = <LendingPool>await ethers.getContractAt('LendingPool', deployData.lendingPool);
		let underlying = await token.UNDERLYING_ASSET_ADDRESS();
		let asset;
		if (ticker === 'pWETH') {
			asset = <WETH>await ethers.getContractAt('WETH', underlying);
		} else if (ticker === 'pPRNT') {
			asset = <PrimeToken>await ethers.getContractAt('PrimeToken', underlying);
		} else {
			asset = <MockToken>await ethers.getContractAt('MockToken', underlying);
		}
		const formattedAmt = ethers.utils.parseUnits(amount, await asset.decimals());

		if (ticker === 'pWETH') {
			// await asset.connect(user).deposit({
			//   value: formattedAmt
			// })

			const tx = await asset.connect(user).mint(formattedAmt);
			await tx.wait();
		} else if (ticker === 'pPRNT') {
			await asset.connect(dao).transfer(user.address, formattedAmt);
		} else {
			// console.log("asset: ", asset.address)
			const tx = await asset.mint(user.address, formattedAmt);
			await tx.wait();
		}
		await (await asset.connect(user).approve(lendingPool.address, ethers.constants.MaxUint256)).wait();

		if (delay) {
			await delay2();
		}
		await (await lendingPool.connect(user).deposit(asset.address, formattedAmt, user.address, 0)).wait();
		// if (delay) {
		//   await advanceTimeAndBlock(1 * MINUTE);
		// }
		if (delay) {
			await delay2();
		}

		let borrowAmt;
		if (ticker === 'pWETH') {
			borrowAmt = formattedAmt.div(20);
		} else {
			borrowAmt = formattedAmt.div(2);
		}
		if (delay) {
			await delay2();
		}
		await (await lendingPool.connect(user).borrow(asset.address, borrowAmt, 2, 0, user.address)).wait();
	}
};

export const depositAndBorrowAllBsc = async (
	user: SignerWithAddress,
	amounts: string[],
	deployData: DeployData,
	delay: boolean = false
) => {
	const keys = Object.keys(deployData.allTokens).filter((k) => k.charAt(0) == 'r');

	for (let i = 0; i < keys.length; i++) {
		const ticker = keys[i];
		let amount;
		if (ticker == 'pWBTC') {
			amount = amounts[0];
		} else if (ticker == 'pWBNB') {
			amount = amounts[1];
		} else {
			amount = amounts[2];
		}
		// console.log(ticker, amount);
		const token = <AToken>await ethers.getContractAt('AToken', deployData.allTokens[ticker]);
		const lendingPool = <LendingPool>await ethers.getContractAt('LendingPool', deployData.lendingPool);
		let underlying = await token.UNDERLYING_ASSET_ADDRESS();
		let asset;
		if (ticker === 'pWBNB') {
			asset = <WBNB>await ethers.getContractAt('WBNB', underlying);
		} else {
			asset = <MockToken>await ethers.getContractAt('MockToken', underlying);
		}
		const formattedAmt = ethers.utils.parseUnits(amount, await asset.decimals());

		if (ticker === 'pWBNB') {
			await asset.connect(user).mint(formattedAmt);
			// await asset.connect(user).deposit({
			//   value: formattedAmt
			// })
		} else {
			const tx = await asset.mint(user.address, formattedAmt);
			await tx.wait();
		}
		await asset.connect(user).approve(lendingPool.address, ethers.constants.MaxUint256);
		await (await lendingPool.connect(user).deposit(asset.address, formattedAmt, user.address, 0)).wait();
		if (delay) {
			await advanceTimeAndBlock(1 * MINUTE);
		}
		await (await lendingPool.connect(user).borrow(asset.address, formattedAmt.div(2), 2, 0, user.address)).wait();
	}
};

export const depAll = async (user: SignerWithAddress, amounts, deployData, delay: boolean = false, all = false) => {
	let keys;
	if (all) {
		keys = ['pUSDT', 'pUSDC', 'pDAI', 'pWETH', 'pWBTC'];
	} else {
		keys = ['pUSDC'];
		// keys = ['pWETH'];
	}

	console.log('starting ' + user.address);

	for (let i = 0; i < keys.length; i++) {
		const ticker = keys[i];
		let amount;
		if (ticker == 'pWBTC') {
			amount = amounts[0];
		} else if (ticker == 'pWETH') {
			amount = amounts[1];
		} else {
			amount = amounts[2];
		}
		// console.log(ticker, amount);
		const token = <AToken>await ethers.getContractAt('AToken', deployData.allTokens[ticker]);
		const lendingPool = <LendingPool>await ethers.getContractAt('LendingPool', deployData.lendingPool);
		let underlying = await token.UNDERLYING_ASSET_ADDRESS();
		let asset;
		if (ticker === 'pWETH') {
			asset = <WBNB>await ethers.getContractAt('WBNB', underlying);
		} else {
			asset = <MockToken>await ethers.getContractAt('MockToken', underlying);
		}
		const formattedAmt = ethers.utils.parseUnits(amount, await asset.decimals());

		if (ticker === 'pWETH') {
			await asset.connect(user).mint(formattedAmt);
			// await asset.connect(user).deposit({
			//   value: formattedAmt
			// })
		} else {
			const tx = await asset.mint(user.address, formattedAmt);
			await tx.wait();
		}
		await delay2();

		await asset.connect(user).approve(lendingPool.address, ethers.constants.MaxUint256);
		await (await lendingPool.connect(user).deposit(asset.address, formattedAmt, user.address, 0)).wait();

		console.log('done ' + user.address);
		// if (delay) {
		//   await advanceTimeAndBlock(1 * MINUTE);
		// }
		// await (await lendingPool.connect(user).borrow(asset.address, formattedAmt.div(2), 2, 0, user.address)).wait();
	}
};

export const usdc = async (user: SignerWithAddress, amounts, deployData, delay: boolean = false, all = false) => {
	let keys;
	if (all) {
		keys = ['pUSDT', 'pUSDC', 'pDAI', 'pWETH', 'pWBTC'];
	} else {
		keys = ['pUSDC'];
	}

	console.log('starting ' + user.address);

	for (let i = 0; i < keys.length; i++) {
		const ticker = keys[i];
		let amount;
		if (ticker == 'pWBTC') {
			amount = amounts[0];
		} else if (ticker == 'pWETH') {
			amount = amounts[1];
		} else {
			amount = amounts[2];
		}
		// console.log(ticker, amount);
		const token = <AToken>await ethers.getContractAt('AToken', deployData.allTokens[ticker]);
		const lendingPool = <LendingPool>await ethers.getContractAt('LendingPool', deployData.lendingPool);
		let underlying = await token.UNDERLYING_ASSET_ADDRESS();
		let asset;
		if (ticker === 'pWETH') {
			asset = <WBNB>await ethers.getContractAt('WBNB', underlying);
		} else {
			asset = <MockToken>await ethers.getContractAt('MockToken', underlying);
		}
		const formattedAmt = ethers.utils.parseUnits(amount, await asset.decimals());

		if (ticker === 'pWETH') {
			await asset.connect(user).mint(formattedAmt);
			// await asset.connect(user).deposit({
			//   value: formattedAmt
			// })
		} else {
			const tx = await asset.mint(user.address, formattedAmt);
			await tx.wait();
		}

		console.log('done ' + user.address);
		// if (delay) {
		//   await advanceTimeAndBlock(1 * MINUTE);
		// }
		// await (await lendingPool.connect(user).borrow(asset.address, formattedAmt.div(2), 2, 0, user.address)).wait();
	}
};

export const borAll = async (user: SignerWithAddress, amounts, deployData, delay: boolean = false, all = false) => {
	let keys;
	if (all) {
		keys = ['pUSDT', 'pUSDC', 'pDAI', 'pWETH', 'pWBTC'];
	} else {
		keys = ['pUSDC'];
	}

	for (let i = 0; i < keys.length; i++) {
		const ticker = keys[i];
		let amount;
		if (ticker == 'pWBTC') {
			amount = amounts[0];
		} else if (ticker == 'pWETH') {
			amount = amounts[1];
		} else {
			amount = amounts[2];
		}
		// console.log(ticker, amount);
		const token = <AToken>await ethers.getContractAt('AToken', deployData.allTokens[ticker]);
		const lendingPool = <LendingPool>await ethers.getContractAt('LendingPool', deployData.lendingPool);
		let underlying = await token.UNDERLYING_ASSET_ADDRESS();
		let asset;
		if (ticker === 'pWETH') {
			asset = <WBNB>await ethers.getContractAt('WBNB', underlying);
		} else {
			asset = <MockToken>await ethers.getContractAt('MockToken', underlying);
		}
		const formattedAmt = ethers.utils.parseUnits(amount, await asset.decimals());

		if (ticker === 'pWETH') {
			await asset.connect(user).mint(formattedAmt);
			// await asset.connect(user).deposit({
			//   value: formattedAmt
			// })
		} else {
			const tx = await asset.mint(user.address, formattedAmt);
			await tx.wait();
		}

		await delay2();

		await asset.connect(user).approve(lendingPool.address, ethers.constants.MaxUint256);
		// await (await lendingPool.connect(user).deposit(asset.address, formattedAmt, user.address, 0)).wait();
		// if (delay) {
		//   await advanceTimeAndBlock(1 * MINUTE);
		// }
		await (await lendingPool.connect(user).borrow(asset.address, formattedAmt, 2, 0, user.address)).wait();
	}
};

export const toJsNum = (bn: BigNumber) => {
	return parseFloat(ethers.utils.formatEther(bn));
};
export const getUserEarnings = async (mfd: MultiFeeDistribution, user: SignerWithAddress) => {
	return toJsNum((await mfd.earnedBalances(user.address)).totalVesting);
};
