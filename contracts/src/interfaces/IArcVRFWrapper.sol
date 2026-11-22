// SPDX-License-Identifier: MIT
// Derived from Chainlink IVRFV2PlusWrapper (chainlink-evm@e162754, MIT). LINK functions removed.
pragma solidity ^0.8.0;

interface IArcVRFWrapper {
  function calculateRequestPriceNative(uint32 _callbackGasLimit, uint32 _numWords) external view returns (uint256);
  function estimateRequestPriceNative(uint32 _callbackGasLimit, uint32 _numWords, uint256 _requestGasPriceWei)
    external
    view
    returns (uint256);
  function requestRandomWordsInNative(
    uint32 _callbackGasLimit,
    uint16 _requestConfirmations,
    uint32 _numWords,
    bytes calldata extraArgs
  ) external payable returns (uint256 requestId);
}
