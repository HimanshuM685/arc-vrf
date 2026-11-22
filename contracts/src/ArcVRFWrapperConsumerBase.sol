// SPDX-License-Identifier: MIT
// Derived from Chainlink VRFV2PlusWrapperConsumerBase.sol (smartcontractkit/chainlink-evm@e162754, MIT).
// Arc change: LINK path (requestRandomness / transferAndCall) removed; native USDC only.
pragma solidity ^0.8.0;

import {IArcVRFWrapper} from "./interfaces/IArcVRFWrapper.sol";

/**
 * @notice Inherit this to pay per request (direct funding) instead of keeping a subscription.
 * @dev The contract pays the wrapper from its own native USDC balance, so it must hold enough
 * USDC (or receive it with the call that requests). The price is quoted at the request
 * transaction's gas price. A reverting callback is not retried and not refunded.
 */
abstract contract ArcVRFWrapperConsumerBase {
  error OnlyVRFWrapperCanFulfill(address have, address want);

  IArcVRFWrapper public immutable i_vrfWrapper;

  constructor(address _vrfWrapper) {
    i_vrfWrapper = IArcVRFWrapper(_vrfWrapper);
  }

  /// @return requestId wrapper request id
  /// @return requestPrice USDC (18 decimals) paid to the wrapper
  function requestRandomnessPayInNative(
    uint32 _callbackGasLimit,
    uint16 _requestConfirmations,
    uint32 _numWords,
    bytes memory extraArgs
  ) internal returns (uint256 requestId, uint256 requestPrice) {
    requestPrice = i_vrfWrapper.calculateRequestPriceNative(_callbackGasLimit, _numWords);
    return (
      i_vrfWrapper.requestRandomWordsInNative{value: requestPrice}(
        _callbackGasLimit, _requestConfirmations, _numWords, extraArgs
      ),
      requestPrice
    );
  }

  /// @notice Handles the VRF response. Must not revert.
  function fulfillRandomWords(uint256 _requestId, uint256[] memory _randomWords) internal virtual;

  function rawFulfillRandomWords(uint256 _requestId, uint256[] memory _randomWords) external {
    address vrfWrapperAddr = address(i_vrfWrapper);
    if (msg.sender != vrfWrapperAddr) {
      revert OnlyVRFWrapperCanFulfill(msg.sender, vrfWrapperAddr);
    }
    fulfillRandomWords(_requestId, _randomWords);
  }
}
