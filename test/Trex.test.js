// SPDX-License-Identifier: GPL-3.0
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture, deployUpgradeableModule, bindModule, CH, DE, US } = require("./helpers/fixture");

describe("ERC-3643 (T-REX) suite deployed via TREXFactory", () => {
    describe("Deployment", () => {
        it("deploys a token wired to its identity registry, compliance and ONCHAINID", async () => {
            const { token, identityRegistry, compliance, signers } = await loadFixture(deployFixture);
            expect(await token.name()).to.equal("Blocknetics Demo Bond");
            expect(await token.symbol()).to.equal("BDB");
            expect(await token.identityRegistry()).to.equal(await identityRegistry.getAddress());
            expect(await token.compliance()).to.equal(await compliance.getAddress());
            expect(await token.onchainID()).to.not.equal(ethers.ZeroAddress);
            expect(await token.owner()).to.equal(signers.tokenOwner.address);
            expect(await token.isAgent(signers.agent.address)).to.equal(true);
        });

        it("registers the KYC topic and the trusted issuer", async () => {
            const { claimTopicsRegistry, trustedIssuersRegistry, claimIssuer } = await loadFixture(deployFixture);
            expect((await claimTopicsRegistry.getClaimTopics()).length).to.equal(1);
            expect(await trustedIssuersRegistry.isTrustedIssuer(await claimIssuer.getAddress())).to.equal(true);
        });
    });

    describe("Identity verification (who can hold)", () => {
        it("lets an agent mint to a verified investor", async () => {
            const { token, signers } = await loadFixture(deployFixture);
            await token.connect(signers.agent).mint(signers.alice.address, 1000);
            expect(await token.balanceOf(signers.alice.address)).to.equal(1000);
        });

        it("rejects minting to an investor with no registered identity", async () => {
            const { token, signers } = await loadFixture(deployFixture);
            await expect(token.connect(signers.agent).mint(signers.dave.address, 10)).to.be.revertedWith(
                "Identity is not verified."
            );
        });

        it("rejects minting to an investor whose identity has no KYC claim", async () => {
            const { token, identityRegistry, signers } = await loadFixture(deployFixture);
            expect(await identityRegistry.contains(signers.carol.address)).to.equal(true);
            expect(await identityRegistry.isVerified(signers.carol.address)).to.equal(false);
            await expect(token.connect(signers.agent).mint(signers.carol.address, 10)).to.be.revertedWith(
                "Identity is not verified."
            );
        });

        it("only mints when called by an agent", async () => {
            const { token, signers } = await loadFixture(deployFixture);
            await expect(token.connect(signers.alice).mint(signers.alice.address, 10)).to.be.reverted;
        });

        it("stops treating an investor as verified once the issuer revokes the claim", async () => {
            const { identityRegistry, claimIssuer, issuerManager, investors, signers, issuerSigningWallet } =
                await loadFixture(deployFixture);
            expect(await identityRegistry.isVerified(signers.bob.address)).to.equal(true);

            // Rebuild Bob's claim signature and revoke it from the issuer contract.
            const { KYC_TOPIC } = require("../scripts/lib/suite");
            const data = ethers.hexlify(ethers.toUtf8Bytes("KYC verified"));
            const hash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["address", "uint256", "bytes"],
                    [await investors.bob.identity.getAddress(), KYC_TOPIC, data]
                )
            );
            const signature = await issuerSigningWallet.signMessage(ethers.getBytes(hash));
            await claimIssuer.connect(signers.issuerManager).revokeClaimBySignature(signature);

            expect(await identityRegistry.isVerified(signers.bob.address)).to.equal(false);
        });
    });

    describe("Transfers", () => {
        async function funded() {
            const ctx = await loadFixture(deployFixture);
            await ctx.token.connect(ctx.signers.agent).mint(ctx.signers.alice.address, 1000);
            return ctx;
        }

        it("allows a transfer between two verified investors", async () => {
            const { token, signers } = await funded();
            await token.connect(signers.alice).transfer(signers.bob.address, 250);
            expect(await token.balanceOf(signers.alice.address)).to.equal(750);
            expect(await token.balanceOf(signers.bob.address)).to.equal(250);
        });

        it("blocks a transfer to a wallet that has no identity", async () => {
            const { token, signers } = await funded();
            await expect(token.connect(signers.alice).transfer(signers.dave.address, 1)).to.be.revertedWith(
                "Transfer not possible"
            );
        });

        it("blocks a transfer to an identity without a KYC claim", async () => {
            const { token, signers } = await funded();
            await expect(token.connect(signers.alice).transfer(signers.carol.address, 1)).to.be.revertedWith(
                "Transfer not possible"
            );
        });

        it("blocks all transfers while the token is paused", async () => {
            const { token, signers } = await funded();
            await token.connect(signers.agent).pause();
            await expect(token.connect(signers.alice).transfer(signers.bob.address, 1)).to.be.revertedWith(
                "Pausable: paused"
            );
            await token.connect(signers.agent).unpause();
            await token.connect(signers.alice).transfer(signers.bob.address, 1);
        });
    });

    describe("Agent controls", () => {
        async function funded() {
            const ctx = await loadFixture(deployFixture);
            await ctx.token.connect(ctx.signers.agent).mint(ctx.signers.alice.address, 1000);
            return ctx;
        }

        it("freezes a wallet", async () => {
            const { token, signers } = await funded();
            await token.connect(signers.agent).setAddressFrozen(signers.alice.address, true);
            await expect(token.connect(signers.alice).transfer(signers.bob.address, 1)).to.be.revertedWith(
                "wallet is frozen"
            );
        });

        it("freezes part of a balance", async () => {
            const { token, signers } = await funded();
            await token.connect(signers.agent).freezePartialTokens(signers.alice.address, 900);
            await token.connect(signers.alice).transfer(signers.bob.address, 100);
            await expect(token.connect(signers.alice).transfer(signers.bob.address, 1)).to.be.revertedWith(
                "Insufficient Balance"
            );
        });

        it("forces a transfer between verified wallets, even when tokens are frozen", async () => {
            const { token, signers } = await funded();
            await token.connect(signers.agent).freezePartialTokens(signers.alice.address, 1000);
            await token.connect(signers.agent).forcedTransfer(signers.alice.address, signers.bob.address, 400);
            expect(await token.balanceOf(signers.bob.address)).to.equal(400);
        });

        it("burns tokens", async () => {
            const { token, signers } = await funded();
            await token.connect(signers.agent).burn(signers.alice.address, 100);
            expect(await token.totalSupply()).to.equal(900);
        });

        it("recovers tokens from a lost wallet to a new wallet bound to the same ONCHAINID", async () => {
            const { token, identityRegistry, investors, signers } = await funded();
            // Alice adds the new wallet as a management key on her own identity.
            const newKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signers.newWallet.address]));
            await investors.alice.identity.connect(signers.alice).addKey(newKey, 1, 1);

            await token
                .connect(signers.agent)
                .recoveryAddress(signers.alice.address, signers.newWallet.address, await investors.alice.identity.getAddress());

            expect(await token.balanceOf(signers.newWallet.address)).to.equal(1000);
            expect(await token.balanceOf(signers.alice.address)).to.equal(0);
            expect(await identityRegistry.isVerified(signers.newWallet.address)).to.equal(true);
        });
    });

    describe("Compliance modules", () => {
        async function funded() {
            const ctx = await loadFixture(deployFixture);
            await ctx.token.connect(ctx.signers.agent).mint(ctx.signers.alice.address, 1000);
            return ctx;
        }

        it("CountryAllowModule (official): only investors from allowed countries can receive", async () => {
            const { token, compliance, signers } = await funded();
            const module = await deployUpgradeableModule("CountryAllowModule", signers.deployer);
            await bindModule({ compliance, owner: signers.tokenOwner, module, fn: "addAllowedCountry", args: [CH] });

            // Bob is registered in Germany, which is not allowed.
            await expect(token.connect(signers.alice).transfer(signers.bob.address, 1)).to.be.revertedWith(
                "Transfer not possible"
            );

            const data = module.interface.encodeFunctionData("addAllowedCountry", [DE]);
            await compliance.connect(signers.tokenOwner).callModuleFunction(data, await module.getAddress());
            await token.connect(signers.alice).transfer(signers.bob.address, 1);
            expect(await token.balanceOf(signers.bob.address)).to.equal(1);
        });

        it("only the compliance owner can bind modules", async () => {
            const { compliance, signers } = await funded();
            const module = await deployUpgradeableModule("CountryAllowModule", signers.deployer);
            await expect(compliance.connect(signers.alice).addModule(await module.getAddress())).to.be.reverted;
        });

        describe("HoldingPeriodModule (custom)", () => {
            const THIRTY_DAYS = 30 * 24 * 60 * 60;

            async function withHoldingPeriod() {
                const ctx = await loadFixture(deployFixture);
                const module = await ethers.deployContract("HoldingPeriodModule");
                await module.waitForDeployment();
                await bindModule({
                    compliance: ctx.compliance,
                    owner: ctx.signers.tokenOwner,
                    module,
                    fn: "setHoldingPeriod",
                    args: [THIRTY_DAYS],
                });
                await ctx.token.connect(ctx.signers.agent).mint(ctx.signers.alice.address, 1000);
                return { ...ctx, module };
            }

            it("stores the period per compliance contract", async () => {
                const { module, compliance } = await withHoldingPeriod();
                expect(await module.getHoldingPeriod(await compliance.getAddress())).to.equal(THIRTY_DAYS);
                expect(await module.name()).to.equal("HoldingPeriodModule");
            });

            it("blocks a transfer during the holding period and allows it afterwards", async () => {
                const { token, signers } = await withHoldingPeriod();
                await expect(token.connect(signers.alice).transfer(signers.bob.address, 100)).to.be.revertedWith(
                    "Transfer not possible"
                );

                await time.increase(THIRTY_DAYS + 1);
                await token.connect(signers.alice).transfer(signers.bob.address, 100);
                expect(await token.balanceOf(signers.bob.address)).to.equal(100);
            });

            it("starts a new holding period for the recipient", async () => {
                const { token, signers } = await withHoldingPeriod();
                await time.increase(THIRTY_DAYS + 1);
                await token.connect(signers.alice).transfer(signers.bob.address, 100);

                // Bob just received tokens, so he cannot pass them on yet.
                await expect(token.connect(signers.bob).transfer(signers.alice.address, 50)).to.be.revertedWith(
                    "Transfer not possible"
                );
                await time.increase(THIRTY_DAYS + 1);
                await token.connect(signers.bob).transfer(signers.alice.address, 50);
            });

            it("does not restrict issuance", async () => {
                const { token, signers } = await withHoldingPeriod();
                await token.connect(signers.agent).mint(signers.bob.address, 10);
                expect(await token.balanceOf(signers.bob.address)).to.equal(10);
            });

            it("lets an agent force a transfer during the holding period", async () => {
                const { token, signers } = await withHoldingPeriod();
                await token.connect(signers.agent).forcedTransfer(signers.alice.address, signers.bob.address, 100);
                expect(await token.balanceOf(signers.bob.address)).to.equal(100);
            });

            it("rejects direct calls to the setter and the state hooks", async () => {
                const { module, signers } = await withHoldingPeriod();
                await expect(module.connect(signers.alice).setHoldingPeriod(1)).to.be.revertedWith(
                    "only bound compliance can call"
                );
                await expect(
                    module.connect(signers.alice).moduleTransferAction(signers.alice.address, signers.bob.address, 1)
                ).to.be.revertedWith("only bound compliance can call");
            });

            it("a period of zero disables the restriction", async () => {
                const { token, compliance, module, signers } = await withHoldingPeriod();
                const data = module.interface.encodeFunctionData("setHoldingPeriod", [0]);
                await compliance.connect(signers.tokenOwner).callModuleFunction(data, await module.getAddress());
                await token.connect(signers.alice).transfer(signers.bob.address, 100);
            });
        });
    });
});
