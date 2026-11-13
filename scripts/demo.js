// SPDX-License-Identifier: GPL-3.0
// Walkthrough of a compliant ERC-3643 token lifecycle on a local Hardhat network.
//   npx hardhat run scripts/demo.js
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
    deployInfrastructure,
    deployClaimIssuer,
    deployTokenSuite,
    deployInvestorIdentity,
    issueKycClaim,
} = require("./lib/suite");

const THIRTY_DAYS = 30 * 24 * 60 * 60;
const step = (n, text) => console.log(`\n[${n}] ${text}`);

async function attempt(label, fn) {
    try {
        await fn();
        console.log(`    OK       ${label}`);
    } catch (e) {
        const reason = e.reason || e.shortMessage || e.message;
        console.log(`    REJECTED ${label}  (${reason})`);
    }
}

async function main() {
    const [deployer, issuer, agent, alice, bob, dave] = await ethers.getSigners();
    const issuerSigner = ethers.Wallet.createRandom();

    step(1, "Deploy the official T-REX v4 suite through TREXFactory");
    const infra = await deployInfrastructure(deployer);
    const claimIssuer = await deployClaimIssuer(deployer, issuer, issuerSigner);

    const holdingPeriod = await ethers.deployContract("HoldingPeriodModule");
    await holdingPeriod.waitForDeployment();
    const suite = await deployTokenSuite({
        trexFactory: infra.trexFactory,
        owner: deployer,
        name: "Blocknetics Demo Bond",
        symbol: "BDB",
        decimals: 0,
        salt: "demo-bond",
        irAgents: [agent],
        tokenAgents: [agent],
        claimIssuer,
        // Our custom module is bound at deployment with a 30 day holding period.
        modules: [await holdingPeriod.getAddress()],
        moduleSettings: [holdingPeriod.interface.encodeFunctionData("setHoldingPeriod", [THIRTY_DAYS])],
    });
    console.log(`    token ${await suite.token.getAddress()}`);

    step(2, "Onboard investors: ONCHAINID identity + signed KYC claim + registry entry");
    for (const [wallet, country] of [[alice, 756], [bob, 276]]) {
        const identity = await deployInvestorIdentity(deployer, infra.identityAuthority, wallet);
        await issueKycClaim({ claimIssuer, signingWallet: issuerSigner, identity, investorWallet: wallet });
        await suite.identityRegistry.connect(agent).registerIdentity(wallet.address, await identity.getAddress(), country);
    }
    console.log(`    alice verified: ${await suite.identityRegistry.isVerified(alice.address)}`);
    console.log(`    bob   verified: ${await suite.identityRegistry.isVerified(bob.address)}`);
    console.log(`    dave  verified: ${await suite.identityRegistry.isVerified(dave.address)} (never onboarded)`);

    step(3, "Issue tokens (the token starts paused; the agent unpauses it)");
    await suite.token.connect(agent).unpause();
    await suite.token.connect(agent).mint(alice.address, 1000);
    console.log(`    alice balance: ${await suite.token.balanceOf(alice.address)}`);

    step(4, "Transfers are checked on-chain");
    await attempt("alice -> dave (not onboarded)", () => suite.token.connect(alice).transfer(dave.address, 100));
    await attempt("alice -> bob right after issuance (30 day holding period)", () =>
        suite.token.connect(alice).transfer(bob.address, 100)
    );

    step(5, "Wait 30 days (local chain time travel)");
    await time.increase(THIRTY_DAYS + 1);
    await attempt("alice -> bob after the holding period", () => suite.token.connect(alice).transfer(bob.address, 100));
    console.log(`    alice ${await suite.token.balanceOf(alice.address)} / bob ${await suite.token.balanceOf(bob.address)}`);

    step(6, "Regulatory controls: the agent freezes a wallet");
    await suite.token.connect(agent).setAddressFrozen(bob.address, true);
    await time.increase(THIRTY_DAYS + 1);
    await attempt("bob -> alice (bob is frozen)", () => suite.token.connect(bob).transfer(alice.address, 10));
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
