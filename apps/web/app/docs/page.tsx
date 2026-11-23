import type { Metadata } from 'next'
import { Addresses } from './addresses'

export const metadata: Metadata = { title: 'Docs · Arc VRF' }

const toc = [
  ['Get started', [
    ['overview', 'Overview'],
    ['subscription', 'Quick start: subscription'],
    ['direct', 'Quick start: direct funding'],
  ]],
  ['Concepts', [
    ['lifecycle', 'How a request works'],
    ['how', 'How the randomness is made'],
    ['billing', 'What you pay'],
  ]],
  ['Using the dashboard', [
    ['dash-subscriptions', 'Subscriptions'],
    ['dash-direct', 'Direct funding'],
    ['dash-requests', 'Tracing a request'],
    ['dash-playground', 'Playground'],
  ]],
  ['Reference', [
    ['params', 'Request parameters'],
    ['porting', 'Porting from Chainlink'],
    ['security', 'Security guidance'],
    ['troubleshooting', 'Troubleshooting'],
    ['addresses', 'Addresses'],
  ]],
] as const

const REPO = 'https://github.com/HimanshuM685/arc-vrf'

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
        <div className="sticky top-8 space-y-6 text-sm">
          {toc.map(([group, items]) => (
            <div key={group}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{group}</p>
              <ul className="space-y-1.5">
                {items.map(([id, label]) => (
                  <li key={id}>
                    <a href={`#${id}`} className="text-muted hover:text-ink">{label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>
      <article className="prose-doc min-w-0">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Docs</h1>
        <p className="text-lg text-muted">
          Everything you need to add verifiable randomness to a contract on Arc: how to request it, what it costs, how
          to use this dashboard, and how the system works underneath.
        </p>

        {/* ───────────── Get started ───────────── */}

        <h2 id="overview">Overview</h2>
        <p>
          On Arc, <code>PREVRANDAO</code> always returns 0, so a contract has no safe source of randomness of its own.
          Arc VRF provides it: your contract asks for random numbers, an off-chain node computes them with a secret key
          and a proof, and the coordinator contract checks the proof on-chain before passing the numbers to your
          contract. Nobody, including the operator, can choose the result.
        </p>
        <p>
          Arc VRF is Chainlink VRF v2.5 adapted to Arc: the same contracts, proof and request shapes, billed in native
          USDC, with no LINK anywhere. If you’ve used VRF v2.5, you already know how to use it.
        </p>
        <p>There are two ways to pay. Both use the same coordinator, proof and callback.</p>
        <table>
          <thead>
            <tr><th></th><th>Subscription</th><th>Direct funding</th></tr>
          </thead>
          <tbody>
            <tr><th>Who pays</th><td>A shared USDC balance you fund in advance</td><td>Your contract, with each request</td></tr>
            <tr><th>Price</th><td>Gas actually used, plus premium, charged after delivery</td><td>Quoted up front at the request’s gas price</td></tr>
            <tr><th>Setup</th><td>Create, fund, add consumer contracts</td><td>None</td></tr>
            <tr><th>Inherit</th><td><code>ArcVRFConsumerBase</code></td><td><code>ArcVRFWrapperConsumerBase</code></td></tr>
            <tr><th>Limits</th><td>100 consumers, 500 words per request</td><td>10 words per request</td></tr>
            <tr><th>Best for</th><td>Regular requests, several contracts</td><td>Occasional requests, end users paying</td></tr>
          </tbody>
        </table>

        <h2 id="subscription">Quick start: subscription</h2>
        <ol>
          <li>Connect a wallet on <a href="/subscriptions">Subscriptions</a>, create a subscription and fund it with USDC.</li>
          <li>Deploy a contract that inherits <code>ArcVRFConsumerBase</code>, passing the coordinator address, the key hash and your subscription ID (all listed under <a href="#addresses">Addresses</a>).</li>
          <li>Add the contract as a consumer of the subscription.</li>
          <li>Call it. The node answers with a proof, the coordinator verifies it and calls <code>fulfillRandomWords</code>, usually within a couple of blocks.</li>
        </ol>
        <pre><code>{subscriptionCode}</code></pre>
        <p>
          The contracts live in <a href={`${REPO}/tree/main/contracts/src`}><code>contracts/src</code></a> of the
          repository. With Foundry, add the repo as a dependency and remap{' '}
          <code>arc-vrf/=lib/arc-vrf/contracts/src/</code>, or copy the files in.
        </p>

        <h2 id="direct">Quick start: direct funding</h2>
        <ol>
          <li>Deploy a contract that inherits <code>ArcVRFWrapperConsumerBase</code>, passing the wrapper address.</li>
          <li>Make sure it holds, or is sent, enough USDC. Check the price on <a href="/direct-funding">Direct funding</a>.</li>
          <li>Call <code>requestRandomnessPayInNative</code>. It quotes and pays in one call; the excess stays in your contract.</li>
        </ol>
        <pre><code>{directCode}</code></pre>
        <p>If your callback reverts, the wrapper emits <code>WrapperFulfillmentFailed</code> instead of reverting. There is no refund.</p>

        {/* ───────────── Concepts ───────────── */}

        <h2 id="lifecycle">How a request works</h2>
        <ol>
          <li><strong>Request.</strong> Your contract calls <code>requestRandomWords</code> (or the wrapper does it for you). The coordinator checks your contract is allowed to use the subscription, stores a commitment to the request and emits <code>RandomWordsRequested</code>. You get a <code>requestId</code> back immediately.</li>
          <li><strong>Seed.</strong> The node sees the event. The seed combines a value fixed by your request with the hash of the block your request landed in, which nobody knew in advance.</li>
          <li><strong>Prove.</strong> The node computes the random value from the seed with its secret key, plus a proof that it used the key registered on-chain.</li>
          <li><strong>Verify.</strong> The node submits the proof. The coordinator checks it against the stored commitment and the registered key. A wrong or altered value fails here.</li>
          <li><strong>Deliver.</strong> The coordinator expands the value into <code>numWords</code> numbers and calls your <code>fulfillRandomWords</code> with exactly <code>callbackGasLimit</code> gas. The commitment is deleted, so a request can only be answered once.</li>
          <li><strong>Charge.</strong> The subscription pays for the gas used plus the premium, whether or not your callback succeeded.</li>
        </ol>
        <p>
          If the node is offline, requests simply wait on-chain and are answered when it returns. If an answer fails
          (for example the subscription is empty), the node keeps retrying, so funding the subscription is enough to
          unblock it.
        </p>

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
          Block hashes older than 256 blocks (about 2 minutes on Arc) come from Arc’s EIP-2935 history contract (about
          8191 blocks), then from the <code>BlockhashStore</code>, so slow answers still verify.
        </p>

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
          The current premium and flat fee are shown under Network on the <a href="/">Overview</a> page.
        </p>

        {/* ───────────── Using the dashboard ───────────── */}

        <h2 id="dash-subscriptions">Subscriptions</h2>
        <p>
          <a href="/subscriptions">Subscriptions</a> lists the subscriptions your connected wallet created and lets you
          create a new one. Open a subscription to manage it:
        </p>
        <ul>
          <li><strong>Balance</strong>: current USDC balance, owner, number of fulfilled requests, and whether requests are pending. Anyone can add funds.</li>
          <li><strong>Consumers</strong>: the contracts allowed to request against this balance (up to 100). The owner adds and removes them. Removal is blocked while requests are pending.</li>
          <li><strong>How far the balance goes</strong>: enter your callback gas limit to see the worst-case cost per request and the minimum number of requests the balance covers. Real charges are usually much lower.</li>
          <li><strong>Ownership</strong>: offer the subscription to another address (they must accept), or cancel it and refund the balance. Cancelling is permanent and waits until no requests are pending.</li>
          <li><strong>Requests</strong>: the latest 50 requests with the consumer, words, amount charged and status. Click a request to trace it.</li>
        </ul>
        <table>
          <thead>
            <tr><th>Status</th><th>Meaning</th></tr>
          </thead>
          <tbody>
            <tr><td>Waiting for proof</td><td>Requested, not answered yet. Usually takes a few seconds.</td></tr>
            <tr><td>Delivered</td><td>Proof verified and your callback ran successfully.</td></tr>
            <tr><td>Callback reverted</td><td>Proof verified, but your <code>fulfillRandomWords</code> reverted. The request is charged and not retried.</td></tr>
          </tbody>
        </table>

        <h2 id="dash-direct">Direct funding</h2>
        <p>
          <a href="/direct-funding">Direct funding</a> shows whether the wrapper is accepting requests and its
          configuration. The <strong>fee calculator</strong> prices a request for a given callback gas limit and number
          of words at the current gas price, so you know how much USDC your contract must hold or send. Below it is a
          list of recent direct-funding requests.
        </p>

        <h2 id="dash-requests">Tracing a request</h2>
        <p>
          Every request has a page at <code>/requests/&lt;requestId&gt;</code>, linked from subscription histories and
          the playground. It shows who asked and with what parameters, the answer and what it cost, and a step-by-step
          derivation of the number: seed, block hash, γ and the final randomness, each with the real on-chain value and
          a check that they match. Share the link with anyone who wants to verify a result.
        </p>

        <h2 id="dash-playground">Playground</h2>
        <p>
          <a href="/playground">Playground</a> runs two sample contracts so you can see a full round-trip before writing
          any code. <strong>Hi-Lo</strong> uses a subscription: guess whether the next ball (1 to 20) is higher or
          lower; the game’s subscription pays and you pay only gas. <strong>Dice</strong> uses direct funding: each roll
          pays the wrapper about the quoted price and refunds your change. Both sources are in{' '}
          <a href={`${REPO}/tree/main/contracts/src/examples`}><code>contracts/src/examples</code></a>.
        </p>

        {/* ───────────── Reference ───────────── */}

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

        <h2 id="security">Security guidance</h2>
        <ul>
          <li>Your <code>fulfillRandomWords</code> must not revert. Do heavy work in a later transaction.</li>
          <li>Never re-request because an answer is slow. Re-requesting lets an operator pick between outcomes.</li>
          <li>Lock user inputs (bets, entries) before you request, not after.</li>
          <li>Use <code>requestId</code> to match responses to requests; answers can arrive in any order.</li>
          <li>Only the coordinator (or wrapper) can call your callback; the base contracts enforce this.</li>
          <li>Trust model at launch: one operator and one key. The operator can delay an answer but can’t choose it. The coordinator owner can change fees and keys. The contracts are not yet audited.</li>
        </ul>

        <h2 id="troubleshooting">Troubleshooting</h2>
        <h3>My request is stuck on “Waiting for proof”</h3>
        <ul>
          <li><strong>Subscription balance too low.</strong> The charge is taken at delivery, so an empty subscription accepts requests but can’t pay for answers. Fund it; the node retries automatically.</li>
          <li><strong>Wrong key hash.</strong> A request with a key hash the node doesn’t serve is accepted but never answered. Use the key hash under <a href="#addresses">Addresses</a>.</li>
          <li><strong>Gas price above the lane.</strong> If Arc’s gas price is above the key’s maximum, the answer waits until it drops.</li>
          <li><strong>Node offline.</strong> Requests wait on-chain and are answered when it returns. The <a href="/">Overview</a> shows recent fulfilments.</li>
        </ul>
        <h3>The request reverted</h3>
        <ul>
          <li><code>InvalidConsumer</code>: the calling contract isn’t a consumer of that subscription. Add it on the subscription page.</li>
          <li><code>InvalidSubscription</code>: wrong subscription ID, or it was cancelled.</li>
          <li><code>LinkPaymentNotSupported</code>: <code>extraArgs</code> sets <code>nativePayment: false</code>. Use <code>ArcVRFClient.nativeExtraArgs()</code> or empty bytes.</li>
          <li><code>GasLimitTooBig</code>, <code>NumWordsTooBig</code> or <code>NumWordsTooHigh</code> (wrapper): see the limits under <a href="#params">Request parameters</a>.</li>
          <li><code>FeeTooLow</code> (direct funding): the contract sent less than the quoted price. Quote with <code>calculateRequestPriceNative</code> in the same transaction, as <code>requestRandomnessPayInNative</code> does.</li>
        </ul>
        <h3>Shows “Callback reverted”</h3>
        <p>
          Your <code>fulfillRandomWords</code> ran out of gas or reverted. The request was charged and won’t be retried.
          Raise <code>callbackGasLimit</code> or move work out of the callback, then make a new request.
        </p>
        <h3>I can’t remove a consumer or cancel a subscription</h3>
        <p>Both are blocked while the subscription has pending requests. Wait for them to be answered.</p>
        <h3>My cancellation refund didn’t arrive</h3>
        <p>
          If the refund couldn’t be sent to your address, it’s held for you. Open the subscription’s page with that
          wallet connected and use <strong>Withdraw to my address</strong>.
        </p>
        <h3>The dashboard says Arc VRF isn’t deployed</h3>
        <p>Your wallet is on a network without a deployment. Switch to Arc Testnet.</p>

        <h2 id="addresses">Addresses</h2>
        <Addresses />

        <p className="mt-10 text-sm text-muted">
          Running your own node? See the <a href={`${REPO}/blob/main/docs/DEPLOYMENT.md`}>deployment guide</a> and the{' '}
          <a href={`${REPO}/blob/main/docs/ARCHITECTURE.md`}>architecture overview</a>.
        </p>
      </article>
    </div>
  )
}
