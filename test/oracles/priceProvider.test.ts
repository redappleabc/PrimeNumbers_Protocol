import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {ethers} from 'hardhat';
import {
	IChainlinkAggregator,
	ISequencerAggregator,
	IArbitrumSequencerUptimeFeed,
	MockToken,
	PriceProvider,
	TestnetLockZap,
	UniV2TwapOracle,
} from '../../typechain';
import {BigNumber} from 'ethers';
import chai from 'chai';
import {solidity} from 'ethereum-waffle';
import {advanceTimeAndBlock, sellPrnt, toJsNum} from '../shared/helpers';
import {DeployConfig, DeployData} from '../../scripts/deploy/types';
import {PrimeToken} from '../../typechain/contracts/oft';
import {targetPrice} from '../../config/BaseConfig';
import {setupTest} from '../setup';
import {getLatestBlockTimestamp} from '../../scripts/utils';

chai.use(solidity);
const {expect} = chai;

const priceToJsNum = (oracleAnswer: BigNumber) => {
	return parseFloat(ethers.utils.formatUnits(oracleAnswer, 8));
};

describe('Price Provider ', function () {
	let deployData: DeployData;
	let deployConfig: DeployConfig;

	let dao: SignerWithAddress;

	let LP_INIT_ETH: BigNumber;
	let LP_INIT_PRNT: BigNumber;

	let lockZap: TestnetLockZap;
	let lpToken: MockToken;
	let uniV2TwapOracle: UniV2TwapOracle;
	let prime: PrimeToken;
	let priceProvider: PriceProvider;
	let chainlinkAggregator: IChainlinkAggregator;
	let priceDecimals: number;
	let uptimeFeedAggregator: IChainlinkAggregator;
	let uptimeFeed: IArbitrumSequencerUptimeFeed;

	let decimals: BigNumber;
	let period: number;

	let initEth: number;
	let initPrnt: number;

	let startingPrntPrice = targetPrice;

	beforeEach(async function () {
		({priceProvider, deployData, deployConfig, uniV2TwapOracle, dao} = await setupTest());

		LP_INIT_ETH = deployConfig.LP_INIT_ETH;
		LP_INIT_PRNT = deployConfig.LP_INIT_PRNT;
		initEth = parseInt(ethers.utils.formatEther(LP_INIT_ETH.toString()));
		initPrnt = parseInt(ethers.utils.formatEther(LP_INIT_PRNT.toString()));

		lpToken = await ethers.getContractAt('MockToken', await priceProvider.getLpTokenAddress());

		decimals = await priceProvider.decimals();

		chainlinkAggregator = <IChainlinkAggregator>(
			await ethers.getContractAt('IChainlinkAggregator', deployConfig.CHAINLINK_ETH_USD_AGGREGATOR_PROXY)
		);
		priceDecimals = await chainlinkAggregator.decimals(); // 8 in most cases

		period = deployConfig.TWAP_PERIOD;

		await advanceTimeAndBlock(period);
		await priceProvider.update();
	});

	it('returns initial token price (USD)', async function () {
		const tokenPrice = await priceProvider.getTokenPriceUsd();
		expect(priceToJsNum(tokenPrice)).to.be.closeTo(startingPrntPrice, 0.1);
	});

	it('returns initial token price (ETH)', async function () {
		const tokenPriceEth = priceToJsNum(await priceProvider.getTokenPrice());

		const roundData = await chainlinkAggregator.latestRoundData();
		const ethPrice = priceToJsNum(roundData[1]);

		const expected = startingPrntPrice / ethPrice;

		expect(tokenPriceEth).to.be.closeTo(expected, 0.0001);
	});

	it('returns LP token price', async function () {
		let res = await priceProvider.getLpTokenPrice();
	});

	it('returns LP token price USD', async function () {
		let res = await priceProvider.getLpTokenPriceUsd();
	});

	// it("handles price going up", async function () {
	//   const [tokenPriceEthStart] = await getPrices();
	//   const [lpPriceEthStart] = await getLpPrices();

	//   // console.log(`Start Token Price: ${tokenPriceEthStart}`);
	//   // console.log(`Stat LP Price: ${lpPriceEthStart}`);

	//   await lockZap.zapETH(0, {
	//     value: ethers.utils.parseUnits("100", 18),
	//   });

	//   const [tokenPriceEthEnd] = await getPrices();
	//   const [lpPriceEthEnd] = await getLpPrices();

	//   // console.log(`end Token Price: ${tokenPriceEthEnd}`);
	//   // console.log(`end LP Price: ${lpPriceEthEnd}`);

	//   assert(tokenPriceEthEnd > tokenPriceEthStart, "price increased");
	//   assert(lpPriceEthEnd > lpPriceEthStart, "price increased");
	// });

	// it("handles price going down", async function () {
	//   const [tokenPriceEthStart] = await getPrices();
	//   const [lpPriceEthStart] = await getLpPrices();

	//   // add some LP before liquidating initial LP
	//   await lockZap.connect(dao).zapETH(0, {
	//     value: ethers.utils.parseUnits(".1", 18),
	//   });

	//   // sell a bunch of PRNT, lower price
	//   await sellPrnt(
	//     "max",
	//     dao,
	//     prime,
	//     lockZap,
	//     priceProvider,
	//     deployData.stakingToken
	//   );
	//   await priceProvider.update();

	//   const [tokenPriceEthEnd] = await getPrices();
	//   const [lpPriceEthEnd] = await getLpPrices();

	//   assert(tokenPriceEthEnd < tokenPriceEthStart, "price dec");
	//   assert(lpPriceEthEnd < lpPriceEthStart, "lp price dec");
	// });
});
