// SPDX-License-Identifier: MIT
// Derived from Chainlink VRFV2PlusClient.sol (smartcontractkit/chainlink-evm@e162754, MIT).
pragma solidity ^0.8.4;

/// @notice Request types for Arc VRF. Same shapes and encoding as Chainlink VRF v2.5,
/// so v2.5 consumer code ports by swapping imports.
library ArcVRFClient {
  // extraArgs version tag, identical to Chainlink's: bytes4(keccak256("VRF ExtraArgsV1")) = 0x92fd1338
  bytes4 public constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));

  /// @dev Arc VRF only bills in native USDC. nativePayment must be true (or extraArgs empty).
  struct ExtraArgsV1 {
    bool nativePayment;
  }

  struct RandomWordsRequest {
    bytes32 keyHash;
    uint256 subId;
    uint16 requestConfirmations;
    uint32 callbackGasLimit;
    uint32 numWords;
    bytes extraArgs;
  }

  function _argsToBytes(
    ExtraArgsV1 memory extraArgs
  ) internal pure returns (bytes memory bts) {
    return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, extraArgs);
  }

  /// @notice Convenience: the only extraArgs Arc VRF needs.
  function nativeExtraArgs() internal pure returns (bytes memory) {
    return _argsToBytes(ExtraArgsV1({nativePayment: true}));
  }
}
