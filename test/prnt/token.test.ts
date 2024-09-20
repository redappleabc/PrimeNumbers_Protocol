import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import chai from 'chai';
import {solidity} from 'ethereum-waffle';
import {BigNumber} from 'ethers';
import {ethers} from 'hardhat';
import {getConfigForChain} from '../../config';
import {DeployConfig} from '../../scripts/deploy/types';
import {LZEndpointMock, MockPriceProvider, PrimeToken} from '../../typechain';
import {MockOFTReceiverV2} from '../../typechain/contracts/test/MockOFTReceiverV2';
import {StaticPriceProvider} from '../../typechain/contracts/test/StaticPriceProvider';
import {advanceTimeAndBlock} from '../shared/helpers';
chai.use(solidity);
const {expect} = chai;

describe('Prime Token: ', function () {
	const {deployments, getNamedAccounts} = hre;
	const {deploy, execute, read} = deployments;

	const chainIdSrc = 1;
	const chainIdDst = 2;

	const dstSupply = ethers.utils.parseUnits('500000', 18);
	const sendQty = ethers.utils.parseUnits('1', 18); // amount to be sent across
	const adapterParams: string = '0x';

	let config: DeployConfig;
	let srcSupply: BigNumber;

	let deployer: SignerWithAddress;
	let dao: string;
	let treasury: string;
	let admin: SignerWithAddress;
	let OFTSrc: PrimeToken;
	let OFTDst: PrimeToken;
	let oftReceiver: MockOFTReceiverV2;
	let priceProvider: MockPriceProvider;

	before(async function () {
		({deployer, treasury, dao, admin} = await getNamedAccounts());
		config = getConfigForChain(await hre.getChainId()).config;
	});

	beforeEach(async function () {
		// await deployments.fixture(["TokenTag"]);
		await deployments.fixture(['oft', 'ownership']);

		OFTSrc = <PrimeToken>await ethers.getContract('PrimeToken');
		await deploy('LZEndpointDstMock', {
			contract: 'LZEndpointMock',
			from: deployer,
			log: true,
			waitConfirmations: 1,
			skipIfAlreadyDeployed: false,
			args: [chainIdDst],
		});
		await deploy('StaticPriceProvider', {
			contract: 'StaticPriceProvider',
			from: deployer,
			log: true,
			waitConfirmations: 1,
			skipIfAlreadyDeployed: false,
			args: [],
		});

		const lzEndpointSrcMock = await ethers.getContract('LZEndpointSrcMock');
		const lzEndpointDstMock = await ethers.getContract('LZEndpointDstMock');

		await deploy('PrimeTokenDst', {
			contract: 'PrimeToken',
			from: deployer,
			log: true,
			waitConfirmations: 1,
			skipIfAlreadyDeployed: false,
			args: [config.TOKEN_NAME, config.SYMBOL, lzEndpointDstMock.address, dao, treasury, dstSupply],
		});
		OFTDst = <PrimeToken>await ethers.getContract('PrimeTokenDst');
		await execute('PrimeTokenDst', {from: deployer, log: true}, 'transferOwnership', admin);

		// // internal bookkeeping for endpoints (not part of a real deploy, just for this test)
		await execute(
			'LZEndpointSrcMock',
			{from: deployer},
			'setDestLzEndpoint',
			OFTDst.address,
			lzEndpointDstMock.address
		);
		await execute(
			'LZEndpointDstMock',
			{from: deployer},
			'setDestLzEndpoint',
			OFTSrc.address,
			lzEndpointSrcMock.address
		);
		if (admin.address != (await OFTSrc.owner())) {
			await execute(
				'PrimeToken',
				{
					from: deployer,
					log: true,
				},
				'transferOwnership',
				admin
			);
		}
		await execute('PrimeToken', {from: admin}, 'setTrustedRemote', chainIdDst, OFTDst.address);
		await execute('PrimeTokenDst', {from: admin}, 'setTrustedRemote', chainIdSrc, OFTSrc.address);

		const MockOFTReceiverV2 = await ethers.getContractFactory('MockOFTReceiverV2');
		oftReceiver = <MockOFTReceiverV2>await MockOFTReceiverV2.deploy();
		await oftReceiver.deployed();

		priceProvider = <StaticPriceProvider>await ethers.getContract('StaticPriceProvider');

		srcSupply = await OFTSrc.balanceOf(dao);
	});

	it('constructor params', async function () {
		const oftFactory = await ethers.getContractFactory('PrimeToken');
		await expect(
			oftFactory.deploy('token name', 'symbol', ethers.constants.AddressZero, dao, dao, 0)
		).to.be.revertedWith('AddressZero');
		await expect(
			oftFactory.deploy('token name', 'symbol', dao, ethers.constants.AddressZero, dao, 0)
		).to.be.revertedWith('AddressZero');
		await expect(
			oftFactory.deploy('token name', 'symbol', dao, dao, ethers.constants.AddressZero, 0)
		).to.be.revertedWith('AddressZero');
		await oftFactory.deploy('token name', 'symbol', dao, dao, dao, 0);
	});

	it('admin perms', async function () {
		await expect(execute('PrimeToken', {from: dao}, 'unpause')).to.be.revertedWith(
			'Ownable: caller is not the owner'
		);
	});

	it('minted', async function () {
		// ensure they're both starting with correct amounts
		let daoSrcBal = await read('PrimeToken', {from: dao}, 'balanceOf', dao);
		let daoDstBal = await read('PrimeTokenDst', {from: dao}, 'balanceOf', dao);
		expect(daoSrcBal).to.be.equal(srcSupply);
		expect(daoDstBal).to.be.equal(dstSupply);
	});

	it('admin perms', async function () {
		await expect(execute('PrimeToken', {from: dao}, 'setFeeRatio', 1000)).to.be.revertedWith(
			'Ownable: caller is not the owner'
		);

		let expectedFee = 90;
		await execute('PrimeToken', {from: admin}, 'setFeeRatio', expectedFee);
		let actualFee = await read('PrimeToken', 'feeRatio');
		expect(actualFee).equals(expectedFee);
	});

	it('sendFrom()', async function () {
		// ensure they're both starting with correct amounts
		expect(await read('PrimeToken', {from: dao}, 'balanceOf', dao)).to.be.equal(srcSupply);
		expect(await read('PrimeTokenDst', {from: dao}, 'balanceOf', dao)).to.be.equal(dstSupply);

		let toAddressBytes32 = ethers.utils.defaultAbiCoder.encode(['address'], [dao]);

		// let fees = await read(
		// 	'PrimeToken',
		// 	{from: dao},
		// 	'estimateSendFee',
		// 	chainIdDst,
		// 	toAddressBytes32,
		// 	sendQty,
		// 	false,
		// 	adapterParams
		// );
		let fees = await OFTSrc.estimateSendFee(chainIdDst, toAddressBytes32, sendQty, false, adapterParams);

		await execute(
			'PrimeToken',
			{from: dao, value: fees[0]},
			'sendFrom',
			dao,
			chainIdDst,
			toAddressBytes32,
			sendQty,
			{
				refundAddress: dao, // refund address (if too much message fee is sent, it gets refunded)
				zroPaymentAddress: ethers.constants.AddressZero, // address(0x0) if not paying in ZRO (LayerZero Token)
				adapterParams: adapterParams, // flexible bytes array to indicate messaging adapter services
			}
		);

		// verify tokens burned on source chain and minted on destination chain
		expect(await read('PrimeToken', {from: dao}, 'balanceOf', dao)).to.be.equal(srcSupply.sub(sendQty));
		expect(await read('PrimeTokenDst', {from: dao}, 'balanceOf', dao)).to.be.equal(dstSupply.add(sendQty));
	});

	it('sendAndCall()', async function () {
		// ensure they're both starting with correct amounts
		expect(await read('PrimeToken', {from: dao}, 'balanceOf', dao)).to.be.equal(srcSupply);
		expect(await read('PrimeTokenDst', {from: dao}, 'balanceOf', dao)).to.be.equal(dstSupply);

		let toAddressBytes32 = ethers.utils.defaultAbiCoder.encode(['address'], [oftReceiver.address]);

		const dstGasForCall = ethers.utils.parseEther('1').div(10);
		let fees = await OFTSrc.estimateSendAndCallFee(
			chainIdDst,
			toAddressBytes32,
			sendQty,
			'0x',
			dstGasForCall,
			false,
			adapterParams
		);

		await execute(
			'PrimeToken',
			{from: dao, value: fees[0]},
			'sendAndCall',
			dao,
			chainIdDst,
			toAddressBytes32,
			sendQty,
			'0x',
			dstGasForCall,
			{
				refundAddress: dao, // refund address (if too much message fee is sent, it gets refunded)
				zroPaymentAddress: ethers.constants.AddressZero, // address(0x0) if not paying in ZRO (LayerZero Token)
				adapterParams: adapterParams, // flexible bytes array to indicate messaging adapter services
			}
		);

		// verify tokens burned on source chain and minted on destination chain
		expect(await read('PrimeToken', {from: dao}, 'balanceOf', dao)).to.be.equal(srcSupply.sub(sendQty));
		expect(await read('PrimeTokenDst', {from: dao}, 'balanceOf', oftReceiver.address)).to.be.equal(sendQty);
	});

	it('sendAndCall() with low amount', async function () {
		// ensure they're both starting with correct amounts
		expect(await read('PrimeToken', {from: dao}, 'balanceOf', dao)).to.be.equal(srcSupply);
		expect(await read('PrimeTokenDst', {from: dao}, 'balanceOf', dao)).to.be.equal(dstSupply);

		let toAddressBytes32 = ethers.utils.defaultAbiCoder.encode(['address'], [oftReceiver.address]);

		const sendQty = BigNumber.from('19900000000'); // amount to be sent across
		const dust = BigNumber.from('9900000000'); // amount to be sent across

		const dstGasForCall = ethers.utils.parseEther('1').div(10);
		let fees = await OFTSrc.estimateSendAndCallFee(
			chainIdDst,
			toAddressBytes32,
			sendQty,
			'0x',
			dstGasForCall,
			false,
			adapterParams
		);

		const treasuryEth0 = await ethers.provider.getBalance(treasury);

		await execute(
			'PrimeToken',
			{from: dao, value: fees[0]},
			'sendAndCall',
			dao,
			chainIdDst,
			toAddressBytes32,
			sendQty,
			'0x',
			dstGasForCall,
			{
				refundAddress: dao, // refund address (if too much message fee is sent, it gets refunded)
				zroPaymentAddress: ethers.constants.AddressZero, // address(0x0) if not paying in ZRO (LayerZero Token)
				adapterParams: adapterParams, // flexible bytes array to indicate messaging adapter services
			}
		);

		const treasuryEth1 = await ethers.provider.getBalance(treasury);

		expect(treasuryEth1.sub(treasuryEth0)).to.be.equal(fees[0]);

		// verify tokens burned on source chain and minted on destination chain
		expect(await read('PrimeToken', {from: dao}, 'balanceOf', dao)).to.be.equal(srcSupply.sub(sendQty).add(dust));
		expect(await read('PrimeTokenDst', {from: dao}, 'balanceOf', oftReceiver.address)).to.be.equal(
			sendQty.sub(dust)
		);
	});

	it('setPriceProvider', async function () {
		await expect(execute('PrimeToken', {from: dao}, 'setPriceProvider', priceProvider.address)).to.be.revertedWith(
			'Ownable: caller is not the owner'
		);
		await expect(
			execute('PrimeToken', {from: admin}, 'setPriceProvider', ethers.constants.AddressZero)
		).to.be.revertedWith('AddressZero');
	});

	it('setTreasury', async function () {
		await expect(execute('PrimeToken', {from: dao}, 'setTreasury', treasury)).to.be.revertedWith(
			'Ownable: caller is not the owner'
		);
		await expect(
			execute('PrimeToken', {from: admin}, 'setTreasury', ethers.constants.AddressZero)
		).to.be.revertedWith('AddressZero');
		await execute('PrimeToken', {from: admin}, 'setTreasury', treasury);
	});

	it('full Bridge flow', async function () {
		let feeVal = 90;
		await execute('PrimeToken', {from: admin}, 'setFeeRatio', feeVal);
		await execute('PrimeToken', {from: admin}, 'setPriceProvider', priceProvider.address);
		await execute('PrimeTokenDst', {from: admin}, 'setPriceProvider', priceProvider.address);
		// await advanceTimeAndBlock(3601);
		// await priceProvider.update();

		// ensure they're both starting with correct amounts
		expect(await read('PrimeToken', {from: dao}, 'balanceOf', dao)).to.be.equal(srcSupply);
		expect(await read('PrimeTokenDst', {from: dao}, 'balanceOf', dao)).to.be.equal(dstSupply);

		const priceInEth = await priceProvider.getTokenPrice();
		const priceDecimals = await priceProvider.decimals();

		const fee = await read('PrimeToken', {from: dao}, 'getBridgeFee', sendQty);
		const expectedFee = sendQty.mul(priceInEth).div(BigNumber.from(10).pow(priceDecimals)).mul(feeVal).div(10_000);

		expect(fee).to.be.equal(expectedFee);

		const beforeTreasuryBalance = await hre.ethers.provider.getBalance(treasury);

		let toAddressBytes32 = ethers.utils.defaultAbiCoder.encode(['address'], [dao]);

		let bridgeFee = await OFTSrc.getBridgeFee(sendQty);

		await expect(
			execute(
				'PrimeToken',
				{from: dao, value: bridgeFee.div(10)},
				'sendFrom',
				dao,
				chainIdDst,
				toAddressBytes32,
				sendQty,
				{
					refundAddress: dao, // refund address (if too much message fee is sent, it gets refunded)
					zroPaymentAddress: ethers.constants.AddressZero, // address(0x0) if not paying in ZRO (LayerZero Token)
					adapterParams: adapterParams, // flexible bytes array to indicate messaging adapter services
				}
			)
		).to.be.revertedWith('InsufficientETHForFee');

		await expect(
			execute('PrimeToken', {from: dao, value: fee}, 'sendFrom', dao, chainIdDst, toAddressBytes32, 0, {
				refundAddress: dao, // refund address (if too much message fee is sent, it gets refunded)
				zroPaymentAddress: ethers.constants.AddressZero, // address(0x0) if not paying in ZRO (LayerZero Token)
				adapterParams: adapterParams, // flexible bytes array to indicate messaging adapter services
			})
		).to.be.revertedWith('AmountTooSmall');

		// can transfer accross chain
		await execute('PrimeToken', {from: dao, value: fee}, 'sendFrom', dao, chainIdDst, toAddressBytes32, sendQty, {
			refundAddress: dao, // refund address (if too much message fee is sent, it gets refunded)
			zroPaymentAddress: ethers.constants.AddressZero, // address(0x0) if not paying in ZRO (LayerZero Token)
			adapterParams: adapterParams, // flexible bytes array to indicate messaging adapter services
		});

		const afterTreasuryBalance = await hre.ethers.provider.getBalance(treasury);
		expect(afterTreasuryBalance.sub(beforeTreasuryBalance)).to.be.equal(fee);

		// verify tokens burned on source chain and minted on destination chain
		expect(await read('PrimeToken', {from: dao}, 'balanceOf', dao)).to.be.equal(srcSupply.sub(sendQty));
		expect(await read('PrimeTokenDst', {from: dao}, 'balanceOf', dao)).to.be.equal(dstSupply.add(sendQty));
	});

	it('pauseBridge()', async function () {
		// pause the transfers
		await execute('PrimeTokenDst', {from: admin}, 'pause');

		// transfer to the paused chain are not paused. Only outbound
		let toAddressBytes32 = ethers.utils.defaultAbiCoder.encode(['address'], [dao]);
		const fee = await read('PrimeToken', {from: dao}, 'getBridgeFee', sendQty);
		await execute('PrimeToken', {from: dao, value: fee}, 'sendFrom', dao, chainIdDst, toAddressBytes32, sendQty, {
			refundAddress: dao, // refund address (if too much message fee is sent, it gets refunded)
			zroPaymentAddress: ethers.constants.AddressZero, // address(0x0) if not paying in ZRO (LayerZero Token)
			adapterParams: adapterParams, // flexible bytes array to indicate messaging adapter services
		});

		// verify tokens burned on source chain and minted on destination chain
		let postTransferExpectedBalanceSrc = srcSupply.sub(sendQty);
		let postTransferExpectedBalanceDst = dstSupply.add(sendQty);
		expect(await read('PrimeToken', {from: dao}, 'balanceOf', dao)).to.be.equal(postTransferExpectedBalanceSrc);
		expect(await read('PrimeTokenDst', {from: dao}, 'balanceOf', dao)).to.be.equal(postTransferExpectedBalanceDst);

		// cannot transfer back across chain due to pause
		await expect(
			execute('PrimeTokenDst', {from: dao, value: fee}, 'sendFrom', dao, chainIdSrc, toAddressBytes32, sendQty, {
				refundAddress: dao, // refund address (if too much message fee is sent, it gets refunded)
				zroPaymentAddress: ethers.constants.AddressZero, // address(0x0) if not paying in ZRO (LayerZero Token)
				adapterParams: adapterParams, // flexible bytes array to indicate messaging adapter services
			})
		).to.be.revertedWith('Pausable: paused');

		// verify tokens were not modified
		expect(await read('PrimeToken', {from: dao}, 'balanceOf', dao)).to.be.equal(postTransferExpectedBalanceSrc);
		expect(await read('PrimeTokenDst', {from: dao}, 'balanceOf', dao)).to.be.equal(postTransferExpectedBalanceDst);

		// unpause the transfers
		await execute('PrimeTokenDst', {from: admin}, 'unpause');

		// transfer succeeds
		await execute(
			'PrimeTokenDst',
			{from: dao, value: fee},
			'sendFrom',
			dao,
			chainIdSrc,
			toAddressBytes32,
			sendQty,
			{
				refundAddress: dao, // refund address (if too much message fee is sent, it gets refunded)
				zroPaymentAddress: ethers.constants.AddressZero, // address(0x0) if not paying in ZRO (LayerZero Token)
				adapterParams: adapterParams, // flexible bytes array to indicate messaging adapter services
			}
		);

		// verify tokens were sent back
		expect(await read('PrimeToken', {from: dao}, 'balanceOf', dao)).to.be.equal(srcSupply);
		expect(await read('PrimeTokenDst', {from: dao}, 'balanceOf', dao)).to.be.equal(dstSupply);
	});

	it('pauseBridge() - reverts if not owner', async function () {
		await expect(execute('PrimeToken', {from: dao}, 'pause')).to.be.revertedWith(
			'Ownable: caller is not the owner'
		);
	});

	it('fails when invalid input', async function () {
		await expect(execute('PrimeToken', {from: admin}, 'setFeeRatio', 10001)).to.be.revertedWith('InvalidRatio');
	});
});
