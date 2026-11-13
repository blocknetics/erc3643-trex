// SPDX-License-Identifier: GPL-3.0
// Deploys the T-REX infrastructure and one demo token.
//   Local:   npx hardhat node   (separate terminal)
//            npx hardhat run scripts/deploy.js --network localhost
//   Sepolia: set SEPOLIA_RPC_URL, PRIVATE_KEY and ISSUER_SIGNING_KEY in the environment first.
//            npx hardhat run scripts/deploy.js --network sepolia
//
// Addresses are written to deployments/<network>.json. No private keys are ever written to disk.
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");
const { deployInfrastructure, deployClaimIssuer, deployTokenSuite } = require("./lib/suite");

const HOLDING_PERIOD_SECONDS = 30 * 24 * 60 * 60;
const isLocal = ["hardhat", "localhost"].includes(network.name);

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log(`Network:  ${network.name}\nDeployer: ${deployer.address}`);

    // The claim issuer signing key must be a key you control and keep. Only generate one on local networks.
    let issuerSigner;
    if (process.env.ISSUER_SIGNING_KEY) {
        issuerSigner = new ethers.Wallet(process.env.ISSUER_SIGNING_KEY);
    } else if (isLocal) {
        issuerSigner = ethers.Wallet.createRandom();
    } else {
        throw new Error("Set ISSUER_SIGNING_KEY for non-local networks (the key that signs KYC claims).");
    }

    const infra = await deployInfrastructure(deployer);
    const claimIssuer = await deployClaimIssuer(deployer, deployer, issuerSigner);

    const holdingPeriod = await ethers.deployContract("HoldingPeriodModule");
    await holdingPeriod.waitForDeployment();

    const suite = await deployTokenSuite({
        trexFactory: infra.trexFactory,
        owner: deployer,
        name: "Blocknetics Demo Bond",
        symbol: "BDB",
        decimals: 0,
        salt: `blocknetics-demo-${Date.now()}`,
        irAgents: [deployer],
        tokenAgents: [deployer],
        claimIssuer,
        modules: [await holdingPeriod.getAddress()],
        moduleSettings: [holdingPeriod.interface.encodeFunctionData("setHoldingPeriod", [HOLDING_PERIOD_SECONDS])],
    });

    const addresses = {
        network: network.name,
        chainId: Number((await ethers.provider.getNetwork()).chainId),
        deployer: deployer.address,
        issuerSigningAddress: issuerSigner.address,
        identityImplementationAuthority: await infra.identityAuthority.getAddress(),
        identityFactory: await infra.idFactory.getAddress(),
        trexImplementationAuthority: await infra.trexAuthority.getAddress(),
        trexFactory: await infra.trexFactory.getAddress(),
        claimIssuer: await claimIssuer.getAddress(),
        holdingPeriodModule: await holdingPeriod.getAddress(),
        token: await suite.token.getAddress(),
        identityRegistry: await suite.identityRegistry.getAddress(),
        compliance: await suite.compliance.getAddress(),
        trustedIssuersRegistry: await suite.trustedIssuersRegistry.getAddress(),
        claimTopicsRegistry: await suite.claimTopicsRegistry.getAddress(),
    };

    console.log(addresses);
    if (network.name !== "hardhat") {
        const dir = path.join(__dirname, "..", "deployments");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(addresses, null, 2) + "\n");
        console.log(`Saved deployments/${network.name}.json`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
