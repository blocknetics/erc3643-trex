// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@tokenysolutions/t-rex/contracts/compliance/modular/modules/AbstractModule.sol";

/// @title HoldingPeriodModule
/// @notice Custom ERC-3643 compliance module (Blocknetics). Blocks a holder from transferring
///         tokens until a configurable holding period has passed since they last received tokens.
/// @dev Built on T-REX `AbstractModule`; state is kept per bound compliance contract, so one
///      deployed module can serve many tokens. Settings are changed through the compliance
///      contract (`ModularCompliance.callModuleFunction`), the same way the built-in T-REX modules work.
///
///      Simplification (deliberate, documented): the period is measured from the holder's LAST
///      receipt and applies to their whole balance. It is not per-lot (FIFO) tracking. A
///      production lockup (for example Rule 144 style) would need per-lot accounting.
///      Mints and burns are not restricted. Agent forced transfers bypass compliance checks in T-REX
///      by design, but still update the recipient's receipt time through the transfer action.
contract HoldingPeriodModule is AbstractModule {
    /// compliance => holding period in seconds (0 means no restriction)
    mapping(address => uint256) private _holdingPeriod;
    /// compliance => holder => timestamp of last receipt
    mapping(address => mapping(address => uint256)) private _lastReceived;

    event HoldingPeriodSet(address indexed compliance, uint256 periodSeconds);

    /// @notice Set the holding period for the calling compliance contract.
    function setHoldingPeriod(uint256 _periodSeconds) external onlyComplianceCall {
        _holdingPeriod[msg.sender] = _periodSeconds;
        emit HoldingPeriodSet(msg.sender, _periodSeconds);
    }

    function moduleTransferAction(address, address _to, uint256) external override onlyComplianceCall {
        _lastReceived[msg.sender][_to] = block.timestamp;
    }

    function moduleMintAction(address _to, uint256) external override onlyComplianceCall {
        _lastReceived[msg.sender][_to] = block.timestamp;
    }

    // solhint-disable-next-line no-empty-blocks
    function moduleBurnAction(address, uint256) external override onlyComplianceCall {}

    function moduleCheck(
        address _from,
        address,
        uint256,
        address _compliance
    ) external view override returns (bool) {
        // T-REX also runs canTransfer for mints with _from == address(0); issuance is never locked.
        if (_from == address(0)) {
            return true;
        }
        uint256 period = _holdingPeriod[_compliance];
        if (period == 0) {
            return true;
        }
        return block.timestamp >= _lastReceived[_compliance][_from] + period;
    }

    function getHoldingPeriod(address _compliance) external view returns (uint256) {
        return _holdingPeriod[_compliance];
    }

    function lastReceived(address _compliance, address _holder) external view returns (uint256) {
        return _lastReceived[_compliance][_holder];
    }

    function canComplianceBind(address) external pure override returns (bool) {
        return true;
    }

    function isPlugAndPlay() external pure override returns (bool) {
        return true;
    }

    function name() public pure override returns (string memory) {
        return "HoldingPeriodModule";
    }
}
