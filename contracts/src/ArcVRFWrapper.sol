// SPDX-License-Identifier: MIT
// Derived from Chainlink VRFV2PlusWrapper.sol (smartcontractkit/chainlink-evm@e162754, MIT).
// Arc changes: native USDC path only (onTokenTransfer, LINK feed and LINK pricing removed),
// WrapperRequestMade event so dashboards can attribute requests to the paying consumer.
pragma solidity 0.8.19;

import {ITypeAndVersion} from "./vendor/ITypeAndVersion.sol";
import {ArcVRFConsumerBase} from "./ArcVRFConsumerBase.sol";
import {ArcVRFWrapperConsumerBase} from "./ArcVRFWrapperConsumerBase.sol";
import {IArcVRFWrapper} from "./interfaces/IArcVRFWrapper.sol";
import {ArcVRFClient} from "./libraries/ArcVRFClient.sol";

/**
 * @notice Direct funding: consumers pay per request in native USDC; the wrapper requests from the
 * coordinator using its own subscription (created and funded by the operator, with this wrapper
 * added as a consumer). Payments stay here until the owner withdraws them.
 */
contract ArcVRFWrapper is ArcVRFConsumerBase, ITypeAndVersion, IArcVRFWrapper {
  event WrapperFulfillmentFailed(uint256 indexed requestId, address indexed consumer);
  event WrapperRequestMade(uint256 indexed requestId, address indexed consumer, uint256 paid);

  uint8 private constant PREMIUM_PERCENTAGE_MAX = 155;
  // 5k is plenty for an EXTCODESIZE call (2600) + warm CALL (100) and some arithmetic.
  uint256 private constant GAS_FOR_CALL_EXACT_CHECK = 5000;

  /// @notice Coordinator subscription this wrapper requests with.
  uint256 public immutable SUBSCRIPTION_ID;

  event ConfigSet(
    uint32 wrapperGasOverhead,
    uint32 coordinatorGasOverheadNative,
    uint16 coordinatorGasOverheadPerWord,
    uint8 coordinatorNativePremiumPercentage,
    bytes32 keyHash,
    uint8 maxNumWords,
    uint32 fulfillmentFlatFeeNativePPM
  );
  event NativeWithdrawn(address indexed to, uint256 amount);
  event Enabled();
  event Disabled();

  error InvalidPremiumPercentage(uint8 premiumPercentage, uint8 max);
  error SubscriptionIdMissing();
  error FeeTooLow(uint256 paid, uint256 price);
  error NumWordsTooHigh(uint32 have, uint8 max);
  error NotConfigured();
  error IsDisabled();
  error FailedToWithdraw();

  bool public s_configured;
  bool public s_disabled;
  uint8 internal s_maxNumWords;
  bytes32 internal s_keyHash;
  // Gas used by the wrapper's own fulfillRandomWords around the consumer callback.
  uint32 private s_wrapperGasOverhead;
  // Gas used by the coordinator's fulfillRandomWords outside the callback.
  uint32 private s_coordinatorGasOverheadNative;
  uint16 private s_coordinatorGasOverheadPerWord;
  uint32 private s_fulfillmentFlatFeeNativePPM;
  uint8 private s_coordinatorNativePremiumPercentage;

  struct Callback {
    address callbackAddress;
    uint32 callbackGasLimit;
    uint64 requestGasPrice;
  }

  mapping(uint256 requestId => Callback) public s_callbacks;

  constructor(address _coordinator, uint256 _subId) ArcVRFConsumerBase(_coordinator) {
    if (_subId == 0) {
      revert SubscriptionIdMissing();
    }
    // Reverts if the subscription doesn't exist.
    s_vrfCoordinator.getSubscription(_subId);
    SUBSCRIPTION_ID = _subId;
  }

  /**
   * @param _wrapperGasOverhead gas used by the wrapper around the consumer callback
   * @param _coordinatorGasOverheadNative coordinator fulfilment gas outside the callback
   * @param _coordinatorGasOverheadPerWord extra coordinator gas per random word
   * @param _coordinatorNativePremiumPercentage premium charged on top of gas, in percent
   * @param _keyHash gas lane used for all wrapper requests
   * @param _maxNumWords max words per wrapper request
   * @param _fulfillmentFlatFeeNativePPM flat fee per request in millionths of USDC
   */
  function setConfig(
    uint32 _wrapperGasOverhead,
    uint32 _coordinatorGasOverheadNative,
    uint16 _coordinatorGasOverheadPerWord,
    uint8 _coordinatorNativePremiumPercentage,
    bytes32 _keyHash,
    uint8 _maxNumWords,
    uint32 _fulfillmentFlatFeeNativePPM
  ) external onlyOwner {
    if (_coordinatorNativePremiumPercentage > PREMIUM_PERCENTAGE_MAX) {
      revert InvalidPremiumPercentage(_coordinatorNativePremiumPercentage, PREMIUM_PERCENTAGE_MAX);
    }
    s_wrapperGasOverhead = _wrapperGasOverhead;
    s_coordinatorGasOverheadNative = _coordinatorGasOverheadNative;
    s_coordinatorGasOverheadPerWord = _coordinatorGasOverheadPerWord;
    s_coordinatorNativePremiumPercentage = _coordinatorNativePremiumPercentage;
    s_keyHash = _keyHash;
    s_maxNumWords = _maxNumWords;
    s_fulfillmentFlatFeeNativePPM = _fulfillmentFlatFeeNativePPM;
    s_configured = true;

    emit ConfigSet(
      _wrapperGasOverhead,
      _coordinatorGasOverheadNative,
      _coordinatorGasOverheadPerWord,
      _coordinatorNativePremiumPercentage,
      _keyHash,
      _maxNumWords,
      _fulfillmentFlatFeeNativePPM
    );
  }

  function getConfig()
    external
    view
    returns (
      uint32 fulfillmentFlatFeeNativePPM,
      uint32 wrapperGasOverhead,
      uint32 coordinatorGasOverheadNative,
      uint16 coordinatorGasOverheadPerWord,
      uint8 wrapperNativePremiumPercentage,
      bytes32 keyHash,
      uint8 maxNumWords
    )
  {
    return (
      s_fulfillmentFlatFeeNativePPM,
      s_wrapperGasOverhead,
      s_coordinatorGasOverheadNative,
      s_coordinatorGasOverheadPerWord,
      s_coordinatorNativePremiumPercentage,
      s_keyHash,
      s_maxNumWords
    );
  }

  /// @notice Price in USDC (18 decimals) at this transaction's gas price.
  function calculateRequestPriceNative(uint32 _callbackGasLimit, uint32 _numWords)
    external
    view
    override
    onlyConfiguredNotDisabled
    returns (uint256)
  {
    return _calculateRequestPriceNative(_callbackGasLimit, _numWords, tx.gasprice);
  }

  /// @notice Price in USDC (18 decimals) at a given gas price. Use for off-chain quotes.
  function estimateRequestPriceNative(uint32 _callbackGasLimit, uint32 _numWords, uint256 _requestGasPriceWei)
    external
    view
    override
    onlyConfiguredNotDisabled
    returns (uint256)
  {
    return _calculateRequestPriceNative(_callbackGasLimit, _numWords, _requestGasPriceWei);
  }

  /// @dev price = gasPrice * wrapperGasOverhead
  ///   + gasPrice * (callbackGasLimit + coordOverhead + numWords * perWord) * (100 + premium) / 100
  ///   + 1e12 * flatFeePPM
  function _calculateRequestPriceNative(uint256 _gas, uint32 _numWords, uint256 _requestGasPrice)
    internal
    view
    returns (uint256)
  {
    uint256 wrapperCostWei = _requestGasPrice * s_wrapperGasOverhead;
    uint256 coordinatorCostWei = _requestGasPrice * (_gas + _getCoordinatorGasOverhead(_numWords));
    uint256 coordinatorCostWithPremiumAndFlatFeeWei = ((coordinatorCostWei * (s_coordinatorNativePremiumPercentage + 100))
      / 100) + (1e12 * uint256(s_fulfillmentFlatFeeNativePPM));
    return wrapperCostWei + coordinatorCostWithPremiumAndFlatFeeWei;
  }

  /**
   * @notice Pay and request in one call. msg.value must cover calculateRequestPriceNative;
   * any excess is kept as fee.
   * @param extraArgs empty or ArcVRFClient.nativeExtraArgs(); nativePayment=false reverts.
   */
  function requestRandomWordsInNative(
    uint32 _callbackGasLimit,
    uint16 _requestConfirmations,
    uint32 _numWords,
    bytes calldata extraArgs
  ) external payable override onlyConfiguredNotDisabled returns (uint256 requestId) {
    if (_numWords > s_maxNumWords) revert NumWordsTooHigh(_numWords, s_maxNumWords);
    uint256 price = _calculateRequestPriceNative(_callbackGasLimit, _numWords, tx.gasprice);
    if (msg.value < price) revert FeeTooLow(msg.value, price);
    uint32 eip150Overhead = _getEIP150Overhead(_callbackGasLimit);
    ArcVRFClient.RandomWordsRequest memory req = ArcVRFClient.RandomWordsRequest({
      keyHash: s_keyHash,
      subId: SUBSCRIPTION_ID,
      requestConfirmations: _requestConfirmations,
      callbackGasLimit: _callbackGasLimit + eip150Overhead + s_wrapperGasOverhead,
      numWords: _numWords,
      extraArgs: extraArgs // validated by the coordinator
    });
    requestId = s_vrfCoordinator.requestRandomWords(req);
    s_callbacks[requestId] = Callback({
      callbackAddress: msg.sender,
      callbackGasLimit: _callbackGasLimit,
      requestGasPrice: uint64(tx.gasprice)
    });
    emit WrapperRequestMade(requestId, msg.sender, msg.value);
    return requestId;
  }

  /// @notice Withdraw collected fees. The operator uses them to keep the wrapper's subscription funded.
  function withdrawNative(address _recipient) external onlyOwner {
    uint256 amount = address(this).balance;
    (bool success,) = payable(_recipient).call{value: amount}("");
    if (!success) revert FailedToWithdraw();
    emit NativeWithdrawn(_recipient, amount);
  }

  function enable() external onlyOwner {
    s_disabled = false;
    emit Enabled();
  }

  function disable() external onlyOwner {
    s_disabled = true;
    emit Disabled();
  }

  /// @dev Never reverts on consumer failure: logs WrapperFulfillmentFailed instead (no refund).
  function fulfillRandomWords(uint256 _requestId, uint256[] calldata _randomWords) internal override {
    Callback memory callback = s_callbacks[_requestId];
    delete s_callbacks[_requestId];

    address callbackAddress = callback.callbackAddress;
    require(callbackAddress != address(0), "request not found"); // should never happen

    bytes memory resp =
      abi.encodeWithSelector(ArcVRFWrapperConsumerBase.rawFulfillRandomWords.selector, _requestId, _randomWords);

    bool success = _callWithExactGas(callback.callbackGasLimit, callbackAddress, resp);
    if (!success) {
      emit WrapperFulfillmentFailed(_requestId, callbackAddress);
    }
  }

  function _getEIP150Overhead(uint32 gas) private pure returns (uint32) {
    return gas / 63 + 1;
  }

  /// @dev uint256 so quoting a large numWords can't overflow (callers check maxNumWords separately).
  function _getCoordinatorGasOverhead(uint32 numWords) internal view returns (uint256) {
    return uint256(s_coordinatorGasOverheadNative) + uint256(numWords) * s_coordinatorGasOverheadPerWord;
  }

  function _callWithExactGas(uint256 gasAmount, address target, bytes memory data) private returns (bool success) {
    assembly {
      let g := gas()
      if lt(g, GAS_FOR_CALL_EXACT_CHECK) { revert(0, 0) }
      g := sub(g, GAS_FOR_CALL_EXACT_CHECK)
      if iszero(gt(sub(g, div(g, 64)), gasAmount)) { revert(0, 0) }
      if iszero(extcodesize(target)) { revert(0, 0) }
      success := call(gasAmount, target, 0, add(data, 0x20), mload(data), 0, 0)
    }
    return success;
  }

  function typeAndVersion() external pure virtual override returns (string memory) {
    return "ArcVRFWrapper 1.0.0";
  }

  modifier onlyConfiguredNotDisabled() {
    if (!s_configured) revert NotConfigured();
    if (s_disabled) revert IsDisabled();
    _;
  }
}
