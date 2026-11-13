// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

// This file only exists so Hardhat compiles the official T-REX (ERC-3643) contracts
// from node_modules and produces artifacts for them. No T-REX code is modified.

import "@tokenysolutions/t-rex/contracts/registry/implementation/ClaimTopicsRegistry.sol";
import "@tokenysolutions/t-rex/contracts/registry/implementation/TrustedIssuersRegistry.sol";
import "@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistryStorage.sol";
import "@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol";
import "@tokenysolutions/t-rex/contracts/compliance/modular/ModularCompliance.sol";
import "@tokenysolutions/t-rex/contracts/token/Token.sol";
import "@tokenysolutions/t-rex/contracts/proxy/authority/TREXImplementationAuthority.sol";
import "@tokenysolutions/t-rex/contracts/factory/TREXFactory.sol";
import "@tokenysolutions/t-rex/contracts/compliance/modular/modules/ModuleProxy.sol";
import "@tokenysolutions/t-rex/contracts/compliance/modular/modules/CountryAllowModule.sol";
import "@tokenysolutions/t-rex/contracts/compliance/modular/modules/MaxBalanceModule.sol";
