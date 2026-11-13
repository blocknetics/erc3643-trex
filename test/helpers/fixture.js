// SPDX-License-Identifier: GPL-3.0
const { ethers } = require("hardhat");
const {
    deployInfrastructure,
    deployClaimIssuer,
    deployTokenSuite,
    deployInvestorIdentity,
    issueKycClaim,
} = require("../../scripts/lib/suite");

// ISO 3166-1 numeric country codes
const CH = 756;
const DE = 276;
const US = 840;

async function deployFixture() {
    const [deployer, tokenOwner, agent, issuerManager, alice, bob, carol, dave, newWallet] = await ethers.getSigners();

    // The claim issuer signs with its own key, separate from the account that manages the issuer contract.
    const issuerSigningWallet = ethers.Wallet.createRandom();

    const infra = await deployInfrastructure(deployer);
    const claimIssuer = await deployClaimIssuer(deployer, issuerManager, issuerSigningWallet);

    const suite = await deployTokenSuite({
        trexFactory: infra.trexFactory,
        owner: tokenOwner,
        name: "Blocknetics Demo Bond",
        symbol: "BDB",
        decimals: 0,
        salt: "blocknetics-demo-bond",
        irAgents: [agent],
        tokenAgents: [agent],
        claimIssuer,
    });

    // Alice (CH) and Bob (DE) are fully onboarded: identity registered, KYC claim from the trusted issuer.
    const investors = {};
    for (const [label, wallet, country] of [
        ["alice", alice, CH],
        ["bob", bob, DE],
    ]) {
        const identity = await deployInvestorIdentity(deployer, infra.identityAuthority, wallet);
        await issueKycClaim({ claimIssuer, signingWallet: issuerSigningWallet, identity, investorWallet: wallet });
        await (await suite.identityRegistry.connect(agent).registerIdentity(wallet.address, await identity.getAddress(), country)).wait();
        investors[label] = { wallet, identity };
    }

    // Carol has an identity registered but NO claim. Dave is not registered at all.
    const carolIdentity = await deployInvestorIdentity(deployer, infra.identityAuthority, carol);
    await (await suite.identityRegistry.connect(agent).registerIdentity(carol.address, await carolIdentity.getAddress(), US)).wait();
    investors.carol = { wallet: carol, identity: carolIdentity };

    // Tokens start paused after deployment; the agent unpauses once the setup is done.
    await (await suite.token.connect(agent).unpause()).wait();

    return {
        signers: { deployer, tokenOwner, agent, issuerManager, alice, bob, carol, dave, newWallet },
        issuerSigningWallet,
        claimIssuer,
        investors,
        ...infra,
        ...suite,
    };
}

// Deploys a T-REX upgradeable module behind a ModuleProxy and runs its initializer.
async function deployUpgradeableModule(name, deployer) {
    const implementation = await ethers.deployContract(name, [], deployer);
    await implementation.waitForDeployment();
    const initData = implementation.interface.encodeFunctionData("initialize");
    const proxy = await ethers.deployContract("ModuleProxy", [await implementation.getAddress(), initData], deployer);
    await proxy.waitForDeployment();
    return ethers.getContractAt(name, await proxy.getAddress());
}

// Binds a module to the token's compliance and applies one settings call. Only the compliance owner can do this.
async function bindModule({ compliance, owner, module, fn, args = [] }) {
    const moduleAddress = await module.getAddress();
    await (await compliance.connect(owner).addModule(moduleAddress)).wait();
    if (fn) {
        const data = module.interface.encodeFunctionData(fn, args);
        await (await compliance.connect(owner).callModuleFunction(data, moduleAddress)).wait();
    }
}

module.exports = { deployFixture, deployUpgradeableModule, bindModule, CH, DE, US };
