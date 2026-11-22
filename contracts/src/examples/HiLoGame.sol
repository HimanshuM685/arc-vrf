// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ArcVRFConsumerBase} from "../ArcVRFConsumerBase.sol";
import {ArcVRFClient} from "../libraries/ArcVRFClient.sol";

/// @notice Subscription-method sample. Guess whether the next ball (1-20) is higher or lower
/// than the current one. Add this contract as a consumer of a funded subscription.
contract HiLoGame is ArcVRFConsumerBase {
  enum Guess { Lo, Hi }

  struct Round {
    address player;
    uint8 previousBall;
    Guess guess;
  }

  bytes32 public s_keyHash;
  uint256 public s_subId;
  uint32 public s_callbackGasLimit = 100_000;
  uint8 public s_currentBall = 10;
  mapping(uint256 requestId => Round) public s_rounds;

  event RoundRequested(uint256 indexed requestId, address indexed player, uint8 previousBall, Guess guess);
  event RoundSettled(
    uint256 indexed requestId, address indexed player, uint8 previousBall, uint8 newBall, Guess guess, bool won
  );

  constructor(address coordinator, bytes32 keyHash, uint256 subId) ArcVRFConsumerBase(coordinator) {
    s_keyHash = keyHash;
    s_subId = subId;
  }

  function setSubscription(bytes32 keyHash, uint256 subId) external onlyOwner {
    s_keyHash = keyHash;
    s_subId = subId;
  }

  function play(Guess guess) external returns (uint256 requestId) {
    requestId = s_vrfCoordinator.requestRandomWords(
      ArcVRFClient.RandomWordsRequest({
        keyHash: s_keyHash,
        subId: s_subId,
        requestConfirmations: 0, // Arc finalises on inclusion
        callbackGasLimit: s_callbackGasLimit,
        numWords: 1,
        extraArgs: ArcVRFClient.nativeExtraArgs()
      })
    );
    s_rounds[requestId] = Round({player: msg.sender, previousBall: s_currentBall, guess: guess});
    emit RoundRequested(requestId, msg.sender, s_currentBall, guess);
  }

  function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
    Round memory round = s_rounds[requestId];
    uint8 newBall = uint8(randomWords[0] % 20) + 1;
    bool won = round.guess == Guess.Hi ? newBall > round.previousBall : newBall < round.previousBall;
    s_currentBall = newBall;
    delete s_rounds[requestId];
    emit RoundSettled(requestId, round.player, round.previousBall, newBall, round.guess, won);
  }
}
