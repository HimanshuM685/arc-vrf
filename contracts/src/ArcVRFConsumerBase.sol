// SPDX-License-Identifier: MIT
// Derived from Chainlink VRFConsumerBaseV2Plus.sol (smartcontractkit/chainlink-evm@e162754, MIT).
// Arc change: coordinator migration hook removed; owner can still point at a new coordinator.
pragma solidity ^0.8.4;

import {ConfirmedOwner} from "./vendor/ConfirmedOwner.sol";
import {IArcVRFCoordinator} from "./interfaces/IArcVRFCoordinator.sol";

/**
 * @notice Inherit this to receive Arc VRF randomness via a subscription.
 * @dev Usage:
 *   1. Create + fund a subscription, add this contract as a consumer.
 *   2. Call s_vrfCoordinator.requestRandomWords(ArcVRFClient.RandomWordsRequest(...)).
 *   3. Implement fulfillRandomWords(requestId, randomWords). It must not revert:
 *      a reverting callback is not retried and the subscription is still charged.
 *   Never re-request randomness because a callback has not arrived yet, and never
 *   accept user input that depends on the result after the request is made.
 */
abstract contract ArcVRFConsumerBase is ConfirmedOwner {
  error OnlyCoordinatorCanFulfill(address have, address want);
  error ZeroAddress();

  event CoordinatorSet(address vrfCoordinator);

  IArcVRFCoordinator public s_vrfCoordinator;

  constructor(address _vrfCoordinator) ConfirmedOwner(msg.sender) {
    if (_vrfCoordinator == address(0)) {
      revert ZeroAddress();
    }
    s_vrfCoordinator = IArcVRFCoordinator(_vrfCoordinator);
  }

  /// @notice Handles the VRF response. Must not revert.
  function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal virtual;

  /// @notice Called by the coordinator only.
  function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
    if (msg.sender != address(s_vrfCoordinator)) {
      revert OnlyCoordinatorCanFulfill(msg.sender, address(s_vrfCoordinator));
    }
    fulfillRandomWords(requestId, randomWords);
  }

  function setCoordinator(address _vrfCoordinator) external onlyOwner {
    if (_vrfCoordinator == address(0)) {
      revert ZeroAddress();
    }
    s_vrfCoordinator = IArcVRFCoordinator(_vrfCoordinator);
    emit CoordinatorSet(_vrfCoordinator);
  }
}
