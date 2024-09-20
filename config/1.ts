import {DeployConfig, LP_PROVIDER} from '../scripts/deploy/types';
import BaseConfig from './BaseConfig';
import {DAY, MINUTE} from './constants';
const {ethers} = require('hardhat');

const LOCK_TIME: number = 1 * DAY;
const VEST_TIME: number = 90 * MINUTE;
const REWARDS_DURATION = 7 * MINUTE;
const LOOKBACK_DURATION = 3 * MINUTE;

const chainConfig = {
	NETWORK: 'mainnet',
	CHAIN_ID: 1,

	// DEBUG
	LOCK_INFO: {
		LOCK_PERIOD: [LOCK_TIME, LOCK_TIME * 3, LOCK_TIME * 6, LOCK_TIME * 12],
		MULTIPLIER: [1, 4, 10, 25],
	},
	MFD_VEST_DURATION: VEST_TIME,
	MFD_LOCK_DURATION_SECS: (3 * LOCK_TIME).toString(),
	MFD_REWARD_DURATION_SECS: REWARDS_DURATION.toString(),
	MFD_REWARD_LOOKBACK_SECS: LOOKBACK_DURATION.toString(),

	LP_PROVIDER: LP_PROVIDER.UNISWAP,
	CIC_RPS: ethers.utils.parseUnits('20', 18),
	// END DEBUG

	WETH: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
	ROUTER_ADDR: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
	PRNT_CL_FEED: '0x393CC05baD439c9B36489384F11487d9C8410471',

	BAL_WEIGHTED_POOL_FACTORY: '0x897888115Ada5773E02aA29F775430BFB5F34c51',
	BAL_VAULT: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
	BAL_WSTETH_POOL: '',
	BAL_WSTETH: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0',
	WETH_USDC_POOL_ID:
		ethers.utils.formatBytes32String(0x64541216bafffeec8ea535bb71fbc927831d0595000100000000000000000002),
	DAI_USDT_USDC_POOL_ID:
		ethers.utils.formatBytes32String(0xfebb0bbf162e64fb9d0dfe186e517d84c395f016000000000000000000000502),
	STARGATE_ROUTER: '0x8731d54E9D02c286767d56ac03e8037C07e01e98',
	STARGATE_ROUTER_ETH: '0x150f94B44927F078737562f0fcF3C95c01Cc2376',
	LZ_ENDPOINT: '0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675',
	CHAINLINK_ETH_USD_AGGREGATOR_PROXY: '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419',
	STARGATE_CONFIG: {
		ASSETS: [
			'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', //USDC
			'0xdac17f958d2ee523a2206206994597c13d831ec7', //USDT
			'0x6b175474e89094c44da98b954eedeac495271d0f', //DAI
		],
		POOL_IDS: [1, 2, 3],
	},
	TOKENS_CONFIG: [
		[
			'USDT',
			{
				assetAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
				chainlinkAggregator: '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D',
				heartbeat: 86400,
				borrowRate: '39000000000000000000000000',
				reservesParams: {
					aTokenImpl: 'AToken',
					baseLTVAsCollateral: '8000',
					borrowingEnabled: true,
					liquidationBonus: '11500',
					liquidationThreshold: '8500',
					reserveDecimals: '6',
					reserveFactor: BaseConfig.RESERVE_FACTOR,
					stableBorrowRateEnabled: false,
					strategy: {
						baseVariableBorrowRate: '0',
						name: 'rateStrategyStableThree',
						optimalUtilizationRate: '10000000000000000000000000',
						variableRateSlope1: '60000000000000000000000000',
						variableRateSlope2: '650000000000000000000000000',
						stableRateSlope1: '60000000000000000000000000',
						stableRateSlope2: '750000000000000000000000000',
					},
				},
				initInputParams: {
					aTokenImpl: '0x0000000000000000000000000000000000000000',
					aTokenName: 'Prime interest bearing USDT',
					aTokenSymbol: 'pUSDT',
					incentivesController: '0x0000000000000000000000000000000000000000',
					interestRateStrategyAddress: '0x0000000000000000000000000000000000000000',
					params: '0x10',
					stableDebtTokenImpl: '0x0000000000000000000000000000000000000000',
					stableDebtTokenName: 'Prime stable debt bearing USDT',
					stableDebtTokenSymbol: 'stableDebtUSDT',
					treasury: '0x0000000000000000000000000000000000000000',
					underlyingAsset: '0xdac17f958d2ee523a2206206994597c13d831ec7',
					underlyingAssetDecimals: '6',
					underlyingAssetName: 'USDT',
					variableDebtTokenImpl: '0x0000000000000000000000000000000000000000',
					variableDebtTokenName: 'Prime variable debt bearing USDT',
					variableDebtTokenSymbol: 'variableDebtUSDT',
					allocPoint: 100,
				},
			},
		],
		[
			'USDC',
			{
				assetAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
				chainlinkAggregator: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
				heartbeat: 86400,
				borrowRate: '39000000000000000000000000',
				reservesParams: {
					aTokenImpl: 'AToken',
					baseLTVAsCollateral: '8000',
					borrowingEnabled: true,
					liquidationBonus: '11500',
					liquidationThreshold: '8500',
					reserveDecimals: '6',
					reserveFactor: BaseConfig.RESERVE_FACTOR,
					stableBorrowRateEnabled: false,
					strategy: {
						baseVariableBorrowRate: '0',
						name: 'rateStrategyStableThree',
						optimalUtilizationRate: '10000000000000000000000000',
						variableRateSlope1: '60000000000000000000000000',
						variableRateSlope2: '650000000000000000000000000',
						stableRateSlope1: '60000000000000000000000000',
						stableRateSlope2: '750000000000000000000000000',
					},
				},
				initInputParams: {
					aTokenImpl: '0x0000000000000000000000000000000000000000',
					aTokenName: 'Prime interest bearing USDC',
					aTokenSymbol: 'pUSDC',
					incentivesController: '0x0000000000000000000000000000000000000000',
					interestRateStrategyAddress: '0x0000000000000000000000000000000000000000',
					params: '0x10',
					stableDebtTokenImpl: '0x0000000000000000000000000000000000000000',
					stableDebtTokenName: 'Prime stable debt bearing USDC',
					stableDebtTokenSymbol: 'stableDebtUSDC',
					treasury: '0x0000000000000000000000000000000000000000',
					underlyingAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
					underlyingAssetDecimals: '6',
					underlyingAssetName: 'USDC',
					variableDebtTokenImpl: '0x0000000000000000000000000000000000000000',
					variableDebtTokenName: 'Prime variable debt bearing USDC',
					variableDebtTokenSymbol: 'variableDebtUSDC',
					allocPoint: 100,
				},
			},
		],
		[
			'DAI',
			{
				assetAddress: '0x6b175474e89094c44da98b954eedeac495271d0f',
				chainlinkAggregator: '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9',
				heartbeat: 3600,
				borrowRate: '39000000000000000000000000',
				reservesParams: {
					aTokenImpl: 'AToken',
					baseLTVAsCollateral: '7500',
					borrowingEnabled: true,
					liquidationBonus: '11500',
					liquidationThreshold: '8500',
					reserveDecimals: '18',
					reserveFactor: BaseConfig.RESERVE_FACTOR,
					stableBorrowRateEnabled: false,
					strategy: {
						baseVariableBorrowRate: '0',
						name: 'rateStrategyStableTwo',
						optimalUtilizationRate: '10000000000000000000000000',
						variableRateSlope1: '60000000000000000000000000',
						variableRateSlope2: '650000000000000000000000000',
						stableRateSlope1: '60000000000000000000000000',
						stableRateSlope2: '750000000000000000000000000',
					},
				},
				initInputParams: {
					aTokenImpl: '0x0000000000000000000000000000000000000000',
					aTokenName: 'Prime interest bearing DAI',
					aTokenSymbol: 'pDAI',
					incentivesController: '0x0000000000000000000000000000000000000000',
					interestRateStrategyAddress: '0x0000000000000000000000000000000000000000',
					params: '0x10',
					stableDebtTokenImpl: '0x0000000000000000000000000000000000000000',
					stableDebtTokenName: 'Prime stable debt bearing DAI',
					stableDebtTokenSymbol: 'stableDebtDAI',
					treasury: '0x0000000000000000000000000000000000000000',
					underlyingAsset: '0x6b175474e89094c44da98b954eedeac495271d0f',
					underlyingAssetDecimals: '18',
					underlyingAssetName: 'DAI',
					variableDebtTokenImpl: '0x0000000000000000000000000000000000000000',
					variableDebtTokenName: 'Prime variable debt bearing DAI',
					variableDebtTokenSymbol: 'variableDebtDAI',
					allocPoint: 100,
				},
			},
		],
		[
			'WETH',
			{
				assetAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
				chainlinkAggregator: '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419',
				heartbeat: 3600,
				borrowRate: '30000000000000000000000000',
				reservesParams: {
					aTokenImpl: 'AToken',
					baseLTVAsCollateral: '8000',
					borrowingEnabled: true,
					liquidationBonus: '11500',
					liquidationThreshold: '8250',
					reserveDecimals: '18',
					reserveFactor: BaseConfig.RESERVE_FACTOR,
					stableBorrowRateEnabled: false,
					strategy: {
						baseVariableBorrowRate: '0',
						name: 'rateStrategyWETH',
						optimalUtilizationRate: '15000000000000000000000000',
						variableRateSlope1: '80000000000000000000000000',
						variableRateSlope2: '1000000000000000000000000000',
						stableRateSlope1: '100000000000000000000000000',
						stableRateSlope2: '1000000000000000000000000000',
					},
				},
				initInputParams: {
					aTokenImpl: '0x0000000000000000000000000000000000000000',
					aTokenName: 'Prime interest bearing WETH',
					aTokenSymbol: 'pWETH',
					incentivesController: '0x0000000000000000000000000000000000000000',
					interestRateStrategyAddress: '0x0000000000000000000000000000000000000000',
					params: '0x10',
					stableDebtTokenImpl: '0x0000000000000000000000000000000000000000',
					stableDebtTokenName: 'Prime stable debt bearing WETH',
					stableDebtTokenSymbol: 'stableDebtWETH',
					treasury: '0x0000000000000000000000000000000000000000',
					underlyingAsset: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
					underlyingAssetDecimals: '18',
					underlyingAssetName: 'WETH',
					variableDebtTokenImpl: '0x0000000000000000000000000000000000000000',
					variableDebtTokenName: 'Prime variable debt bearing WETH',
					variableDebtTokenSymbol: 'variableDebtWETH',
					allocPoint: 100,
				},
			},
		],
	],
};

const MainnetConfig: DeployConfig = {...BaseConfig, ...chainConfig};
export default MainnetConfig;
