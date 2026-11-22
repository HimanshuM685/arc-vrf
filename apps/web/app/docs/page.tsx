import type { Metadata } from 'next'
import { Addresses } from './addresses'

export const metadata: Metadata = { title: 'Docs · Arc VRF' }

const toc = [
  ['subscription', 'Quick start: subscription'],
  ['direct', 'Quick start: direct funding'],
  ['params', 'Request parameters'],
  ['porting', 'Porting from Chainlink VRF v2.5'],
  ['billing', 'What you pay'],
  ['security', 'Security guidance'],
  ['how', 'How the randomness is made'],
  ['addresses', 'Addresses'],
] as const

const subscriptionCode = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ArcVRFConsumerBase} from "arc-vrf/ArcVRFConsumerBase.sol";
import {ArcVRFClient} from "arc-vrf/libraries/ArcVRFClient.sol";

contract Raffle is ArcVRFConsumerBase {
  bytes32 immutable keyHash;
  uint256 immutable subId;
  mapping(uint256 => address) public requester;

  constructor(address coordinator, bytes32 _keyHash, uint256 _subId)
    ArcVRFConsumerBase(coordinator)
  {
    keyHash = _keyHash;
    subId = _subId;
  }

  function draw() external returns (uint256 requestId) {
    requestId = s_vrfCoordinator.requestRandomWords(
      ArcVRFClient.RandomWordsRequest({
        keyHash: keyHash,
        subId: subId,
        requestConfirmations: 0,      // Arc finalises on inclusion
        callbackGasLimit: 150_000,
        numWords: 1,
        extraArgs: ArcVRFClient.nativeExtraArgs()  // or ""
      })
    );
    requester[requestId] = msg.sender;
  }

  // Must not revert: a failed callback is not retried and is still charged.
  function fulfillRandomWords(uint256 requestId, uint256[] calldata words) internal override {
    uint256 winningTicket = words[0] % 1000;
    // ...
  }
}`

const directCode = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ArcVRFWrapperConsumerBase} from "arc-vrf/ArcVRFWrapperConsumerBase.sol";
import {ArcVRFClient} from "arc-vrf/libraries/ArcVRFClient.sol";

contract CoinFlip is ArcVRFWrapperConsumerBase {
  constructor(address wrapper) ArcVRFWrapperConsumerBase(wrapper) {}

  // The contract pays from its own USDC balance (plus whatever the caller sends).
  function flip() external payable returns (uint256 requestId) {
    (requestId, ) = requestRandomnessPayInNative(
      100_000,                         // callbackGasLimit
      0,                               // requestConfirmations
      1,                               // numWords (max 10)
      ArcVRFClient.nativeExtraArgs()
    );
  }

  function fulfillRandomWords(uint256 requestId, uint256[] memory words) internal override {
    bool heads = words[0] % 2 == 0;
    // ...
  }

  receive() external payable {}
}`

export default function DocsPage() {
  return (
    <div className="grid gap-10 pt-10 lg:grid-cols-[13rem_1fr]">
      <nav aria-label="On this page" className="hidden lg:block">
        <ul className="sticky top-8 space-y-2 text-sm">
          {toc.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="text-muted hover:text-ink">{label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <article className="prose-doc min-w-0">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Docs</h1>
        <p className="text-lg text-muted">
          Arc VRF is Chainlink VRF v2.5 adapted to Arc: the same contracts, proof and request shapes, billed in native
          USDC, with no LINK anywhere. If you’ve used VRF v2.5, you already know how to use it.
        </p>

        <h2 id="subscription">Quick start: subscription</h2>
        <ol>
          <li>On <a href="/subscriptions">Subscriptions</a>, create a subscription and fund it with USDC.</li>
          <li>Deploy a contract that inherits <code>ArcVRFConsumerBase</code>, passing the coordinator address, a key hash and your subscription ID.</li>
          <li>Add the contract as a consumer of the subscription.</li>
          <li>Call it. The node answers with a proof, the coordinator verifies it and calls <code>fulfillRandomWords</code>.</li>
        </ol>
        <pre><code>{subscriptionCode}</code></pre>
        <p>
          Contracts live in <code>contracts/src</code> of the repository. With Foundry, copy them in or add the repo as
          a dependency and remap <code>arc-vrf/=lib/arc-vrf/contracts/src/</code>.
        </p>

        <h2 id="direct">Quick start: direct funding</h2>
        <ol>
          <li>Deploy a contract that inherits <code>ArcVRFWrapperConsumerBase</code>, passing the wrapper address.</li>
          <li>Make sure it holds, or is sent, enough USDC. Check the price on <a href="/direct-funding">Direct funding</a>.</li>
          <li>Call <code>requestRandomnessPayInNative</code>. It quotes and pays in one call; the excess stays in your contract.</li>
        </ol>
        <pre><code>{directCode}</code></pre>
        <p>If your callback reverts, the wrapper emits <code>WrapperFulfillmentFailed</code> instead of reverting. There is no refund.</p>

        <h2 id="params">Request parameters</h2>
        <table>
          <thead>
            <tr><th>Field</th><th>Type</th><th>Meaning on Arc</th></tr>
          </thead>
          <tbody>
            <tr><td><code>keyHash</code></td><td>bytes32</td><td>Picks the node’s key and the gas lane (max gas price for fulfilment). An unknown key hash is accepted but never fulfilled.</td></tr>
            <tr><td><code>subId</code></td><td>uint256</td><td>Subscription that pays. Your contract must be one of its consumers.</td></tr>
            <tr><td><code>requestConfirmations</code></td><td>uint16</td><td>Blocks the node waits. Arc has instant finality and no reorgs, so 0 is safe. Max 200.</td></tr>
            <tr><td><code>callbackGasLimit</code></td><td>uint32</td><td>Gas for your callback, up to the coordinator’s max (2,500,000). For direct funding, the wrapper adds its own overhead on top.</td></tr>
            <tr><td><code>numWords</code></td><td>uint32</td><td>How many numbers. Max 500 for subscriptions, 10 through the wrapper.</td></tr>
            <tr><td><code>extraArgs</code></td><td>bytes</td><td>Empty, or <code>ExtraArgsV1(&#123;nativePayment: true&#125;)</code>. <code>nativePayment: false</code> reverts with <code>LinkPaymentNotSupported</code>.</td></tr>
          </tbody>
        </table>

        <h2 id="porting">Porting from Chainlink VRF v2.5</h2>
        <table>
          <thead>
            <tr><th>Chainlink</th><th>Arc VRF</th></tr>
          </thead>
          <tbody>
            <tr><td><code>VRFConsumerBaseV2Plus</code></td><td><code>ArcVRFConsumerBase</code></td></tr>
            <tr><td><code>VRFV2PlusWrapperConsumerBase</code></td><td><code>ArcVRFWrapperConsumerBase</code> (native path only)</td></tr>
            <tr><td><code>VRFV2PlusClient</code></td><td><code>ArcVRFClient</code>, same structs and same <code>0x92fd1338</code> extraArgs tag</td></tr>
            <tr><td><code>fundSubscription</code> with LINK</td><td><code>fundSubscriptionWithNative</code> with USDC</td></tr>
            <tr><td>Empty <code>extraArgs</code> means LINK</td><td>Empty <code>extraArgs</code> means USDC</td></tr>
            <tr><td><code>requestRandomness</code> (LINK)</td><td>Removed; use <code>requestRandomnessPayInNative</code></td></tr>
            <tr><td>3+ confirmations typical</td><td>0 confirmations</td></tr>
          </tbody>
        </table>

        <h2 id="billing">What you pay</h2>
        <p>All amounts are native USDC (18 decimals). Arc’s base fee is priced in USDC and smoothed, so costs stay stable in dollars.</p>
        <h3>Subscription, charged after each fulfilment</h3>
        <pre><code>{`payment = gasPrice × (gasAfterPaymentCalculation + gasUsed) × (100 + premium%) / 100
        + flatFeePPM × 10¹²`}</code></pre>
        <h3>Direct funding, quoted at request time</h3>
        <pre><code>{`price = gasPrice × wrapperGasOverhead
      + gasPrice × (callbackGasLimit + coordinatorOverhead + numWords × perWordOverhead) × (100 + premium%) / 100
      + flatFeePPM × 10¹²`}</code></pre>
        <p>
          Arc’s mempool drops transactions with <code>maxFeePerGas</code> below 20 gwei, so quotes use at least 20 gwei.
        </p>

        <h2 id="security">Security guidance</h2>
        <ul>
          <li>Your <code>fulfillRandomWords</code> must not revert. Do heavy work in a later transaction.</li>
          <li>Never re-request because an answer is slow. Re-requesting lets an operator pick between outcomes.</li>
          <li>Lock user inputs (bets, entries) before you request, not after.</li>
          <li>Use <code>requestId</code> to match responses to requests; answers can arrive in any order.</li>
          <li>Only the coordinator (or wrapper) can call your callback; the base contracts enforce this.</li>
          <li>Trust model at launch: one operator and one key. The operator can delay an answer but can’t choose it. The coordinator owner can change fees and keys.</li>
        </ul>

        <h2 id="how">How the randomness is made</h2>
        <p>
          Two ingredients nobody controls alone go into each result: the node’s secret key, committed in advance by
          its registered public key, and the hash of the block your request landed in. The node computes
          <code> γ = sk · hashToCurve(pk, seed)</code> and a proof (Goldberg et al., secp256k1 + Keccak). The coordinator
          verifies the proof with <code>VRF.sol</code> and derives the randomness itself as <code>keccak256(3, γ)</code>.
          A different number would need a different γ, which fails verification. Every request page in this dashboard
          shows these steps with the real values.
        </p>
        <p>
          Block hashes older than 256 blocks (about 2 minutes on Arc) come from Arc’s EIP-2935 history contract, then
          from the <code>BlockhashStore</code>.
        </p>

        <h2 id="addresses">Addresses</h2>
        <Addresses />
      </article>
    </div>
  )
}
