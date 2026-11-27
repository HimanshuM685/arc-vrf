# Architecture

How Arc VRF is built and why. For running it, see [DEPLOYMENT.md](DEPLOYMENT.md). For using it from a contract, see the Docs page on the dashboard (`/docs`).

## Components

| Component | Where | Role |
|---|---|---|
| `ArcVRFCoordinator` | `contracts/src/ArcVRFCoordinator.sol` | Accepts requests, stores a commitment per request, verifies proofs, derives the random words, calls the consumer, charges the subscription. |
| `SubscriptionAPI` | `contracts/src/SubscriptionAPI.sol` | Base of the coordinator: create, fund, transfer and cancel subscriptions; consumer lists (max 100); pull-safe refunds. |
| `ArcVRFWrapper` | `contracts/src/ArcVRFWrapper.sol` | Direct funding. Owns one subscription, takes a USDC payment with each request, and forwards the answer to the requesting contract. |
| `ArcVRFConsumerBase`, `ArcVRFWrapperConsumerBase` | `contracts/src/` | What your contract inherits. Only the coordinator (or wrapper) can deliver the callback. |
| `ArcVRFClient` | `contracts/src/libraries/` | Request structs and `extraArgs` encoding (same tag as Chainlink, `0x92fd1338`). |
| `VRF.sol` | `contracts/src/vendor/` | Chainlink's ECVRF verifier, unchanged. |
| `BlockhashStore` | `contracts/src/BlockhashStore.sol` | Last-resort store for block hashes older than Arc's history window. |
| `BatchArcVRFCoordinator` | `contracts/src/BatchArcVRFCoordinator.sol` | Fulfils several requests in one transaction. Deployed; the node does not use it yet. |
| VRF node | `node/src/` | Watches for requests, generates proofs, submits answers. The only off-chain component that must be running. |
| SDK | `packages/sdk/` | Generated ABIs, chain definitions, deployment addresses and fee formulas, shared by the node and the web app. |
| Dashboard | `apps/web/` | Next.js app. Reads the chain directly from the browser; it has no database and holds no keys. |

## Request lifecycle

### Subscription path

1. The subscription owner creates a subscription, funds it with USDC (`fundSubscriptionWithNative`) and adds the consumer contract (`addConsumer`).
2. The consumer calls `requestRandomWords` on the coordinator. The coordinator checks the consumer is registered, the parameters are in range, and `extraArgs` is empty or `nativePayment: true`.
3. The coordinator computes a `preSeed` from the key hash, the sender, the subscription ID and a per-consumer nonce, stores a hash of the request (its *commitment*) under `s_requestCommitments[requestId]`, and emits `RandomWordsRequested`.
4. The node sees the event, waits the requested confirmations (0 by default), and computes `seed = keccak256(preSeed, blockHash)` using the hash of the block that holds the request.
5. The node generates an ECVRF proof for that seed with its proving key and calls `fulfillRandomWords(proof, requestCommitment)`.
6. The coordinator checks the commitment matches, recomputes the seed from the block hash, verifies the proof with `VRF.sol`, derives `randomness = keccak256(3, γ)` and expands it into `numWords` words.
7. It deletes the commitment (so the request can never be answered twice), calls the consumer's `fulfillRandomWords(requestId, words)` with exactly `callbackGasLimit` gas, and emits `RandomWordsFulfilled` with the payment and whether the callback succeeded.
8. The subscription is charged for the gas the fulfilment used plus the premium, even if the callback reverted. The charge is credited to the coordinator owner.

### Direct-funding path

1. The consumer (inheriting `ArcVRFWrapperConsumerBase`) calls `requestRandomnessPayInNative`, which asks the wrapper for the price at the current gas price and sends that much USDC with the request.
2. The wrapper checks the payment covers `calculateRequestPriceNative`, then requests from the coordinator using its own subscription, adding its own gas overhead to the callback limit.
3. Steps 4 to 8 above run as normal. The coordinator calls the wrapper, and the wrapper forwards the words to the consumer. If the consumer reverts, the wrapper emits `WrapperFulfillmentFailed` instead of reverting.
4. Payments accumulate in the wrapper. The owner withdraws them with `withdrawNative` and keeps the wrapper's subscription funded.

## Randomness

Each result depends on two inputs that nobody controls alone:

- **The node's secret proving key**, committed in advance: its public key is registered on the coordinator, and the key hash in every request names it.
- **The hash of the block your request landed in**, which is unknown when the request is sent.

The node computes `γ = sk · hashToCurve(pk, seed)` and a Goldberg-style proof (secp256k1, Keccak) that `γ` was made with the registered key. A different random number would need a different `γ`, which fails verification. So the operator can withhold or delay an answer but cannot pick it. Anyone with the proving key can *predict* results in advance, which is why the key never leaves the node.

The proof generator in `node/src/proof.ts` is a TypeScript port of Chainlink's Go prover. It is tested against a real Chainlink proof from Base Sepolia (`node/test/fixtures`), and the contract tests verify proofs it produces.

### Block hashes

Fulfilment needs the hash of the request's block. The coordinator looks in three places, in order:

1. `BLOCKHASH`: the last 256 blocks (about 2 minutes on Arc).
2. Arc's EIP-2935 history contract at `0x0000F90827F1C53a10cb7A02335B175320002935`: about 8191 blocks.
3. `BlockhashStore`: anything older, once someone has stored it.

## The node

The node (`node/src/oracle.ts`) is a single loop:

- **Push.** A WebSocket `eth_subscribe` to `RandomWordsRequested` for its key hash (the chain's WebSocket URLs). Each event joins the pending set and wakes the loop at once. A dropped socket is resubscribed with backoff on the next URL and never stops the node.
- **Safety scan.** Every `POLL_MS` (30 s; 500 ms in the e2e test), read `RandomWordsRequested` logs for its key hash in ranges of up to 10,000 blocks from the last scanned block, so nothing the socket missed is lost. On startup it begins at the deployment block (or `START_BLOCK`). While a request waits on confirmations or a retry, the loop wakes every second instead.
- **Pending set.** Requests are kept in memory. Before answering, the node checks `s_requestCommitments(requestId)`: non-zero means still pending. This is the only source of truth, so the node has no database, and a restart re-scans logs and safely picks up exactly the unanswered requests. A request is never answered twice.
- **Answer.** Generate the proof, send `fulfillRandomWords`, wait for the receipt.
- **Retry.** A failed answer (RPC error, subscription underfunded, gas price above the lane's cap) is retried with exponential backoff from 1 s to 60 s, without limit. After the fifth failure it sends an alert.
- **Watchdog.** A separate timer raises an alert if no scan has succeeded for 60 s (or three `POLL_MS`, if longer). This matters because a stalled RPC can hang calls instead of failing them. A recovery alert follows when polling resumes.
- **Balance check.** Every 10 minutes, alerts when the transaction key's balance drops below `MIN_BALANCE_USDC`.
- **Supervisor.** `node/src/start.ts` validates the configuration up front (bad keys fail immediately), then restarts the loop 5 s after any crash, alerting each time.
- **Health.** `GET 127.0.0.1:8080` returns JSON: `node` (`ok` or `stale`, stale after three `POLL_MS` without a scan, at least 30 s), last poll time, chain head, pending count, last fulfilment, gas balance, last error. It answers 503 when stale. Docker's healthcheck uses it.
- **RPC.** Arc's public RPCs, hard-coded in `packages/sdk/src/chains.ts` (publicnode, Blockdaemon, Circle (`rpc.testnet.arc.io`), QuickNode, dRPC). Each call goes to the first and fails over to the next on any error, including rate limits. The dashboard reaches them through its own server-side `/api/rpc` proxy, which also fails over, rests an RPC that errors for 30 s, and answers logs from an in-memory index so visitors don't multiply the load.
- **Alerts** go to a Discord or Slack webhook (`node/src/alert.ts`). Each alert kind is sent at most once every 30 minutes, so a long outage produces one message.

Exactly one node may run per proving key. Two would race to answer the same requests, and the loser pays gas for a reverted transaction.

## The dashboard

`apps/web` is a Next.js app built in standalone mode. All chain reads happen in the browser through wagmi and viem: subscription state, request history (from event logs, starting at the deployment block), the request trace, fee quotes. Writes go through the user's wallet (RainbowKit). The server only serves pages and `/api/health`, so it needs no secrets and scales horizontally.

## Differences from Chainlink VRF v2.5

| Area | Chainlink VRF v2.5 | Arc VRF |
|---|---|---|
| Payment | LINK or native | Native USDC only. `nativePayment: false` reverts with `LinkPaymentNotSupported`. Empty `extraArgs` means USDC. |
| Confirmations | 3+ typical | 0. Arc has instant finality and no reorgs. Max is still 200 for apps that want more. |
| Old block hashes | `BlockhashStore` | `BLOCKHASH`, then EIP-2935 history, then `BlockhashStore`. |
| Cancellation refunds | Pushed to the recipient | Pushed, but if the transfer fails (for example the address is on Arc's blocklist) the refund is held for `withdrawRefund`. |
| Wrapper | LINK and native paths | Native path only (`requestRandomnessPayInNative`). |
| Deploys | Forge scripts | TypeScript (`node/src/deploy.ts`). Subscription IDs depend on the previous block hash, so a forge simulation's IDs would not match what lands on-chain. |

## Billing

All amounts are native USDC with 18 decimals. Arc's base fee is priced in USDC and smoothed, so costs stay stable in dollars.

Subscription, charged after each fulfilment:

```
payment = gasPrice × (gasAfterPaymentCalculation + gasUsed) × (100 + premium%) / 100
        + flatFeePPM × 10¹²
```

Direct funding, quoted and paid at request time:

```
price = gasPrice × wrapperGasOverhead
      + gasPrice × (callbackGasLimit + coordinatorOverhead + numWords × perWordOverhead) × (100 + premium%) / 100
      + flatFeePPM × 10¹²
```

Arc's mempool drops transactions with `maxFeePerGas` below 20 gwei, so quotes use at least 20 gwei. The premiums are set at deploy time (`PREMIUM_PCT`, `WRAPPER_PREMIUM_PCT`, `FLAT_FEE_PPM`) and can be changed by the owner with `setConfig`.

The same formulas are implemented in `packages/sdk/src/fees.ts` for the dashboard.
