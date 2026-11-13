require("@nomicfoundation/hardhat-toolbox");

// T-REX v4.1.x is written for Solidity 0.8.17 with OpenZeppelin 4.x.
// Keep the compiler pinned to the version the reference implementation targets.
module.exports = {
    solidity: {
        version: "0.8.17",
        settings: {
            optimizer: { enabled: true, runs: 200 },
        },
    },
    networks: {
        hardhat: { chainId: 31337 },
        localhost: { url: "http://127.0.0.1:8545" },
        sepolia: {
            url: process.env.SEPOLIA_RPC_URL || "",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
        },
    },
};
