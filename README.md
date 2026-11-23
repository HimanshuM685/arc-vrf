# Arc VRF

**Verifiable random numbers for smart contracts on [Arc](https://docs.arc.io), paid in native USDC.**

On Arc, `PREVRANDAO` always returns 0, so contracts have no on-chain source of randomness. Arc VRF fills that gap: every random number arrives with a cryptographic proof, and the coordinator contract verifies that proof on-chain before your contract sees the number. Nobody, including the operator, can choose the result.

Arc VRF is a port of Chainlink VRF v2.5. The contracts, proof format and request shapes are the same, so existing VRF v2.5 consumers port with a few renames. LINK is gone: all fees are paid in USDC, Arc's native gas token.

## Features

- **Two ways to pay.** *Subscriptions*: fund one balance and let up to 100 contracts spend it. *Direct funding*: your contract pays per request through the wrapper, at a price quoted up front.
- **Fast.** 0 confirmations by default, because Arc finalises a block when it is included. Answers usually land within a couple of blocks.
- **Verifiable.** ECVRF on secp256k1 (Chainlink's `VRF.sol`, unchanged). The dashboard shows every step of how each number was derived, with the real values.
- **Old requests still work.** Block hashes come from `BLOCKHASH`, then Arc's EIP-2935 history contract (~8191 blocks), then a `BlockhashStore`.
- **Built to run unattended.** Stateless node that never answers a request twice, retries failed answers with backoff, fails over between RPC endpoints, and sends alerts to Discord or Slack.
- **Dashboard.** Manage subscriptions, price direct-funding requests, and trace any request.

## Architecture

```
                 users / your dApps
                        │ HTTPS (your load balancer, Cloudflare, Caddy…)
             ┌──────────▼──────────┐
             │ web  × N            │  Next.js dashboard. Stateless, holds no keys. Scale freely.
             └─────────────────────┘
             ┌─────────────────────┐
             │ vrf-node  × 1       │  Watches requests, proves, answers. Holds the keys.
             └──────────┬──────────┘  No public port. Exactly one copy.
                        │ RPC (comma-separated list = automatic failover)
       Arc contracts: ArcVRFCoordinator, ArcVRFWrapper, BlockhashStore
```

The contracts are on-chain and permanent. The node is the only piece that must stay up; if it stops, requests wait on-chain and are answered when it comes back.

How one request flows:

```
 your contract ──requestRandomWords──▶ ArcVRFCoordinator ──emits RandomWordsRequested
                                                                   │
                                   vrf-node polls logs ◀───────────┘
                                   seed = keccak(preSeed, blockHash)
                                   proof = ECVRF(provingKey, seed)
                                                                   │
 ArcVRFCoordinator ◀──fulfillRandomWords(proof)────────────────────┘
   1. verifies the proof (VRF.sol)
   2. randomness = keccak256(3, γ), expanded to numWords
   3. calls your fulfillRandomWords(requestId, words)
   4. charges the subscription for the gas used + premium
```

The full design (components, the two payment paths, how the node stays correct across restarts, billing) is in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Repository layout

| Path | What it is |
|---|---|
| `contracts/` | Foundry project: coordinator, wrapper, consumer base contracts, `BlockhashStore`, sample games, tests |
| `node/` | TypeScript VRF node: proof generator (port of Chainlink's Go prover), request listener, deploy and e2e scripts |
| `packages/sdk/` | ABIs, Arc chain definitions, deployment addresses and fee formulas shared by the node and the web app |
| `apps/web/` | Next.js dashboard and the developer docs (`/docs`) |
| `docs/` | Deployment and architecture guides |
| `Dockerfile`, `docker-compose.yml`, `Makefile` | Production stack: one image, two services, everyday commands |

## Arc testnet deployment

| Contract | Address |
|---|---|
| Coordinator | `0xe852aab2d5c609b89ea2b39e1451608d8649827a` |
| Wrapper (direct funding) | `0xd854d5f611938f60d614a69ec58033d37af54d75` |
| Key hash | `0xcf39e27191d1d13c8fec1a175eda831392ef974fe21a5a0a0680c3a22c6deb88` |
| BlockhashStore | `0x57b28753a79edcea25f1790c971135a853ef82e2` |
| Batch helper | `0x8861dcba2d13d6d0723c9b7e56a0d88758dc8273` |

Chain ID 5042002, RPC `https://rpc.testnet.arc.io`, gas paid in USDC. The source of truth is [`contracts/deployments/5042002.json`](contracts/deployments/5042002.json); the dashboard's Docs page always shows the current addresses.

## Use it from a contract

Add the contracts to your Foundry project:

```bash
forge install HimanshuM685/arc-vrf
echo 'arc-vrf/=lib/arc-vrf/contracts/src/' >> remappings.txt
```

Then inherit `ArcVRFConsumerBase`:

```solidity
import {ArcVRFConsumerBase} from "arc-vrf/ArcVRFConsumerBase.sol";
import {ArcVRFClient} from "arc-vrf/libraries/ArcVRFClient.sol";

contract Raffle is ArcVRFConsumerBase {
  constructor(address coordinator) ArcVRFConsumerBase(coordinator) {}

  function draw(bytes32 keyHash, uint256 subId) external returns (uint256) {
    return s_vrfCoordinator.requestRandomWords(ArcVRFClient.RandomWordsRequest({
      keyHash: keyHash, subId: subId, requestConfirmations: 0,
      callbackGasLimit: 150_000, numWords: 1, extraArgs: ArcVRFClient.nativeExtraArgs()
    }));
  }

  function fulfillRandomWords(uint256, uint256[] calldata words) internal override {
    // words[0] is your random number. This function must not revert.
  }
}
```

Create and fund a subscription on the dashboard, then add the contract as a consumer. The dashboard's Docs page walks through both payment methods step by step.

## Run it locally

Requires Node 22+, pnpm 10 and [Foundry](https://getfoundry.sh).

```bash
make install                 # JS dependencies
make test                    # contract tests, node tests, web build
pnpm e2e                     # full end-to-end run on a local chain
```

`pnpm e2e` starts anvil, deploys everything, runs the node, plays both sample games (one per payment method) and checks the charges. To keep the chain and node running and open the dashboard against it:

```bash
KEEP=1 pnpm e2e              # leave it running
pnpm dev                     # http://localhost:3000, defaults to the local chain
```

Contract tests generate real VRF proofs through the TypeScript prover (`forge test --ffi`). The node tests also check the prover against a real Chainlink proof from Base Sepolia. CI (`.github/workflows/ci.yml`) runs all of this plus the Docker build on every push and pull request.

## Deploy to production

Needs Docker, Node 22+, pnpm 10, Foundry and some USDC for gas.

```bash
make install
make keys               # creates .env with fresh keys, prints 2 addresses
# send USDC to both printed addresses (~3 deployer, ~1 node)
make deploy-contracts   # deploys contracts, writes contracts/deployments/<chainId>.json
make up                 # builds and starts the website and the VRF node
make health             # {"web":"ok"} and "node":"ok"
```

**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** has every environment variable and the full guide: key handling, every environment variable, health checks, alerts, scaling, updates, key rotation and troubleshooting. Run `make help` for all commands.

## Security and trust model

- **Three keys, separated.** The *proving key* computes randomness and never holds funds. The *node transaction key* only pays gas for answers. The *deployer key* owns the contracts and is removed from `.env` after deploying, so the running services never hold it.
- **The operator can delay an answer but cannot choose it.** A different number would need a different proof, which fails verification on-chain. Anyone who holds the proving key can *predict* results, so keep it secret.
- **One operator at launch.** The coordinator owner can change fees and register or remove keys.
- **Not audited yet.** The changes from Chainlink VRF v2.5 are small and covered by tests, but treat this as testnet software until an audit is done.

## Status and roadmap

Running on Arc testnet. Not done yet: batch fulfilment in the node (the batch contract is deployed), an indexer (the dashboard reads logs directly), measured Arc gas overheads, KMS key storage, an audit, a second operator, mainnet.

## License

See [`NOTICE`](NOTICE). Derived from Chainlink VRF v2.5.
