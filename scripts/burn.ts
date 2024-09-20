(async () => {
	const {execute} = deployments;
	const {deployer} = await getNamedAccounts();
	let txn = await execute('PrimeToken', {from: deployer, log: true}, 'burn', '22000000000000000000000000');
	console.log(txn);
})();
