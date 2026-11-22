// SPDX-License-Identifier: MIT
// Derived from Chainlink BatchVRFCoordinatorV2Plus.sol (smartcontractkit/chainlink-evm@e162754, MIT).
pragma solidity 0.8.19;

import {VRFTypes} from "./libraries/VRFTypes.sol";

interface IArcVRFCoordinatorFulfill {
  function fulfillRandomWords(VRFTypes.Proof calldata proof, VRFTypes.RequestCommitmentV2Plus calldata rc, bool onlyPremium)
    external
    returns (uint96);
}

/// @notice Lets the node submit several fulfilments in one transaction; one failure doesn't block the rest.
contract BatchArcVRFCoordinator {
  IArcVRFCoordinatorFulfill public immutable COORDINATOR;

  event ErrorReturned(uint256 indexed requestId, string reason);
  event RawErrorReturned(uint256 indexed requestId, bytes lowLevelData);

  constructor(address coordinatorAddr) {
    COORDINATOR = IArcVRFCoordinatorFulfill(coordinatorAddr);
  }

  function fulfillRandomWords(VRFTypes.Proof[] calldata proofs, VRFTypes.RequestCommitmentV2Plus[] calldata rcs)
    external
  {
    require(proofs.length == rcs.length, "input array arg lengths mismatch");
    for (uint256 i = 0; i < proofs.length; ++i) {
      try COORDINATOR.fulfillRandomWords(proofs[i], rcs[i], false) returns (uint96 /* payment */ ) {
        continue;
      } catch Error(string memory reason) {
        emit ErrorReturned(_getRequestIdFromProof(proofs[i]), reason);
      } catch (bytes memory lowLevelData) {
        emit RawErrorReturned(_getRequestIdFromProof(proofs[i]), lowLevelData);
      }
    }
  }

  function _getRequestIdFromProof(VRFTypes.Proof memory proof) internal pure returns (uint256) {
    bytes32 keyHash = keccak256(abi.encode(proof.pk));
    return uint256(keccak256(abi.encode(keyHash, proof.seed)));
  }
}
