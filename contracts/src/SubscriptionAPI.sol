// SPDX-License-Identifier: MIT
// Derived from Chainlink SubscriptionAPI.sol (smartcontractkit/chainlink-evm@e162754, MIT).
// Arc changes: native USDC only (LINK token, LINK feed, onTokenTransfer removed), owner indexed in
// SubscriptionCreated, cancellation refunds fall back to pull-based withdrawal when a send fails
// (Arc's USDC blocklist can revert native transfers).
pragma solidity 0.8.19;

import {ConfirmedOwner} from "./vendor/ConfirmedOwner.sol";
import {EnumerableSet} from "./vendor/EnumerableSet.sol";
import {IArcVRFSubscription} from "./interfaces/IArcVRFCoordinator.sol";

abstract contract SubscriptionAPI is ConfirmedOwner, IArcVRFSubscription {
  using EnumerableSet for EnumerableSet.UintSet;

  // Bound so we can loop over consumers. Use multiple subscriptions for more.
  uint16 public constant MAX_CONSUMERS = 100;

  error TooManyConsumers();
  error InsufficientBalance();
  error InvalidConsumer(uint256 subId, address consumer);
  error InvalidSubscription();
  error MustBeSubOwner(address owner);
  error PendingRequestExists();
  error MustBeRequestedOwner(address proposedOwner);
  error BalanceInvariantViolated(uint256 internalBalance, uint256 externalBalance); // Should never happen
  error FailedToSendNative();
  error IndexOutOfRange();
  error Reentrant();
  error ZeroAddressRecipient();

  event NativeFundsRecovered(address to, uint256 amount);

  struct Subscription {
    // uint96 holds ~7.9e28 wei = 79 billion USDC (18 decimals).
    uint96 nativeBalance;
    uint64 reqCount;
  }

  struct SubscriptionConfig {
    address owner; // Owner can fund/withdraw/cancel the sub.
    address requestedOwner; // For safely transferring sub ownership.
    address[] consumers;
  }

  struct ConsumerConfig {
    bool active;
    uint64 nonce; // 0 = consumer never requested from this sub
    uint64 pendingReqCount;
  }

  mapping(address consumer => mapping(uint256 subId => ConsumerConfig)) internal s_consumers;
  mapping(uint256 subId => SubscriptionConfig) internal s_subscriptionConfigs;
  mapping(uint256 subId => Subscription) internal s_subscriptions;
  // Monotonic nonce used to construct subIds.
  uint64 public s_currentSubNonce;
  EnumerableSet.UintSet internal s_subIds;
  // Total native tracked through funding, cancellation, refunds and oracle withdrawals.
  // A discrepancy with address(this).balance means someone sent native directly; see recoverNativeFunds.
  uint96 public s_totalNativeBalance;
  uint96 internal s_withdrawableNative;
  // Cancellation refunds whose push transfer failed; claim with withdrawRefund().
  mapping(address => uint256) public s_pendingRefunds;

  event SubscriptionCreated(uint256 indexed subId, address indexed owner);
  event SubscriptionFundedWithNative(uint256 indexed subId, uint256 oldNativeBalance, uint256 newNativeBalance);
  event SubscriptionConsumerAdded(uint256 indexed subId, address consumer);
  event SubscriptionConsumerRemoved(uint256 indexed subId, address consumer);
  event SubscriptionCanceled(uint256 indexed subId, address to, uint256 amountNative);
  event SubscriptionOwnerTransferRequested(uint256 indexed subId, address from, address to);
  event SubscriptionOwnerTransferred(uint256 indexed subId, address from, address to);
  event RefundDeferred(address indexed to, uint256 amount);
  event RefundWithdrawn(address indexed holder, address recipient, uint256 amount);

  struct Config {
    uint16 minimumRequestConfirmations;
    uint32 maxGasLimit;
    // Reentrancy protection.
    bool reentrancyLock;
    // Gas to cover oracle payment bookkeeping after the gas measurement.
    uint32 gasAfterPaymentCalculation;
    // Flat fee charged per fulfillment in millionths of native USDC. Range [0, 2^32/10^6].
    uint32 fulfillmentFlatFeeNativePPM;
    // Percentage of gas cost added as premium. 10 = 10%.
    uint8 nativePremiumPercentage;
  }

  Config public s_config;

  modifier nonReentrant() {
    _nonReentrant();
    _;
  }

  function _nonReentrant() internal view {
    if (s_config.reentrancyLock) {
      revert Reentrant();
    }
  }

  function _requireSufficientBalance(bool condition) internal pure {
    if (!condition) {
      revert InsufficientBalance();
    }
  }

  function _requireValidSubscription(address subOwner) internal pure {
    if (subOwner == address(0)) {
      revert InvalidSubscription();
    }
  }

  constructor() ConfirmedOwner(msg.sender) {}

  /// @notice Owner cancels a subscription and refunds its owner. Can be called with pending requests.
  function ownerCancelSubscription(uint256 subId) external onlyOwner {
    address subOwner = s_subscriptionConfigs[subId].owner;
    _requireValidSubscription(subOwner);
    _cancelSubscriptionHelper(subId, subOwner);
  }

  /// @notice Recover native sent with transfer/call instead of fundSubscriptionWithNative.
  function recoverNativeFunds(address payable to) external onlyOwner {
    uint256 externalBalance = address(this).balance;
    uint256 internalBalance = uint256(s_totalNativeBalance);
    if (internalBalance > externalBalance) {
      revert BalanceInvariantViolated(internalBalance, externalBalance);
    }
    if (internalBalance < externalBalance) {
      uint256 amount = externalBalance - internalBalance;
      _mustSendNative(to, amount);
      emit NativeFundsRecovered(to, amount);
    }
  }

  /// @notice Withdraw native USDC earned by fulfilling requests.
  function withdrawNative(address payable recipient) external nonReentrant onlyOwner {
    uint96 amount = s_withdrawableNative;
    _requireSufficientBalance(amount > 0);
    s_withdrawableNative = 0;
    s_totalNativeBalance -= amount;
    _mustSendNative(recipient, amount);
  }

  /// @notice Amount of fees the operator can withdraw.
  function withdrawableNative() external view returns (uint96) {
    return s_withdrawableNative;
  }

  /// @notice Claim a cancellation refund whose push transfer failed, sending it to any address
  /// (the refund holder may itself be unable to receive native USDC).
  function withdrawRefund(address payable recipient) external nonReentrant {
    if (recipient == address(0)) revert ZeroAddressRecipient();
    uint256 amount = s_pendingRefunds[msg.sender];
    _requireSufficientBalance(amount > 0);
    s_pendingRefunds[msg.sender] = 0;
    s_totalNativeBalance -= uint96(amount);
    _mustSendNative(recipient, amount);
    emit RefundWithdrawn(msg.sender, recipient, amount);
  }

  function fundSubscriptionWithNative(uint256 subId) external payable override nonReentrant {
    _requireValidSubscription(s_subscriptionConfigs[subId].owner);
    // Anyone can fund a subscription.
    uint256 oldNativeBalance = s_subscriptions[subId].nativeBalance;
    s_subscriptions[subId].nativeBalance += uint96(msg.value);
    s_totalNativeBalance += uint96(msg.value);
    emit SubscriptionFundedWithNative(subId, oldNativeBalance, oldNativeBalance + msg.value);
  }

  function getSubscription(uint256 subId)
    public
    view
    override
    returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] memory consumers)
  {
    subOwner = s_subscriptionConfigs[subId].owner;
    _requireValidSubscription(subOwner);
    return (
      0,
      s_subscriptions[subId].nativeBalance,
      s_subscriptions[subId].reqCount,
      subOwner,
      s_subscriptionConfigs[subId].consumers
    );
  }

  function getActiveSubscriptionIds(uint256 startIndex, uint256 maxCount)
    external
    view
    override
    returns (uint256[] memory ids)
  {
    uint256 numSubs = s_subIds.length();
    if (startIndex >= numSubs) revert IndexOutOfRange();
    uint256 endIndex = startIndex + maxCount;
    endIndex = endIndex > numSubs || maxCount == 0 ? numSubs : endIndex;
    uint256 idsLength = endIndex - startIndex;
    ids = new uint256[](idsLength);
    for (uint256 idx = 0; idx < idsLength; ++idx) {
      ids[idx] = s_subIds.at(idx + startIndex);
    }
    return ids;
  }

  function createSubscription() external override nonReentrant returns (uint256 subId) {
    uint64 currentSubNonce = s_currentSubNonce;
    subId =
      uint256(keccak256(abi.encodePacked(msg.sender, blockhash(block.number - 1), address(this), currentSubNonce)));
    s_currentSubNonce = currentSubNonce + 1;
    address[] memory consumers = new address[](0);
    s_subscriptions[subId] = Subscription({nativeBalance: 0, reqCount: 0});
    s_subscriptionConfigs[subId] =
      SubscriptionConfig({owner: msg.sender, requestedOwner: address(0), consumers: consumers});
    s_subIds.add(subId);

    emit SubscriptionCreated(subId, msg.sender);
    return subId;
  }

  function requestSubscriptionOwnerTransfer(uint256 subId, address newOwner)
    external
    override
    onlySubOwner(subId)
    nonReentrant
  {
    SubscriptionConfig storage subscriptionConfig = s_subscriptionConfigs[subId];
    if (subscriptionConfig.requestedOwner != newOwner) {
      subscriptionConfig.requestedOwner = newOwner;
      emit SubscriptionOwnerTransferRequested(subId, msg.sender, newOwner);
    }
  }

  function acceptSubscriptionOwnerTransfer(uint256 subId) external override nonReentrant {
    address oldOwner = s_subscriptionConfigs[subId].owner;
    _requireValidSubscription(oldOwner);
    if (s_subscriptionConfigs[subId].requestedOwner != msg.sender) {
      revert MustBeRequestedOwner(s_subscriptionConfigs[subId].requestedOwner);
    }
    s_subscriptionConfigs[subId].owner = msg.sender;
    s_subscriptionConfigs[subId].requestedOwner = address(0);
    emit SubscriptionOwnerTransferred(subId, oldOwner, msg.sender);
  }

  /// @notice Pending owner of a subscription (address(0) if none).
  function getRequestedOwner(uint256 subId) external view returns (address) {
    return s_subscriptionConfigs[subId].requestedOwner;
  }

  function addConsumer(uint256 subId, address consumer) external override onlySubOwner(subId) nonReentrant {
    ConsumerConfig storage consumerConfig = s_consumers[consumer][subId];
    if (consumerConfig.active) {
      return; // idempotent
    }
    address[] storage consumers = s_subscriptionConfigs[subId].consumers;
    if (consumers.length == MAX_CONSUMERS) {
      revert TooManyConsumers();
    }
    consumerConfig.active = true;
    consumers.push(consumer);

    emit SubscriptionConsumerAdded(subId, consumer);
  }

  function _deleteSubscription(uint256 subId) internal returns (uint96 nativeBalance) {
    address[] storage consumers = s_subscriptionConfigs[subId].consumers;
    nativeBalance = s_subscriptions[subId].nativeBalance;
    uint256 consumersLength = consumers.length; // bounded by MAX_CONSUMERS
    for (uint256 i = 0; i < consumersLength; ++i) {
      delete s_consumers[consumers[i]][subId];
    }
    delete s_subscriptionConfigs[subId];
    delete s_subscriptions[subId];
    s_subIds.remove(subId);
    return nativeBalance;
  }

  /// @dev Never blocks cancellation: if the push transfer reverts (e.g. Arc blocklist), the refund
  /// stays in the contract and `to` can claim it with withdrawRefund().
  function _cancelSubscriptionHelper(uint256 subId, address to) internal {
    // Arc reverts native sends to address(0); a refund parked there could never be claimed.
    if (to == address(0)) revert ZeroAddressRecipient();
    uint96 nativeBalance = _deleteSubscription(subId);
    emit SubscriptionCanceled(subId, to, nativeBalance);
    if (nativeBalance != 0) {
      s_totalNativeBalance -= nativeBalance;
      (bool success,) = to.call{value: nativeBalance}("");
      if (!success) {
        s_totalNativeBalance += nativeBalance;
        s_pendingRefunds[to] += nativeBalance;
        emit RefundDeferred(to, nativeBalance);
      }
    }
  }

  modifier onlySubOwner(uint256 subId) {
    _onlySubOwner(subId);
    _;
  }

  function _onlySubOwner(uint256 subId) internal view {
    address subOwner = s_subscriptionConfigs[subId].owner;
    _requireValidSubscription(subOwner);
    if (msg.sender != subOwner) {
      revert MustBeSubOwner(subOwner);
    }
  }

  function _mustSendNative(address to, uint256 amount) internal {
    (bool success,) = to.call{value: amount}("");
    if (!success) {
      revert FailedToSendNative();
    }
  }
}
