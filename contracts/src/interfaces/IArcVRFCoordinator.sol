// SPDX-License-Identifier: MIT
// Derived from Chainlink IVRFCoordinatorV2Plus / IVRFSubscriptionV2Plus (chainlink-evm@e162754, MIT).
pragma solidity ^0.8.0;

import {ArcVRFClient} from "../libraries/ArcVRFClient.sol";

interface IArcVRFSubscription {
  function addConsumer(uint256 subId, address consumer) external;
  function removeConsumer(uint256 subId, address consumer) external;
  function cancelSubscription(uint256 subId, address to) external;
  function acceptSubscriptionOwnerTransfer(uint256 subId) external;
  function requestSubscriptionOwnerTransfer(uint256 subId, address newOwner) external;
  function createSubscription() external returns (uint256 subId);
  /// @dev `balance` (the LINK slot in Chainlink) is always 0 on Arc; kept for ABI compatibility.
  function getSubscription(uint256 subId)
    external
    view
    returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] memory consumers);
  function pendingRequestExists(uint256 subId) external view returns (bool);
  function getActiveSubscriptionIds(uint256 startIndex, uint256 maxCount) external view returns (uint256[] memory);
  function fundSubscriptionWithNative(uint256 subId) external payable;
}

interface IArcVRFCoordinator is IArcVRFSubscription {
  function requestRandomWords(ArcVRFClient.RandomWordsRequest calldata req) external returns (uint256 requestId);
}
