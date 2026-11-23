import type { Metadata } from 'next'
import { REPO } from '@/lib/format'
import { Rule } from '@/components/primitives'
import { Addresses } from './addresses'

export const metadata: Metadata = { title: 'Docs · Arc VRF' }

const toc = [
  ['Start here', [
    ['addresses', 'Contract addresses'],
    ['pay', 'Two ways to pay'],
    ['install', 'Install'],
  ]],
  ['Build', [
    ['subscription', 'Use a subscription'],
    ['direct', 'Pay per request'],
    ['result', 'Check a result'],
  ]],
  ['Help', [
    ['rules', 'Rules for safe randomness'],
    ['help', 'Something went wrong?'],
    ['reference', 'Reference'],
  ]],
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

function Toc() {
  return (
    <div className="space-y-8">
      {toc.map(([group, items]) => (
        <div key={group}>
          <p className="label mb-2 border-b-2 border-ink pb-2">{group}</p>
          <ul>
            {items.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block py-1.5 text-[0.95rem] text-muted underline-offset-4 hover:text-ink hover:underline">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export default function DocsPage() {
  return (
    <div className="grid gap-12 pt-12 sm:pt-16 lg:grid-cols-[14rem_1fr]">
      <nav aria-label="On this page" className="hidden lg:block">
        <div className="no-scrollbar sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-8">
          <Toc />
        </div>
      </nav>
      <article className="prose-doc min-w-0">
        <p className="label text-muted">Documentation</p>
        <h1 className="mt-4 text-5xl leading-none font-bold tracking-tighter sm:text-7xl">Docs</h1>
        <Rule className="mt-6" />
        <p className="text-xl text-muted">
          Random numbers for your Arc contracts. Each number comes with a proof, and the chain checks that proof before
          your contract gets the number, so nobody can rig it. Not even us.
        </p>
        <details className="group mt-8 border-2 border-ink lg:hidden">
          <summary className="label flex min-h-11 cursor-pointer list-none items-center justify-between px-4 [&::-webkit-details-marker]:hidden">
            On this page
            <span aria-hidden="true" className="text-base group-open:rotate-45">+</span>
          </summary>
          <div className="border-t border-ink p-4">
            <Toc />
          </div>
        </details>

        <h2 id="addresses">Contract addresses</h2>
        <p>You need two of these in your code: the <strong>coordinator</strong> (or the <strong>wrapper</strong>) and the <strong>key hash</strong>.</p>
        <Addresses />

        <h2 id="pay">Two ways to pay</h2>
        <p>Everything is paid in USDC, Arc’s gas token. Pick the one that fits.</p>
        <div className="my-6 grid gap-4 sm:grid-cols-2">
          <div className="border-2 border-ink p-5">
            <p className="label">Subscription</p>
            <p className="mt-3">You top up one balance. Your contracts spend from it.</p>
            <p className="mt-2 text-muted">Good when you make requests often, or from several contracts.</p>
            <p className="mt-3 text-sm"><a href="#subscription">How to use it ↓</a></p>
          </div>
          <div className="border-2 border-ink p-5">
            <p className="label">Direct funding</p>
            <p className="mt-3">Your contract pays for each request as it makes it. No setup.</p>
            <p className="mt-2 text-muted">Good for the odd request, or when your users pay.</p>
            <p className="mt-3 text-sm"><a href="#direct">How to use it ↓</a></p>
          </div>
        </div>

        <h2 id="install">Install</h2>
        <p>Add the contracts to your Foundry project:</p>
        <pre><code>{`forge install HimanshuM685/arc-vrf
echo 'arc-vrf/=lib/arc-vrf/contracts/src/' >> remappings.txt`}</code></pre>
        <p>
          Not using Foundry? Copy the files from <a href={`${REPO}/tree/main/contracts/src`}><code>contracts/src</code></a> into
          your project.
        </p>

        <h2 id="subscription">Use a subscription</h2>
        <ol>
          <li>Go to <a href="/subscriptions">Subscriptions</a>, connect your wallet and click <strong>Create subscription</strong>. You get a subscription ID.</li>
          <li>Open it and <strong>fund</strong> it. 1 USDC covers plenty of test requests.</li>
          <li>Deploy your contract (example below) with the coordinator address, the key hash and your subscription ID.</li>
          <li>On the subscription page, <strong>add your contract as a consumer</strong>. Only consumers can spend the balance.</li>
          <li>Call your contract. The random number usually arrives within a few seconds.</li>
        </ol>
        <pre><code>{subscriptionCode}</code></pre>

        <h2 id="direct">Pay per request</h2>
        <ol>
          <li>Deploy your contract (example below) with the wrapper address.</li>
          <li>Send it some USDC, or have callers send it. See what a request costs on <a href="/direct-funding">Direct funding</a>.</li>
          <li>Call <code>requestRandomnessPayInNative</code>. It checks the price and pays in the same call. Anything left over stays in your contract.</li>
        </ol>
        <pre><code>{directCode}</code></pre>

        <h2 id="result">Check a result</h2>
        <p>
          Every request gets its own page at <code>/requests/&lt;requestId&gt;</code>. It shows who asked, what it cost,
          and how the number was made, step by step, with the real values from the chain. Share the link with anyone who
          wants to check it was fair.
        </p>

        <h2 id="rules">Rules for safe randomness</h2>
        <ul>
          <li><strong>Never let <code>fulfillRandomWords</code> revert.</strong> A failed callback is still charged and isn’t retried. Save the number and do heavy work later.</li>
          <li><strong>Lock bets and entries before you request.</strong> Not after the number is known.</li>
          <li><strong>Don’t re-request because an answer is slow.</strong> That would let someone pick the result they like.</li>
          <li><strong>Match answers by <code>requestId</code>.</strong> They can arrive in any order.</li>
          <li><strong>One operator for now.</strong> It can delay an answer but can’t change it. The contracts aren’t audited yet, so treat this as testnet software.</li>
        </ul>

        <h2 id="help">Something went wrong?</h2>
        <details>
          <summary>My request is stuck on “Waiting for proof”</summary>
          <ul>
            <li><strong>Subscription is empty.</strong> Requests are accepted, but paid when answered. Fund it and the answer goes through on its own.</li>
            <li><strong>Wrong key hash.</strong> Requests with an unknown key hash are never answered. Copy it from <a href="#addresses">Contract addresses</a>.</li>
            <li><strong>Gas is very expensive right now.</strong> The answer waits until the price drops.</li>
            <li><strong>The node is down.</strong> Requests wait on-chain and are answered when it’s back.</li>
          </ul>
        </details>
        <details>
          <summary>My request transaction reverted</summary>
          <ul>
            <li><code>InvalidConsumer</code>: your contract isn’t a consumer of that subscription. Add it on the subscription page.</li>
            <li><code>InvalidSubscription</code>: wrong subscription ID, or it was cancelled.</li>
            <li><code>LinkPaymentNotSupported</code>: use <code>ArcVRFClient.nativeExtraArgs()</code> or empty bytes for <code>extraArgs</code>.</li>
            <li><code>GasLimitTooBig</code> or <code>NumWordsTooBig</code>: you asked for more than the limits in <a href="#reference">Reference</a>.</li>
            <li><code>FeeTooLow</code> (direct funding): your contract sent less than the price. Use <code>requestRandomnessPayInNative</code>, which pays the right amount.</li>
          </ul>
        </details>
        <details>
          <summary>It says “Callback reverted”</summary>
          <p>
            Your <code>fulfillRandomWords</code> ran out of gas or reverted. The request was charged and won’t run again.
            Raise <code>callbackGasLimit</code> or do less in the callback, then make a new request.
          </p>
        </details>
        <details>
          <summary>A subscription with USDC I didn’t add shows up in my list</summary>
          <p>
            If you deployed the contracts with this wallet, the deploy script made the <strong>direct-funding
            pool</strong> from it and funded it (1 USDC by default). The USDC came from your wallet at deploy time. Don’t
            cancel the pool: direct funding stops working without it. Use a separate wallet for deploying to keep it out
            of your list.
          </p>
        </details>
        <details>
          <summary>I can’t remove a consumer or cancel</summary>
          <p>Both wait until the subscription has no pending requests.</p>
        </details>
        <details>
          <summary>My cancellation refund didn’t arrive</summary>
          <p>It’s held for you. Open the subscription’s page with that wallet and click <strong>Withdraw to my address</strong>.</p>
        </details>
        <details>
          <summary>The site says Arc VRF isn’t deployed</summary>
          <p>Your wallet is on another network. Switch it to Arc Testnet.</p>
        </details>

        <h2 id="reference">Reference</h2>
        <p>The details, for when you need them.</p>
        <details>
          <summary>Request parameters</summary>
          <table>
            <thead>
              <tr><th>Field</th><th>What to put</th></tr>
            </thead>
            <tbody>
              <tr><td><code>keyHash</code></td><td>The key hash from <a href="#addresses">Contract addresses</a>.</td></tr>
              <tr><td><code>subId</code></td><td>Your subscription ID. Your contract must be one of its consumers.</td></tr>
              <tr><td><code>requestConfirmations</code></td><td><code>0</code>. Arc blocks are final right away. Max 200.</td></tr>
              <tr><td><code>callbackGasLimit</code></td><td>Gas for your <code>fulfillRandomWords</code>. Max 2,500,000.</td></tr>
              <tr><td><code>numWords</code></td><td>How many numbers. Max 500 with a subscription, 10 with direct funding.</td></tr>
              <tr><td><code>extraArgs</code></td><td><code>ArcVRFClient.nativeExtraArgs()</code> or empty bytes.</td></tr>
            </tbody>
          </table>
        </details>
        <details>
          <summary>What it costs</summary>
          <p>
            <strong>Subscription:</strong> after each answer you pay for the gas it used, plus a premium. The current
            premium is on the <a href="/">Overview</a> page.
          </p>
          <pre><code>{`payment = gasPrice × (gasAfterPaymentCalculation + gasUsed) × (100 + premium%) / 100
        + flatFeePPM × 10¹²`}</code></pre>
          <p><strong>Direct funding:</strong> you pay a price quoted when you request.</p>
          <pre><code>{`price = gasPrice × wrapperGasOverhead
      + gasPrice × (callbackGasLimit + coordinatorOverhead + numWords × perWordOverhead) × (100 + premium%) / 100
      + flatFeePPM × 10¹²`}</code></pre>
          <p>Arc won’t accept a gas price below 20 gwei, so prices use at least that.</p>
        </details>
        <details>
          <summary>Coming from Chainlink VRF v2.5</summary>
          <p>Same contracts and request format, paid in USDC instead of LINK. Rename these:</p>
          <table>
            <thead>
              <tr><th>Chainlink</th><th>Arc VRF</th></tr>
            </thead>
            <tbody>
              <tr><td><code>VRFConsumerBaseV2Plus</code></td><td><code>ArcVRFConsumerBase</code></td></tr>
              <tr><td><code>VRFV2PlusWrapperConsumerBase</code></td><td><code>ArcVRFWrapperConsumerBase</code></td></tr>
              <tr><td><code>VRFV2PlusClient</code></td><td><code>ArcVRFClient</code></td></tr>
              <tr><td><code>fundSubscription</code> (LINK)</td><td><code>fundSubscriptionWithNative</code> (USDC)</td></tr>
              <tr><td><code>requestRandomness</code> (LINK)</td><td><code>requestRandomnessPayInNative</code></td></tr>
              <tr><td>3+ confirmations</td><td>0 confirmations</td></tr>
            </tbody>
          </table>
        </details>
        <details>
          <summary>How the number is made</summary>
          <ol>
            <li>Your contract asks. The coordinator saves the request and emits an event.</li>
            <li>The node takes a seed made from your request and the hash of its block. Nobody knew that hash in advance.</li>
            <li>The node turns the seed into a random value with its secret key, and makes a proof that it used the key registered on-chain.</li>
            <li>The coordinator checks the proof. A changed value fails here.</li>
            <li>Your <code>fulfillRandomWords</code> gets the numbers. Each request can only be answered once.</li>
          </ol>
          <p>
            Under the hood it’s ECVRF on secp256k1, using Chainlink’s <code>VRF.sol</code> unchanged. The randomness is{' '}
            <code>keccak256(3, γ)</code> where <code>γ = sk · hashToCurve(pk, seed)</code>.
          </p>
        </details>

        <p className="mt-12 text-sm text-muted">
          Running your own node? See the <a href={`${REPO}/blob/main/docs/DEPLOYMENT.md`}>deployment guide</a> and the{' '}
          <a href={`${REPO}/blob/main/docs/ARCHITECTURE.md`}>architecture overview</a>.
        </p>
      </article>
    </div>
  )
}
