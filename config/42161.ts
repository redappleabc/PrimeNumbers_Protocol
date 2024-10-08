import {DeployConfig, LP_PROVIDER} from '../scripts/deploy/types';
import BaseConfig from './BaseConfig';

const chainConfig = {
	NETWORK: 'arbitrum',
	CHAIN_ID: 42161,

	LP_PROVIDER: LP_PROVIDER.BALANCER,

	WETH: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
	ROUTER_ADDR: '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506',

	PRNT_CL_FEED: '0x20d0Fcab0ECFD078B036b6CAf1FaC69A6453b352',

	PRIME_V1: '0x0c4681e6c0235179ec3d4f4fc4df3d14fdd96017',
	BAL_WEIGHTED_POOL_FACTORY: '0xf1665E19bc105BE4EDD3739F88315cC699cc5b65',
	BAL_VAULT: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
	STARGATE_ROUTER: '0x53Bf833A5d6c4ddA888F69c22C88C9f356a41614',
	STARGATE_ROUTER_ETH: '0xbf22f0f184bCcbeA268dF387a49fF5238dD23E40',
	LZ_ENDPOINT: '0x3c2269811836af69497E5F486A85D7316753cf62',
	CHAINLINK_ETH_USD_AGGREGATOR_PROXY: '0x639fe6ab55c921f74e7fac1ee960c0b6293ba612',
	ARBITRUM_SEQUENCER_UPTIME_FEED_AGGREGATOR_PROXY: '0xFdB631F5EE196F0ed6FAa767959853A9F217697D',

	STARGATE_CONFIG: {
		ASSETS: [
			'0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
			'0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
			'0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
		],
		POOL_IDS: [1, 2, 3],
	},

	TOKENS_CONFIG: [
		[
			'USDC',
			{
				assetAddress: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
				chainlinkAggregator: '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3',
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
						optimalUtilizationRate: '900000000000000000000000000',
						variableRateSlope1: '40000000000000000000000000',
						variableRateSlope2: '600000000000000000000000000',
						stableRateSlope1: '20000000000000000000000000',
						stableRateSlope2: '600000000000000000000000000',
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
					underlyingAsset: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
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
			'USDT',
			{
				assetAddress: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
				chainlinkAggregator: '0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7',
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
						optimalUtilizationRate: '900000000000000000000000000',
						variableRateSlope1: '40000000000000000000000000',
						variableRateSlope2: '600000000000000000000000000',
						stableRateSlope1: '20000000000000000000000000',
						stableRateSlope2: '600000000000000000000000000',
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
					underlyingAsset: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
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
			'DAI',
			{
				assetAddress: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
				chainlinkAggregator: '0xc5C8E77B397E531B8EC06BFb0048328B30E9eCfB',
				heartbeat: 86400,
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
						optimalUtilizationRate: '800000000000000000000000000',
						variableRateSlope1: '40000000000000000000000000',
						variableRateSlope2: '750000000000000000000000000',
						stableRateSlope1: '20000000000000000000000000',
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
					underlyingAsset: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
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
			'WBTC',
			{
				assetAddress: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
				chainlinkAggregator: '0xd0C7101eACbB49F3deCcCc166d238410D6D46d57',
				heartbeat: 86400,
				borrowRate: '30000000000000000000000000',
				reservesParams: {
					aTokenImpl: 'AToken',
					baseLTVAsCollateral: '7000',
					borrowingEnabled: true,
					liquidationBonus: '11500',
					liquidationThreshold: '7500',
					reserveDecimals: '8',
					reserveFactor: BaseConfig.RESERVE_FACTOR,
					stableBorrowRateEnabled: false,
					strategy: {
						baseVariableBorrowRate: '0',
						name: 'rateStrategyVolatileTwo',
						optimalUtilizationRate: '650000000000000000000000000',
						variableRateSlope1: '80000000000000000000000000',
						variableRateSlope2: '3000000000000000000000000000',
						stableRateSlope1: '100000000000000000000000000',
						stableRateSlope2: '3000000000000000000000000000',
					},
				},
				initInputParams: {
					aTokenImpl: '0x0000000000000000000000000000000000000000',
					aTokenName: 'Prime interest bearing WBTC',
					aTokenSymbol: 'pWBTC',
					incentivesController: '0x0000000000000000000000000000000000000000',
					interestRateStrategyAddress: '0x0000000000000000000000000000000000000000',
					params: '0x10',
					stableDebtTokenImpl: '0x0000000000000000000000000000000000000000',
					stableDebtTokenName: 'Prime stable debt bearing WBTC',
					stableDebtTokenSymbol: 'stableDebtWBTC',
					treasury: '0x0000000000000000000000000000000000000000',
					underlyingAsset: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
					underlyingAssetDecimals: '8',
					underlyingAssetName: 'WBTC',
					variableDebtTokenImpl: '0x0000000000000000000000000000000000000000',
					variableDebtTokenName: 'Prime variable debt bearing WBTC',
					variableDebtTokenSymbol: 'variableDebtWBTC',
					allocPoint: 100,
				},
			},
		],
		[
			'WETH',
			{
				assetAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
				chainlinkAggregator: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
				heartbeat: 86400,
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
						optimalUtilizationRate: '650000000000000000000000000',
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
					underlyingAsset: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
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

const ArbitrumConfig: DeployConfig = {...BaseConfig, ...chainConfig};
export default ArbitrumConfig;
