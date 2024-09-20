import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import assert from 'assert';
import {ethers} from 'hardhat';
import {advanceTimeAndBlock} from '../../scripts/utils';
import {LendingPool, MultiFeeDistribution, MockERC20, MockToken} from '../../typechain';
import _ from 'lodash';
import chai, {expect} from 'chai';
import {solidity} from 'ethereum-waffle';
import {BigNumber} from 'ethers';
import {DeployConfig, DeployData} from '../../scripts/deploy/types';
import {getUsdVal, zapIntoEligibility} from '../shared/helpers';
import {setupTest} from '../setup';

chai.use(solidity);

describe('Ensure lockers can claim Platform Revenue', () => {
	let deployData: DeployData;
	let deployConfig: DeployConfig;

	let user2: SignerWithAddress;
	let USDC: MockToken;
	let pUSDC: MockERC20;
	let lendingPool: LendingPool;
	let multiFeeDistribution: MultiFeeDistribution;

	let REWARDS_DURATION = 0; // oneDay * 7;
	let usdcAddress = '';

	const usdcAmt = 10000000;
	const usdcPerAccount = ethers.utils.parseUnits(usdcAmt.toString(), 6);
	const borrowAmt = ethers.utils.parseUnits((usdcAmt * 0.5).toString(), 6);
	const smallBorrowAmt = ethers.utils.parseUnits('1', 6);

	before(async () => {
		const fixture = await setupTest();

		deployData = fixture.deployData;
		deployConfig = fixture.deployConfig;

		user2 = fixture.user2;

		usdcAddress = fixture.usdc.address;
		USDC = <MockToken>await ethers.getContractAt('MockToken', usdcAddress);
		pUSDC = <MockERC20>await ethers.getContractAt('mockERC20', deployData.allTokens.pUSDC);

		lendingPool = fixture.lendingPool;
		multiFeeDistribution = fixture.multiFeeDistribution;

		REWARDS_DURATION = (await multiFeeDistribution.rewardsDuration()).toNumber();
	});

	it('Lock LP', async () => {
		await zapIntoEligibility(user2, deployData);

		const lockedBal = (await multiFeeDistribution.lockedBalances(user2.address)).locked;

		expect(lockedBal).to.be.gt(BigNumber.from(0));
	});

	it('Deposit USDC', async () => {
		await USDC.connect(user2).mint(user2.address, usdcPerAccount);

		await USDC.connect(user2).approve(lendingPool.address, ethers.constants.MaxUint256);

		await lendingPool.connect(user2).deposit(usdcAddress, usdcPerAccount, user2.address, 0);

		await lendingPool.connect(user2).borrow(usdcAddress, borrowAmt, 2, 0, user2.address);
	});

	const borrowCycle = async () => {
		await zapIntoEligibility(user2, deployData, '10');

		await lendingPool.connect(user2).borrow(usdcAddress, smallBorrowAmt, 2, 0, user2.address);

		const claimableTokens = (await multiFeeDistribution.claimableRewards(user2.address)).map(({token}) => token);

		await multiFeeDistribution.connect(user2).getReward(claimableTokens);

		await advanceTimeAndBlock(REWARDS_DURATION);

		const rewards = (await multiFeeDistribution.claimableRewards(user2.address))
			.filter((item) => item.token === pUSDC.address)
			.map(({amount}) => amount);
		const claimable = getUsdVal(rewards[0], 6);

		assert(parseFloat(claimable) > 0);

		// @TODO: check their balance increased
		const claimTxn = await multiFeeDistribution.connect(user2).getReward(claimableTokens);
		assert(claimTxn.hash.length !== 0);
	};

	it('Can borrow and claim', async () => {
		await advanceTimeAndBlock(4000);
		await borrowCycle();
	});

	it('Can borrow and claim many times', async () => {
		const count = 20;
		for (let index = 0; index < count; index++) {
			await advanceTimeAndBlock(4000);
			await borrowCycle();
		}
	});
});
