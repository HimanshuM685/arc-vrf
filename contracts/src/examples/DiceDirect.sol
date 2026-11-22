// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ArcVRFWrapperConsumerBase} from "../ArcVRFWrapperConsumerBase.sol";
import {ArcVRFClient} from "../libraries/ArcVRFClient.sol";

/// @notice Direct-funding sample. The player sends USDC with roll(); the contract pays the wrapper
/// and refunds the change. No subscription needed.
contract DiceDirect is ArcVRFWrapperConsumerBase {
  uint32 public constant CALLBACK_GAS_LIMIT = 100_000;

  mapping(uint256 requestId => address player) public s_players;

  event DiceRolled(uint256 indexed requestId, address indexed player, uint256 paid);
  event DiceLanded(uint256 indexed requestId, address indexed player, uint8 result);

  error RefundFailed();

  constructor(address wrapper) ArcVRFWrapperConsumerBase(wrapper) {}

  /// @notice Current price in USDC (18 decimals) at this tx's gas price; send at least this.
  function quote() external view returns (uint256) {
    return i_vrfWrapper.calculateRequestPriceNative(CALLBACK_GAS_LIMIT, 1);
  }

  function roll() external payable returns (uint256 requestId) {
    uint256 price;
    (requestId, price) = requestRandomnessPayInNative(CALLBACK_GAS_LIMIT, 0, 1, ArcVRFClient.nativeExtraArgs());
    s_players[requestId] = msg.sender;
    emit DiceRolled(requestId, msg.sender, price);
    // requestRandomnessPayInNative spends from this contract's balance; return the player's change.
    if (msg.value > price) {
      (bool ok,) = msg.sender.call{value: msg.value - price}("");
      if (!ok) revert RefundFailed();
    }
  }

  function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
    uint8 result = uint8(randomWords[0] % 6) + 1;
    emit DiceLanded(requestId, s_players[requestId], result);
    delete s_players[requestId];
  }
}
