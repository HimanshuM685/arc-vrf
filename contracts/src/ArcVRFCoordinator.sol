// SPDX-License-Identifier: MIT
// Derived from Chainlink VRFCoordinatorV2_5.sol (smartcontractkit/chainlink-evm@e162754, MIT).
// Arc changes:
//  - Native USDC billing only: LINK billing, LINK/native price feed and L1 fee code removed.
//  - extraArgs: empty or nativePayment=true accepted (normalised to nativePayment=true);
//    nativePayment=false reverts with LinkPaymentNotSupported.
//  - _getBlockhash falls back to EIP-2935 history before the BlockhashStore, since Arc's
//    ~0.5 s blocks make the 256-block BLOCKHASH window only ~2 minutes.
//  - Coordinator migration removed.
pragma solidity 0.8.19;

import {VRF} from "./vendor/VRF.sol";
import {ITypeAndVersion} from "./vendor/ITypeAndVersion.sol";
import {VRFTypes} from "./libraries/VRFTypes.sol";
import {ArcVRFClient} from "./libraries/ArcVRFClient.sol";
import {SubscriptionAPI} from "./SubscriptionAPI.sol";
import {ArcVRFConsumerBase} from "./ArcVRFConsumerBase.sol";
import {IArcVRFCoordinator} from "./interfaces/IArcVRFCoordinator.sol";

interface BlockhashStoreInterface {
  function getBlockhash(uint256 number) external view returns (bytes32);
}

contract ArcVRFCoordinator is VRF, SubscriptionAPI, IArcVRFCoordinator, ITypeAndVersion {
  BlockhashStoreInterface public immutable BLOCKHASH_STORE;

  /// @dev EIP-2935 history storage contract (serves the last 8191 block hashes).
  address public constant HISTORY_STORAGE = 0x0000F90827F1C53a10cb7A02335B175320002935;

  uint16 public constant MAX_REQUEST_CONFIRMATIONS = 200;
  uint32 public constant MAX_NUM_WORDS = 500;
  // 5k is plenty for an EXTCODESIZE call (2600) + warm CALL (100) and some arithmetic.
  uint256 private constant GAS_FOR_CALL_EXACT_CHECK = 5000;
  // Upper bound for premium percentage so fee calculations can't overflow.
  uint8 private constant PREMIUM_PERCENTAGE_MAX = 155;

  error InvalidRequestConfirmations(uint16 have, uint16 min, uint16 max);
  error GasLimitTooBig(uint32 have, uint32 want);
  error NumWordsTooBig(uint32 have, uint32 want);
  error MsgDataTooBig(uint256 have, uint32 max);
  error ProvingKeyAlreadyRegistered(bytes32 keyHash);
  error NoSuchProvingKey(bytes32 keyHash);
  error InvalidPremiumPercentage(uint8 premiumPercentage, uint8 max);
  error NoCorrespondingRequest();
  error IncorrectCommitment();
  error BlockhashNotInStore(uint256 blockNum);
  error InvalidExtraArgsTag();
  error LinkPaymentNotSupported();
  error GasPriceExceeded(uint256 gasPrice, uint256 maxGas);

  struct ProvingKey {
    bool exists;
    uint64 maxGas; // gas lane max gas price for fulfilling requests
  }

  mapping(bytes32 keyHash => ProvingKey) public s_provingKeys;
  bytes32[] public s_provingKeyHashes;
  mapping(uint256 requestId => bytes32 commitment) public s_requestCommitments;

  event ProvingKeyRegistered(bytes32 keyHash, uint64 maxGas);
  event ProvingKeyDeregistered(bytes32 keyHash, uint64 maxGas);

  event RandomWordsRequested(
    bytes32 indexed keyHash,
    uint256 requestId,
    uint256 preSeed,
    uint256 indexed subId,
    uint16 minimumRequestConfirmations,
    uint32 callbackGasLimit,
    uint32 numWords,
    bytes extraArgs,
    address indexed sender
  );

  // Same shape as Chainlink v2.5; nativePayment is always true on Arc.
  event RandomWordsFulfilled(
    uint256 indexed requestId,
    uint256 outputSeed,
    uint256 indexed subId,
    uint96 payment,
    bool nativePayment,
    bool success,
    bool onlyPremium
  );

  event ConfigSet(
    uint16 minimumRequestConfirmations,
    uint32 maxGasLimit,
    uint32 gasAfterPaymentCalculation,
    uint32 fulfillmentFlatFeeNativePPM,
    uint8 nativePremiumPercentage
  );

  constructor(address blockhashStore) SubscriptionAPI() {
    BLOCKHASH_STORE = BlockhashStoreInterface(blockhashStore);
  }

  /// @notice Registers a proving key that an oracle can use to submit fulfillments.
  function registerProvingKey(uint256[2] calldata publicProvingKey, uint64 maxGas) external onlyOwner {
    bytes32 kh = hashOfKey(publicProvingKey);
    if (s_provingKeys[kh].exists) {
      revert ProvingKeyAlreadyRegistered(kh);
    }
    s_provingKeys[kh] = ProvingKey({exists: true, maxGas: maxGas});
    s_provingKeyHashes.push(kh);
    emit ProvingKeyRegistered(kh, maxGas);
  }

  function deregisterProvingKey(uint256[2] calldata publicProvingKey) external onlyOwner {
    bytes32 kh = hashOfKey(publicProvingKey);
    ProvingKey memory key = s_provingKeys[kh];
    if (!key.exists) {
      revert NoSuchProvingKey(kh);
    }
    delete s_provingKeys[kh];
    uint256 len = s_provingKeyHashes.length;
    for (uint256 i = 0; i < len; ++i) {
      if (s_provingKeyHashes[i] == kh) {
        s_provingKeyHashes[i] = s_provingKeyHashes[len - 1];
        s_provingKeyHashes.pop();
        break;
      }
    }
    emit ProvingKeyDeregistered(kh, key.maxGas);
  }

  function getProvingKeyHashes() external view returns (bytes32[] memory) {
    return s_provingKeyHashes;
  }

  /// @notice keyHash = keccak256(abi.encode(publicKey))
  function hashOfKey(uint256[2] memory publicKey) public pure returns (bytes32) {
    return keccak256(abi.encode(publicKey));
  }

  function setConfig(
    uint16 minimumRequestConfirmations,
    uint32 maxGasLimit,
    uint32 gasAfterPaymentCalculation,
    uint32 fulfillmentFlatFeeNativePPM,
    uint8 nativePremiumPercentage
  ) external onlyOwner {
    if (minimumRequestConfirmations > MAX_REQUEST_CONFIRMATIONS) {
      revert InvalidRequestConfirmations(
        minimumRequestConfirmations, minimumRequestConfirmations, MAX_REQUEST_CONFIRMATIONS
      );
    }
    if (nativePremiumPercentage > PREMIUM_PERCENTAGE_MAX) {
      revert InvalidPremiumPercentage(nativePremiumPercentage, PREMIUM_PERCENTAGE_MAX);
    }
    s_config = Config({
      minimumRequestConfirmations: minimumRequestConfirmations,
      maxGasLimit: maxGasLimit,
      reentrancyLock: false,
      gasAfterPaymentCalculation: gasAfterPaymentCalculation,
      fulfillmentFlatFeeNativePPM: fulfillmentFlatFeeNativePPM,
      nativePremiumPercentage: nativePremiumPercentage
    });
    emit ConfigSet(
      minimumRequestConfirmations,
      maxGasLimit,
      gasAfterPaymentCalculation,
      fulfillmentFlatFeeNativePPM,
      nativePremiumPercentage
    );
  }

  /// @dev Empty extraArgs and nativePayment=true both mean native USDC. nativePayment=false reverts,
  /// so nobody can believe they are paying in LINK.
  function _fromBytes(bytes calldata extraArgs) internal pure returns (ArcVRFClient.ExtraArgsV1 memory) {
    if (extraArgs.length == 0) {
      return ArcVRFClient.ExtraArgsV1({nativePayment: true});
    }
    if (bytes4(extraArgs) != ArcVRFClient.EXTRA_ARGS_V1_TAG) revert InvalidExtraArgsTag();
    ArcVRFClient.ExtraArgsV1 memory args = abi.decode(extraArgs[4:], (ArcVRFClient.ExtraArgsV1));
    if (!args.nativePayment) revert LinkPaymentNotSupported();
    return args;
  }

  /**
   * @notice Request a set of random words.
   * @param req keyHash (gas lane), subId, requestConfirmations ([min, 200]; Arc default 0),
   * callbackGasLimit ([0, maxGasLimit]), numWords ([1, 500]), extraArgs (empty or nativePayment=true).
   * @return requestId unique id, passed back to fulfillRandomWords.
   * @dev No balance check and no fee at request time: the subscription is charged on fulfilment.
   * An unknown keyHash is accepted but never fulfilled.
   */
  function requestRandomWords(ArcVRFClient.RandomWordsRequest calldata req)
    external
    override
    nonReentrant
    returns (uint256 requestId)
  {
    uint256 subId = req.subId;
    _requireValidSubscription(s_subscriptionConfigs[subId].owner);
    // The consumer must be allowed to spend this subscription.
    mapping(uint256 => ConsumerConfig) storage consumerConfigs = s_consumers[msg.sender];
    ConsumerConfig memory consumerConfig = consumerConfigs[subId];
    if (!consumerConfig.active) {
      revert InvalidConsumer(subId, msg.sender);
    }
    if (
      req.requestConfirmations < s_config.minimumRequestConfirmations
        || req.requestConfirmations > MAX_REQUEST_CONFIRMATIONS
    ) {
      revert InvalidRequestConfirmations(
        req.requestConfirmations, s_config.minimumRequestConfirmations, MAX_REQUEST_CONFIRMATIONS
      );
    }
    if (req.callbackGasLimit > s_config.maxGasLimit) {
      revert GasLimitTooBig(req.callbackGasLimit, s_config.maxGasLimit);
    }
    if (req.numWords > MAX_NUM_WORDS) {
      revert NumWordsTooBig(req.numWords, MAX_NUM_WORDS);
    }

    ++consumerConfig.nonce;
    ++consumerConfig.pendingReqCount;
    uint256 preSeed;
    (requestId, preSeed) = _computeRequestId(req.keyHash, msg.sender, subId, consumerConfig.nonce);

    bytes memory extraArgsBytes = ArcVRFClient._argsToBytes(_fromBytes(req.extraArgs));
    s_requestCommitments[requestId] = keccak256(
      abi.encode(requestId, block.number, subId, req.callbackGasLimit, req.numWords, msg.sender, extraArgsBytes)
    );
    emit RandomWordsRequested(
      req.keyHash,
      requestId,
      preSeed,
      subId,
      req.requestConfirmations,
      req.callbackGasLimit,
      req.numWords,
      extraArgsBytes,
      msg.sender
    );
    consumerConfigs[subId] = consumerConfig;

    return requestId;
  }

  function _computeRequestId(bytes32 keyHash, address sender, uint256 subId, uint64 nonce)
    internal
    pure
    returns (uint256, uint256)
  {
    uint256 preSeed = uint256(keccak256(abi.encode(keyHash, sender, subId, nonce)));
    return (uint256(keccak256(abi.encode(keyHash, preSeed))), preSeed);
  }

  /// @dev calls target with exactly gasAmount gas, or reverts if that much gas is not available.
  function _callWithExactGas(uint256 gasAmount, address target, bytes memory data) private returns (bool success) {
    assembly {
      let g := gas()
      if lt(g, GAS_FOR_CALL_EXACT_CHECK) { revert(0, 0) }
      g := sub(g, GAS_FOR_CALL_EXACT_CHECK)
      // EIP-150: only 63/64 of remaining gas can be forwarded
      if iszero(gt(sub(g, div(g, 64)), gasAmount)) { revert(0, 0) }
      if iszero(extcodesize(target)) { revert(0, 0) }
      success := call(gasAmount, target, 0, add(data, 0x20), mload(data), 0, 0)
    }
    return success;
  }

  struct Output {
    ProvingKey provingKey;
    uint256 requestId;
    uint256 randomness;
  }

  function _getRandomnessFromProof(Proof calldata proof, VRFTypes.RequestCommitmentV2Plus calldata rc)
    internal
    view
    returns (Output memory)
  {
    bytes32 keyHash = hashOfKey(proof.pk);
    ProvingKey memory key = s_provingKeys[keyHash];
    if (!key.exists) {
      revert NoSuchProvingKey(keyHash);
    }
    uint256 requestId = uint256(keccak256(abi.encode(keyHash, proof.seed)));
    bytes32 commitment = s_requestCommitments[requestId];
    if (commitment == 0) {
      revert NoCorrespondingRequest();
    }
    if (
      commitment
        != keccak256(
          abi.encode(requestId, rc.blockNum, rc.subId, rc.callbackGasLimit, rc.numWords, rc.sender, rc.extraArgs)
        )
    ) {
      revert IncorrectCommitment();
    }

    // Hash of the REQUEST block (not a future block): unknown when the request was sent.
    bytes32 blockHash = _getBlockhash(rc.blockNum);
    if (blockHash == bytes32(0)) {
      blockHash = BLOCKHASH_STORE.getBlockhash(rc.blockNum);
      if (blockHash == bytes32(0)) {
        revert BlockhashNotInStore(rc.blockNum);
      }
    }

    uint256 actualSeed = uint256(keccak256(abi.encodePacked(proof.seed, blockHash)));
    uint256 randomness = VRF._randomValueFromVRFProof(proof, actualSeed); // reverts on failure
    return Output(key, requestId, randomness);
  }

  function _getValidatedGasPrice(bool onlyPremium, uint64 gasLaneMaxGas) internal view returns (uint256 gasPrice) {
    if (tx.gasprice > gasLaneMaxGas) {
      if (onlyPremium) {
        return uint256(gasLaneMaxGas);
      } else {
        revert GasPriceExceeded(tx.gasprice, gasLaneMaxGas);
      }
    }
    return tx.gasprice;
  }

  function _deliverRandomness(
    uint256 requestId,
    VRFTypes.RequestCommitmentV2Plus calldata rc,
    uint256[] memory randomWords
  ) internal returns (bool success) {
    bytes memory resp =
      abi.encodeWithSelector(ArcVRFConsumerBase.rawFulfillRandomWords.selector, requestId, randomWords);
    // Exactly the requested callback gas; block coordinator re-entry during the callback.
    s_config.reentrancyLock = true;
    success = _callWithExactGas(rc.callbackGasLimit, rc.sender, resp);
    s_config.reentrancyLock = false;
    return success;
  }

  /**
   * @notice Fulfill a randomness request. Called by the Arc VRF node.
   * @param proof VRF proof for the request's final seed
   * @param rc request commitment pre-image, committed to at request time
   * @param onlyPremium only charge the premium (operator discretion)
   * @return payment USDC billed to the subscription
   * @dev Verifies first, delivers, then charges gas used + premium. A reverting callback is
   * not retried and is still charged.
   */
  function fulfillRandomWords(
    Proof calldata proof,
    VRFTypes.RequestCommitmentV2Plus calldata rc,
    bool onlyPremium
  ) external nonReentrant returns (uint96 payment) {
    uint256 startGas = gasleft();
    // 772 bytes of calldata + 32 bytes buffer (see Chainlink VRFCoordinatorV2_5 for the breakdown).
    if (msg.data.length > 804) {
      revert MsgDataTooBig(msg.data.length, 804);
    }
    Output memory output = _getRandomnessFromProof(proof, rc);
    uint256 gasPrice = _getValidatedGasPrice(onlyPremium, output.provingKey.maxGas);

    uint256[] memory randomWords;
    uint256 randomness = output.randomness;
    {
      uint256 numWords = rc.numWords;
      randomWords = new uint256[](numWords);
      for (uint256 i = 0; i < numWords; ++i) {
        randomWords[i] = uint256(keccak256(abi.encode(randomness, i)));
      }
    }

    delete s_requestCommitments[output.requestId];
    bool success = _deliverRandomness(output.requestId, rc, randomWords);

    ++s_subscriptions[rc.subId].reqCount;
    --s_consumers[rc.sender][rc.subId].pendingReqCount;

    payment = _calculatePaymentAmountNative(startGas, gasPrice, onlyPremium);
    _chargePayment(payment, rc.subId);

    emit RandomWordsFulfilled(output.requestId, randomness, rc.subId, payment, true, success, onlyPremium);
    return payment;
  }

  function _chargePayment(uint96 payment, uint256 subId) internal {
    Subscription storage subscription = s_subscriptions[subId];
    uint96 prevBal = subscription.nativeBalance;
    _requireSufficientBalance(prevBal >= payment);
    subscription.nativeBalance = prevBal - payment;
    s_withdrawableNative += payment;
  }

  /// @dev payment = gasPrice * (gasAfterPaymentCalculation + gasUsed) * (100 + premium) / 100 + 1e12 * flatFeePPM
  function _calculatePaymentAmountNative(uint256 startGas, uint256 weiPerUnitGas, bool onlyPremium)
    internal
    view
    returns (uint96)
  {
    uint256 baseFeeWei = weiPerUnitGas * (s_config.gasAfterPaymentCalculation + startGas - gasleft());
    uint256 flatFeeWei = 1e12 * uint256(s_config.fulfillmentFlatFeeNativePPM);
    if (onlyPremium) {
      return uint96(((baseFeeWei * (s_config.nativePremiumPercentage)) / 100) + flatFeeWei);
    } else {
      return uint96(((baseFeeWei * (100 + s_config.nativePremiumPercentage)) / 100) + flatFeeWei);
    }
  }

  /// @notice BLOCKHASH for the last 256 blocks, then EIP-2935 history (~8191 blocks), else 0
  /// (the caller then falls back to the BlockhashStore).
  function _getBlockhash(uint64 blockNumber) internal view virtual returns (bytes32 h) {
    h = blockhash(blockNumber);
    if (h != bytes32(0) || blockNumber >= block.number) return h;
    (bool ok, bytes memory ret) = HISTORY_STORAGE.staticcall(abi.encode(uint256(blockNumber)));
    if (ok && ret.length == 32) h = abi.decode(ret, (bytes32));
  }

  function pendingRequestExists(uint256 subId) public view override returns (bool) {
    address[] storage consumers = s_subscriptionConfigs[subId].consumers;
    uint256 consumersLength = consumers.length;
    for (uint256 i = 0; i < consumersLength; ++i) {
      if (s_consumers[consumers[i]][subId].pendingReqCount > 0) {
        return true;
      }
    }
    return false;
  }

  function removeConsumer(uint256 subId, address consumer) external override onlySubOwner(subId) nonReentrant {
    if (pendingRequestExists(subId)) {
      revert PendingRequestExists();
    }
    if (!s_consumers[consumer][subId].active) {
      revert InvalidConsumer(subId, consumer);
    }
    address[] storage subConsumers = s_subscriptionConfigs[subId].consumers;
    uint256 consumersLength = subConsumers.length;
    for (uint256 i = 0; i < consumersLength; ++i) {
      if (subConsumers[i] == consumer) {
        subConsumers[i] = subConsumers[consumersLength - 1];
        subConsumers.pop();
        break;
      }
    }
    s_consumers[consumer][subId].active = false;
    emit SubscriptionConsumerRemoved(subId, consumer);
  }

  /// @notice Cancel and refund. Reverts while requests are pending.
  function cancelSubscription(uint256 subId, address to) external override onlySubOwner(subId) nonReentrant {
    if (pendingRequestExists(subId)) {
      revert PendingRequestExists();
    }
    _cancelSubscriptionHelper(subId, to);
  }

  function typeAndVersion() external pure virtual override returns (string memory) {
    return "ArcVRFCoordinator 1.0.0";
  }
}
