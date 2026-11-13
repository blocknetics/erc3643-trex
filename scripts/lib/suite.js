// SPDX-License-Identifier: GPL-3.0
// Shared deployment logic for the ERC-3643 (T-REX) suite. Used by the tests and by scripts/deploy.js.
//
// Flow (mirrors the official ERC-3643 reference deployment):
//   1. Deploy ONCHAINID (identity) implementation, implementation authority and IdFactory
//   2. Deploy T-REX implementations + TREXImplementationAuthority
//   3. Deploy TREXFactory and authorise it on the IdFactory
//   4. Deploy a token suite through TREXFactory.deployTREXSuite
const { ethers } = require("hardhat");
const OnchainID = require("@onchain-id/solidity");

// Claim topic used for the demo: a combined KYC/AML attestation.
const KYC_TOPIC = BigInt(ethers.id("KYC_AML"));

async function deployFromOnchainId(name, signer, args = []) {
    const { abi, bytecode } = OnchainID.contracts[name];
    const factory = new ethers.ContractFactory(abi, bytecode, signer);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    return contract;
}

async function deployInfrastructure(deployer) {
    // ONCHAINID layer
    const identityImpl = await deployFromOnchainId("Identity", deployer, [deployer.address, true]);
    const identityAuthority = await deployFromOnchainId("ImplementationAuthority", deployer, [
        await identityImpl.getAddress(),
    ]);
    const idFactory = await deployFromOnchainId("Factory", deployer, [await identityAuthority.getAddress()]);

    // T-REX implementations (each is used behind a proxy)
    const impl = {};
    for (const name of [
        "ClaimTopicsRegistry",
        "TrustedIssuersRegistry",
        "IdentityRegistryStorage",
        "IdentityRegistry",
        "ModularCompliance",
        "Token",
    ]) {
        impl[name] = await ethers.deployContract(name, [], deployer);
        await impl[name].waitForDeployment();
    }

    const trexAuthority = await ethers.deployContract(
        "TREXImplementationAuthority",
        [true, ethers.ZeroAddress, ethers.ZeroAddress],
        deployer
    );
    await trexAuthority.waitForDeployment();
    await (
        await trexAuthority.addAndUseTREXVersion(
            { major: 4, minor: 0, patch: 0 },
            {
                tokenImplementation: await impl.Token.getAddress(),
                ctrImplementation: await impl.ClaimTopicsRegistry.getAddress(),
                irImplementation: await impl.IdentityRegistry.getAddress(),
                irsImplementation: await impl.IdentityRegistryStorage.getAddress(),
                tirImplementation: await impl.TrustedIssuersRegistry.getAddress(),
                mcImplementation: await impl.ModularCompliance.getAddress(),
            }
        )
    ).wait();

    const trexFactory = await ethers.deployContract(
        "TREXFactory",
        [await trexAuthority.getAddress(), await idFactory.getAddress()],
        deployer
    );
    await trexFactory.waitForDeployment();
    await (await idFactory.addTokenFactory(await trexFactory.getAddress())).wait();

    return { identityAuthority, idFactory, trexAuthority, trexFactory };
}

// Deploys a trusted claim issuer (an ONCHAINID ClaimIssuer contract) whose signing key is a separate wallet.
async function deployClaimIssuer(deployer, issuerManagement, signingWallet) {
    const claimIssuer = await deployFromOnchainId("ClaimIssuer", issuerManagement, [issuerManagement.address]);
    const keyHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signingWallet.address]));
    // purpose 3 = CLAIM_SIGNER, key type 1 = ECDSA
    await (await claimIssuer.connect(issuerManagement).addKey(keyHash, 3, 1)).wait();
    return claimIssuer;
}

async function deployTokenSuite({ trexFactory, owner, name, symbol, decimals, salt, irAgents, tokenAgents, claimIssuer, modules = [], moduleSettings = [] }) {
    const tokenDetails = {
        owner: owner.address,
        name,
        symbol,
        decimals,
        irs: ethers.ZeroAddress,
        ONCHAINID: ethers.ZeroAddress,
        irAgents: irAgents.map((a) => a.address),
        tokenAgents: tokenAgents.map((a) => a.address),
        complianceModules: modules,
        complianceSettings: moduleSettings,
    };
    const claimDetails = {
        claimTopics: [KYC_TOPIC],
        issuers: [await claimIssuer.getAddress()],
        issuerClaims: [[KYC_TOPIC]],
    };
    await (await trexFactory.deployTREXSuite(salt, tokenDetails, claimDetails)).wait();

    const token = await ethers.getContractAt("Token", await trexFactory.getToken(salt));
    const identityRegistry = await ethers.getContractAt("IdentityRegistry", await token.identityRegistry());
    const compliance = await ethers.getContractAt("ModularCompliance", await token.compliance());
    const trustedIssuersRegistry = await ethers.getContractAt("TrustedIssuersRegistry", await identityRegistry.issuersRegistry());
    const claimTopicsRegistry = await ethers.getContractAt("ClaimTopicsRegistry", await identityRegistry.topicsRegistry());
    return { token, identityRegistry, compliance, trustedIssuersRegistry, claimTopicsRegistry };
}

// Deploys an ONCHAINID identity for an investor wallet.
async function deployInvestorIdentity(deployer, identityAuthority, investorWallet) {
    const identity = await deployFromOnchainId("IdentityProxy", deployer, [
        await identityAuthority.getAddress(),
        investorWallet.address,
    ]);
    return new ethers.Contract(await identity.getAddress(), OnchainID.contracts.Identity.abi, investorWallet);
}

// The claim issuer signs (identity, topic, data); the investor stores the signed claim on their own identity.
async function issueKycClaim({ claimIssuer, signingWallet, identity, investorWallet, data = "KYC verified" }) {
    const encodedData = ethers.hexlify(ethers.toUtf8Bytes(data));
    const dataHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "bytes"],
            [await identity.getAddress(), KYC_TOPIC, encodedData]
        )
    );
    const signature = await signingWallet.signMessage(ethers.getBytes(dataHash));
    await (
        await identity
            .connect(investorWallet)
            .addClaim(KYC_TOPIC, 1, await claimIssuer.getAddress(), signature, encodedData, "")
    ).wait();
    return { signature, data: encodedData };
}

module.exports = {
    KYC_TOPIC,
    deployInfrastructure,
    deployClaimIssuer,
    deployTokenSuite,
    deployInvestorIdentity,
    issueKycClaim,
};
