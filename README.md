# erc3643-trex

A working ERC-3643 (T-REX) permissioned token suite, deployed the way the standard intends, plus one custom compliance module.

Built by [Blocknetics](https://www.blocknetics.io) as a reference for regulated tokenization work.

## What this is

- The **official T-REX v4.1.6 contracts** (`@tokenysolutions/t-rex`), compiled unmodified and deployed through the official `TREXFactory`.
- **ONCHAINID** identities (`@onchain-id/solidity` 2.2.1) and signed KYC claims from a trusted claim issuer, so eligibility is checked on-chain at every transfer.
- A **custom compliance module**, `HoldingPeriodModule`, written by us on top of the T-REX module system.
- A test suite (25 tests) and a runnable walkthrough.

## What this is not

- Not audited. Do not use it to hold real value.
- Not deployed to a public network. It runs on a local Hardhat network. Deploying to Sepolia is supported by `scripts/deploy.js` but has not been done.
- No integrations with DTCC, Securitize, custodians, or a real KYC provider. The "claim issuer" here is a contract we control, standing in for a regulated KYC provider.
- The T-REX contracts are the work of the ERC-3643 Association / Tokeny. We did not write or change them. What we show here is deploying, configuring and extending them correctly.

## How it works

```
Investor wallet ──▶ ONCHAINID identity ◀── signed KYC claim from trusted issuer
        │                                              │
        ▼                                              ▼
 Identity Registry ── checks claim topics + trusted issuers ──▶ isVerified(wallet)
        │
        ▼
     Token.transfer ──▶ isVerified(to)  AND  ModularCompliance.canTransfer(from, to, amount)
                                                    │
                                   CountryAllowModule, MaxBalanceModule, HoldingPeriodModule, ...
```

A transfer succeeds only if the recipient is verified (identity registered, holds a valid claim from a trusted issuer on every required topic) and every bound compliance module allows it. Agents can also pause, freeze, force-transfer, burn and recover wallets, as the standard defines.

## Custom module: HoldingPeriodModule

`contracts/modules/HoldingPeriodModule.sol` blocks a holder from sending tokens until a configurable period has passed since they last received tokens. State is kept per compliance contract, so one deployed module can serve many tokens. It is configured through `ModularCompliance.callModuleFunction`, like the built-in T-REX modules.

Known simplifications:

- The period runs from the holder's **last receipt** and covers their **whole balance**. It is not per-lot (FIFO) tracking. A production lockup such as a Rule 144 style holding period would need per-lot accounting.
- Issuance (mint) and burn are not restricted.
- Agent forced transfers bypass compliance checks by design in T-REX.

## Quick start

Requires Node.js 18+.

```bash
npm install
npm test                           # 25 tests
npx hardhat run scripts/demo.js    # narrated walkthrough on a local chain
npm run deploy:local               # deploy to the in-process network
```

To deploy to a persistent local node: run `npx hardhat node` in one terminal, then `npx hardhat run scripts/deploy.js --network localhost`.

## What the tests cover

- Deployment through `TREXFactory`: wiring of token, registry, compliance and ONCHAINID.
- Identity verification: mint to verified investor; reject unregistered investor; reject identity without a claim; claim revocation by the issuer.
- Transfers: allowed between verified investors; blocked to unverified recipients; blocked while paused.
- Agent controls: freeze wallet, partial freeze, forced transfer, burn, wallet recovery to a new key on the same ONCHAINID.
- Modules: official `CountryAllowModule`, ownership checks on binding, and the custom `HoldingPeriodModule` (lock, release over time, recipient re-lock, issuance, forced transfer, access control, disabling).

## Project layout

```
contracts/Imports.sol                     compiles the official T-REX contracts
contracts/modules/HoldingPeriodModule.sol custom compliance module
scripts/lib/suite.js                      shared deployment logic
scripts/deploy.js                         deploy infrastructure + demo token
scripts/demo.js                           narrated walkthrough
test/                                     Hardhat tests
```

## Versions

- Solidity 0.8.17 (the version T-REX v4.1.x targets), OpenZeppelin 4.9.6
- Hardhat 2.29.1, ethers v6
- `@tokenysolutions/t-rex` 4.1.6, `@onchain-id/solidity` 2.2.1

## Relationship to `rwa-tokenization`

[`rwa-tokenization`](https://github.com/blocknetics/rwa-tokenization) is a separate, MIT-licensed reference architecture with its own simplified compliance contracts and workflow models. It follows the ERC-3643 pattern (identity registry plus compliance rules) but does not use the official ERC-3643 contracts. This repository uses the official ones.

## License

GPL-3.0, because it builds on and ships with the GPL-3.0 T-REX contracts. See `LICENSE`. If you plan to reuse this code in commercial or closed-source work, get legal advice on the GPL obligations first, or ask Tokeny about commercial terms for T-REX.

## Credits

ERC-3643 and T-REX: the [ERC-3643 Association](https://www.erc3643.org/) and Tokeny. Identity layer: [ONCHAINID](https://github.com/onchain-id/solid).
