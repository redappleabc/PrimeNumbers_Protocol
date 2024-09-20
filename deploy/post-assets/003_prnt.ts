import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {deployAsset} from '../../scripts/deploy/helpers/deploy-asset';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
	const {deployments} = hre;
	const {get} = deployments;

	const assetName = 'PrimeToken';
    const assetSymbol = 'PRNT';
    let oracle;
	if (network.tags.oracle_v3) {
		oracle = await get('UniV3TwapOracle');
	} else if (network.tags.oracle_v2) {
		oracle = await get('UniV2TwapOracle');
	} else {
		oracle = await get('PrimeChainlinkOracle');
	}
    const assetAddress = (await get(assetName)).address;
    const oracleAddress = oracle.address;

	let asset = {
		assetAddress,
		chainlinkAggregator: oracleAddress,
		borrowRate: '30000000000000000000000000',
		reservesParams: {
			aTokenImpl: 'AToken',
			baseLTVAsCollateral: '7000',
			borrowingEnabled: true,
			liquidationBonus: '11500',
			liquidationThreshold: '8000',
			reserveDecimals: '18',
			reserveFactor: '7500',
			stableBorrowRateEnabled: false,
			strategy: {
				baseVariableBorrowRate: '0',
				name: `rateStrategy${assetSymbol}`,
				optimalUtilizationRate: '700000000000000000000000000',
				variableRateSlope1: '130000000000000000000000000',
				variableRateSlope2: '950000000000000000000000000',
				stableRateSlope1: '100000000000000000000000000',
				stableRateSlope2: '3000000000000000000000000000',
			},
		},
		initInputParams: {
			aTokenName: `Prime interest bearing ${assetSymbol}`,
			aTokenSymbol: `p${assetSymbol}`,
			params: '0x10',
			stableDebtTokenName: `Prime stable debt bearing ${assetSymbol}`,
			stableDebtTokenSymbol: `stableDebt${assetSymbol}`,
			underlyingAsset: assetAddress,
			underlyingAssetDecimals: '18',
			underlyingAssetName: assetSymbol,
			variableDebtTokenName: `Prime variable debt bearing ${assetSymbol}`,
			variableDebtTokenSymbol: `variableDebt${assetSymbol}`,
			allocPoint: 2,
		},
	};
	await deployAsset(asset, hre);
	return true;
};
export default func;
func.id = 'prnt_market';
func.tags = ['prnt_market'];
