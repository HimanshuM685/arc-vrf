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
  error InsufficientPayment(uint256 paid, uint256 price);

  constructor(address wrapper) ArcVRFWrapperConsumerBase(wrapper) {}

  /// @notice Price in USDC (18 decimals) at a given gas price. Quote at your transaction's
  /// maxFeePerGas (at least 20 gwei on Arc) and send at least this much with roll().
  function quote(uint256 gasPriceWei) external view returns (uint256) {
    return i_vrfWrapper.estimateRequestPriceNative(CALLBACK_GAS_LIMIT, 1, gasPriceWei);
  }

  function roll() external payable returns (uint256 requestId) {
    // The player must cover the price; never spend USDC that happens to sit in this contract.
    uint256 price = i_vrfWrapper.calculateRequestPriceNative(CALLBACK_GAS_LIMIT, 1);
    if (msg.value < price) revert InsufficientPayment(msg.value, price);
    (requestId,) = requestRandomnessPayInNative(CALLBACK_GAS_LIMIT, 0, 1, ArcVRFClient.nativeExtraArgs());
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
