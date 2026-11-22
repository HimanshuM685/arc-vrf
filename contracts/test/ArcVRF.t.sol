// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Test, Vm} from "forge-std/Test.sol";
import {VRF} from "../src/vendor/VRF.sol";
import {VRFTypes} from "../src/libraries/VRFTypes.sol";
import {ArcVRFClient} from "../src/libraries/ArcVRFClient.sol";
import {ArcVRFCoordinator} from "../src/ArcVRFCoordinator.sol";
import {SubscriptionAPI} from "../src/SubscriptionAPI.sol";
import {ArcVRFWrapper} from "../src/ArcVRFWrapper.sol";
import {ArcVRFConsumerBase} from "../src/ArcVRFConsumerBase.sol";
import {ArcVRFWrapperConsumerBase} from "../src/ArcVRFWrapperConsumerBase.sol";
import {BlockhashStore} from "../src/BlockhashStore.sol";
import {HiLoGame} from "../src/examples/HiLoGame.sol";
import {DiceDirect} from "../src/examples/DiceDirect.sol";

/// @dev Stand-in for the EIP-2935 history contract, etched at its canonical address.
contract MockHistoryStorage {
  mapping(uint256 => bytes32) internal s_hashes;

  function set(uint256 n, bytes32 h) external {
    s_hashes[n] = h;
  }

  fallback(bytes calldata data) external returns (bytes memory) {
    bytes32 h = s_hashes[abi.decode(data, (uint256))];
    require(h != 0, "out of range");
    return abi.encode(h);
  }
}

/// @dev Rejects native transfers, like an Arc-blocklisted address.
contract Blocked {
  receive() external payable {
    revert("blocked");
  }

  function claim(ArcVRFCoordinator c) external {
    c.withdrawRefund();
  }
}

contract RevertingConsumer is ArcVRFConsumerBase {
  constructor(address c) ArcVRFConsumerBase(c) {}

  function request(bytes32 keyHash, uint256 subId, bytes memory extraArgs, uint32 numWords) external returns (uint256) {
    return s_vrfCoordinator.requestRandomWords(
      ArcVRFClient.RandomWordsRequest(keyHash, subId, 0, 100_000, numWords, extraArgs)
    );
  }

  function fulfillRandomWords(uint256, uint256[] calldata) internal pure override {
    revert("boom");
  }
}

contract RevertingDice is ArcVRFWrapperConsumerBase {
  constructor(address w) ArcVRFWrapperConsumerBase(w) {}

  function roll() external payable returns (uint256 id) {
    (id,) = requestRandomnessPayInNative(100_000, 0, 1, "");
  }

  function fulfillRandomWords(uint256, uint256[] memory) internal pure override {
    revert("boom");
  }
}

contract ArcVRFTest is Test {
  event WrapperFulfillmentFailed(uint256 indexed requestId, address indexed consumer);

  uint256 internal constant SK = 0xc0ffee1234567890;
  uint256 internal constant GAS_PRICE = 20 gwei;
  address internal constant HISTORY = 0x0000F90827F1C53a10cb7A02335B175320002935;

  ArcVRFCoordinator internal coord;
  BlockhashStore internal bhs;
  uint256[2] internal pk;
  bytes32 internal keyHash;
  uint256 internal subId;
  HiLoGame internal game;

  struct Req {
    uint256 requestId;
    uint256 preSeed;
    uint64 blockNum;
    uint256 subId;
    uint32 callbackGasLimit;
    uint32 numWords;
    address sender;
    bytes extraArgs;
  }

  function setUp() public {
    vm.roll(1000);
    bhs = new BlockhashStore();
    coord = new ArcVRFCoordinator(address(bhs));
    coord.setConfig(0, 2_500_000, 33_285, 0, 50);
    Vm.Wallet memory w = vm.createWallet(SK);
    pk = [w.publicKeyX, w.publicKeyY];
    keyHash = coord.hashOfKey(pk);
    coord.registerProvingKey(pk, 500 gwei);

    subId = coord.createSubscription();
    coord.fundSubscriptionWithNative{value: 10 ether}(subId);
    game = new HiLoGame(address(coord), keyHash, subId);
    coord.addConsumer(subId, address(game));
  }

  // ---------- helpers ----------

  function _lastRequest() internal returns (Req memory r) {
    Vm.Log[] memory logs = vm.getRecordedLogs();
    bytes32 sig = keccak256(
      "RandomWordsRequested(bytes32,uint256,uint256,uint256,uint16,uint32,uint32,bytes,address)"
    );
    for (uint256 i = logs.length; i > 0; --i) {
      Vm.Log memory l = logs[i - 1];
      if (l.emitter == address(coord) && l.topics[0] == sig) {
        (r.requestId, r.preSeed,, r.callbackGasLimit, r.numWords, r.extraArgs) =
          abi.decode(l.data, (uint256, uint256, uint16, uint32, uint32, bytes));
        r.subId = uint256(l.topics[2]);
        r.sender = address(uint160(uint256(l.topics[3])));
        r.blockNum = uint64(block.number);
        return r;
      }
    }
    revert("no request");
  }

  function _prove(uint256 preSeed, bytes32 blockHash) internal returns (VRF.Proof memory) {
    string[] memory cmd = new string[](5);
    cmd[0] = "../node/node_modules/.bin/tsx";
    cmd[1] = "../node/src/cli/prove.ts";
    cmd[2] = vm.toString(SK);
    cmd[3] = vm.toString(preSeed);
    cmd[4] = vm.toString(blockHash);
    return abi.decode(vm.ffi(cmd), (VRF.Proof));
  }

  function _rc(Req memory r) internal pure returns (VRFTypes.RequestCommitmentV2Plus memory) {
    return VRFTypes.RequestCommitmentV2Plus(r.blockNum, r.subId, r.callbackGasLimit, r.numWords, r.sender, r.extraArgs);
  }

  /// Advance one block, pin the request block's hash, and fulfil at 20 gwei.
  function _fulfil(Req memory r) internal returns (uint96) {
    bytes32 h = keccak256(abi.encode("block", r.blockNum));
    vm.setBlockhash(r.blockNum, h);
    vm.roll(r.blockNum + 1);
    VRF.Proof memory p = _prove(r.preSeed, h);
    vm.txGasPrice(GAS_PRICE);
    return coord.fulfillRandomWords(p, _rc(r), false);
  }

  // ---------- subscription flow ----------

  function test_SubscriptionFlow_DeliversAndCharges() public {
    vm.recordLogs();
    uint256 requestId = game.play(HiLoGame.Guess.Hi);
    Req memory r = _lastRequest();
    assertEq(r.requestId, requestId);
    assertTrue(coord.pendingRequestExists(subId));
    // normalised extraArgs: nativePayment = true
    assertEq(r.extraArgs, ArcVRFClient.nativeExtraArgs());

    (, uint96 before,,,) = coord.getSubscription(subId);
    vm.recordLogs();
    uint96 payment = _fulfil(r);

    (uint96 linkBal, uint96 afterBal, uint64 reqCount,,) = coord.getSubscription(subId);
    assertEq(linkBal, 0);
    assertGt(payment, 0);
    assertEq(before - afterBal, payment);
    assertEq(reqCount, 1);
    assertEq(coord.withdrawableNative(), payment);
    assertEq(coord.s_requestCommitments(requestId), bytes32(0));
    assertFalse(coord.pendingRequestExists(subId));
    assertTrue(game.s_currentBall() >= 1 && game.s_currentBall() <= 20);

    // operator withdraws fees
    address payable op = payable(makeAddr("operator"));
    coord.withdrawNative(op);
    assertEq(op.balance, payment);
  }

  function test_Fulfil_TwiceReverts() public {
    vm.recordLogs();
    game.play(HiLoGame.Guess.Lo);
    Req memory r = _lastRequest();
    _fulfil(r);
    VRF.Proof memory p = _prove(r.preSeed, blockhash(r.blockNum));
    vm.expectRevert(ArcVRFCoordinator.NoCorrespondingRequest.selector);
    coord.fulfillRandomWords(p, _rc(r), false);
  }

  function test_Fulfil_WrongBlockhashReverts() public {
    vm.recordLogs();
    game.play(HiLoGame.Guess.Lo);
    Req memory r = _lastRequest();
    vm.setBlockhash(r.blockNum, keccak256("real"));
    vm.roll(r.blockNum + 1);
    VRF.Proof memory p = _prove(r.preSeed, keccak256("forged"));
    vm.txGasPrice(GAS_PRICE);
    vm.expectRevert(); // VRF.sol rejects the proof (which check fails depends on the forged seed)
    coord.fulfillRandomWords(p, _rc(r), false);
  }

  function test_Fulfil_TamperedCommitmentReverts() public {
    vm.recordLogs();
    game.play(HiLoGame.Guess.Lo);
    Req memory r = _lastRequest();
    r.numWords = 5;
    vm.expectRevert(ArcVRFCoordinator.IncorrectCommitment.selector);
    _fulfil(r);
  }

  function test_Fulfil_GasPriceAboveLaneReverts() public {
    vm.recordLogs();
    game.play(HiLoGame.Guess.Lo);
    Req memory r = _lastRequest();
    bytes32 h = keccak256("h");
    vm.setBlockhash(r.blockNum, h);
    vm.roll(r.blockNum + 1);
    VRF.Proof memory p = _prove(r.preSeed, h);
    vm.txGasPrice(501 gwei);
    vm.expectRevert(abi.encodeWithSelector(ArcVRFCoordinator.GasPriceExceeded.selector, 501 gwei, 500 gwei));
    coord.fulfillRandomWords(p, _rc(r), false);
  }

  function test_RevertingCallback_StillCharged() public {
    RevertingConsumer c = new RevertingConsumer(address(coord));
    coord.addConsumer(subId, address(c));
    vm.recordLogs();
    c.request(keyHash, subId, "", 1);
    Req memory r = _lastRequest();
    (, uint96 before,,,) = coord.getSubscription(subId);
    uint96 payment = _fulfil(r);
    (, uint96 afterBal,,,) = coord.getSubscription(subId);
    assertEq(before - afterBal, payment);
    assertGt(payment, 0);
  }

  function test_EmptyExtraArgsAccepted_NativeFalseReverts() public {
    RevertingConsumer c = new RevertingConsumer(address(coord));
    coord.addConsumer(subId, address(c));
    c.request(keyHash, subId, "", 1);

    bytes memory link = ArcVRFClient._argsToBytes(ArcVRFClient.ExtraArgsV1({nativePayment: false}));
    vm.expectRevert(ArcVRFCoordinator.LinkPaymentNotSupported.selector);
    c.request(keyHash, subId, link, 1);

    vm.expectRevert(ArcVRFCoordinator.InvalidExtraArgsTag.selector);
    c.request(keyHash, subId, hex"deadbeef0000000000000000000000000000000000000000000000000000000000000001", 1);
  }

  function test_RequestValidation() public {
    RevertingConsumer c = new RevertingConsumer(address(coord));
    vm.expectRevert(abi.encodeWithSelector(SubscriptionAPI.InvalidConsumer.selector, subId, address(c)));
    c.request(keyHash, subId, "", 1);

    coord.addConsumer(subId, address(c));
    vm.expectRevert(abi.encodeWithSelector(ArcVRFCoordinator.NumWordsTooBig.selector, 501, 500));
    c.request(keyHash, subId, "", 501);

    vm.expectRevert(SubscriptionAPI.InvalidSubscription.selector);
    c.request(keyHash, 12345, "", 1);
  }

  function test_MinConfirmationsEnforced() public {
    coord.setConfig(3, 2_500_000, 33_285, 0, 50);
    vm.expectRevert(abi.encodeWithSelector(ArcVRFCoordinator.InvalidRequestConfirmations.selector, 0, 3, 200));
    game.play(HiLoGame.Guess.Hi);
  }

  // ---------- subscription management ----------

  function test_OnlyOwnerManagesConsumers() public {
    vm.prank(makeAddr("stranger"));
    vm.expectRevert(abi.encodeWithSelector(SubscriptionAPI.MustBeSubOwner.selector, address(this)));
    coord.addConsumer(subId, address(1));
  }

  function test_MaxConsumers() public {
    for (uint160 i = 1; i < 100; ++i) {
      coord.addConsumer(subId, address(i));
    }
    vm.expectRevert(SubscriptionAPI.TooManyConsumers.selector);
    coord.addConsumer(subId, address(1000));
  }

  function test_OwnerTransfer() public {
    address bob = makeAddr("bob");
    coord.requestSubscriptionOwnerTransfer(subId, bob);
    assertEq(coord.getRequestedOwner(subId), bob);
    vm.prank(bob);
    coord.acceptSubscriptionOwnerTransfer(subId);
    (,,, address owner,) = coord.getSubscription(subId);
    assertEq(owner, bob);
  }

  function test_Cancel_PendingReverts_ThenRefunds() public {
    game.play(HiLoGame.Guess.Hi);
    address payable to = payable(makeAddr("to"));
    vm.expectRevert(SubscriptionAPI.PendingRequestExists.selector);
    coord.cancelSubscription(subId, to);

    uint256 sub2 = coord.createSubscription();
    coord.fundSubscriptionWithNative{value: 1 ether}(sub2);
    coord.cancelSubscription(sub2, to);
    assertEq(to.balance, 1 ether);
    vm.expectRevert(SubscriptionAPI.InvalidSubscription.selector);
    coord.getSubscription(sub2);
  }

  function test_Cancel_BlockedRecipientGetsPullRefund() public {
    Blocked blocked = new Blocked();
    uint256 sub2 = coord.createSubscription();
    coord.fundSubscriptionWithNative{value: 2 ether}(sub2);
    coord.cancelSubscription(sub2, address(blocked)); // does not revert
    assertEq(coord.s_pendingRefunds(address(blocked)), 2 ether);

    vm.expectRevert(SubscriptionAPI.FailedToSendNative.selector);
    blocked.claim(coord);

    vm.expectRevert(SubscriptionAPI.ZeroAddressRecipient.selector);
    coord.cancelSubscription(subId, address(0));
  }

  function test_RecoverNativeFunds() public {
    // coordinator has no receive(); simulate a force-send (e.g. selfdestruct) with deal
    vm.deal(address(coord), address(coord).balance + 3 ether);
    address payable to = payable(makeAddr("recover"));
    coord.recoverNativeFunds(to);
    assertEq(to.balance, 3 ether);
  }

  // ---------- block hash fallbacks ----------

  function test_Eip2935Fallback() public {
    MockHistoryStorage mock = new MockHistoryStorage();
    vm.etch(HISTORY, address(mock).code);

    vm.recordLogs();
    game.play(HiLoGame.Guess.Hi);
    Req memory r = _lastRequest();
    bytes32 h = keccak256("old block");
    MockHistoryStorage(HISTORY).set(r.blockNum, h);
    vm.roll(r.blockNum + 1000); // outside the 256-block BLOCKHASH window
    VRF.Proof memory p = _prove(r.preSeed, h);
    vm.txGasPrice(GAS_PRICE);
    coord.fulfillRandomWords(p, _rc(r), false);
    assertEq(coord.s_requestCommitments(r.requestId), bytes32(0));
  }

  function test_BlockhashStoreFallback() public {
    vm.recordLogs();
    game.play(HiLoGame.Guess.Hi);
    Req memory r = _lastRequest();
    bytes32 h = keccak256("stored block");
    vm.setBlockhash(r.blockNum, h);
    vm.roll(r.blockNum + 10);
    bhs.store(r.blockNum);
    vm.roll(r.blockNum + 9000); // past EIP-2935 too (no history contract here)
    VRF.Proof memory p = _prove(r.preSeed, h);
    vm.txGasPrice(GAS_PRICE);
    coord.fulfillRandomWords(p, _rc(r), false);
  }

  function test_TooOldWithoutStoreReverts() public {
    vm.recordLogs();
    game.play(HiLoGame.Guess.Hi);
    Req memory r = _lastRequest();
    vm.roll(r.blockNum + 9000);
    VRF.Proof memory p = _prove(r.preSeed, keccak256("x"));
    vm.txGasPrice(GAS_PRICE);
    vm.expectRevert(bytes("blockhash not found in store"));
    coord.fulfillRandomWords(p, _rc(r), false);
  }

  // ---------- direct funding (wrapper) ----------

  function _wrapper() internal returns (ArcVRFWrapper w, uint256 wSub) {
    wSub = coord.createSubscription();
    coord.fundSubscriptionWithNative{value: 10 ether}(wSub);
    w = new ArcVRFWrapper(address(coord), wSub);
    coord.addConsumer(wSub, address(w));
    // Chainlink Base Sepolia wrapper settings: overheads 13,400 / 128,500 / 435, 60% premium.
    w.setConfig(13_400, 128_500, 435, 60, keyHash, 10, 0);
  }

  function test_WrapperPriceMatchesFormula() public {
    (ArcVRFWrapper w,) = _wrapper();
    // Same result as Chainlink's live Base Sepolia wrapper estimateRequestPriceNative(100000, 1, 20 gwei).
    assertEq(w.estimateRequestPriceNative(100_000, 1, 20 gwei), 7_593_920_000_000_000);
    uint256 expected = 20 gwei * 13_400 + (20 gwei * (100_000 + 128_500 + 3 * 435) * 160) / 100;
    assertEq(w.estimateRequestPriceNative(100_000, 3, 20 gwei), expected);
  }

  function test_DirectFundingFlow() public {
    (ArcVRFWrapper w, uint256 wSub) = _wrapper();
    DiceDirect dice = new DiceDirect(address(w));
    address player = makeAddr("player");
    vm.deal(player, 1 ether);

    vm.txGasPrice(GAS_PRICE);
    uint256 price = w.calculateRequestPriceNative(dice.CALLBACK_GAS_LIMIT(), 1);
    vm.recordLogs();
    vm.prank(player);
    uint256 requestId = dice.roll{value: price + 1 gwei}();
    Req memory r = _lastRequest();
    assertEq(r.requestId, requestId);
    assertEq(r.sender, address(w));
    assertEq(r.subId, wSub);
    assertEq(address(w).balance, price); // fee held by wrapper
    assertEq(player.balance, 1 ether - price); // change refunded

    (, uint96 before,,,) = coord.getSubscription(wSub);
    uint96 payment = _fulfil(r);
    (, uint96 afterBal,,,) = coord.getSubscription(wSub);
    assertEq(before - afterBal, payment); // charged to the wrapper's subscription
    (address cb,,) = w.s_callbacks(requestId);
    assertEq(cb, address(0));

    w.withdrawNative(address(0xBEEF));
    assertEq(address(0xBEEF).balance, price);
  }

  function test_Wrapper_UnderpayAndTooManyWordsRevert() public {
    (ArcVRFWrapper w,) = _wrapper();
    vm.txGasPrice(GAS_PRICE);
    uint256 price = w.calculateRequestPriceNative(100_000, 1);
    vm.expectRevert(abi.encodeWithSelector(ArcVRFWrapper.FeeTooLow.selector, price - 1, price));
    w.requestRandomWordsInNative{value: price - 1}(100_000, 0, 1, "");

    uint256 price11 = w.calculateRequestPriceNative(100_000, 11);
    vm.expectRevert(abi.encodeWithSelector(ArcVRFWrapper.NumWordsTooHigh.selector, 11, 10));
    w.requestRandomWordsInNative{value: price11}(100_000, 0, 11, "");

    bytes memory link = ArcVRFClient._argsToBytes(ArcVRFClient.ExtraArgsV1({nativePayment: false}));
    vm.expectRevert(ArcVRFCoordinator.LinkPaymentNotSupported.selector);
    w.requestRandomWordsInNative{value: price}(100_000, 0, 1, link);
  }

  function test_Wrapper_FailingCallbackEmitsEvent() public {
    (ArcVRFWrapper w,) = _wrapper();
    RevertingDice d = new RevertingDice(address(w));
    vm.deal(address(d), 1 ether);
    vm.txGasPrice(GAS_PRICE);
    vm.recordLogs();
    uint256 id = d.roll();
    Req memory r = _lastRequest();
    vm.expectEmit(true, true, false, false, address(w));
    emit WrapperFulfillmentFailed(id, address(d));
    _fulfil(r);
  }

  function test_Wrapper_DisabledAndUnconfigured() public {
    uint256 wSub = coord.createSubscription();
    ArcVRFWrapper w = new ArcVRFWrapper(address(coord), wSub);
    vm.expectRevert(ArcVRFWrapper.NotConfigured.selector);
    w.calculateRequestPriceNative(100_000, 1);
    w.setConfig(13_400, 128_500, 435, 60, keyHash, 10, 0);
    w.disable();
    vm.expectRevert(ArcVRFWrapper.IsDisabled.selector);
    w.calculateRequestPriceNative(100_000, 1);
  }
}
