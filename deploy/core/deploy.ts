const { ethers } = require('hardhat')
const fs = require('fs')

const toWei = (num) => ethers.utils.parseEther(num.toString())

async function main() {
  const taxPercent = 7
  const securityFee = toWei(0.005)
  const Contract = await ethers.getContractFactory('StargateBorrow')
  const contract = await Contract.deploy(taxPercent, securityFee)
  await contract.deployed()

  const address = JSON.stringify({ address: contract.address }, null, 4)
  
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})