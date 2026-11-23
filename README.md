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
- **Dashboard.** Manage subscriptions, price direct-funding requests, try two sample games, and trace any request.

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
| Coordinator | `0xc97f22a52ecb0f8400a2e44a710f141a572471ae` |
| Wrapper (direct funding) | `0x5c0fa592b86102e0f82ececcd61f0e04d6cb9ab7` |
| Key hash | `0xcf39e27191d1d13c8fec1a175eda831392ef974fe21a5a0a0680c3a22c6deb88` |
| BlockhashStore | `0xe1bbc1c64add044ce831869c89afef02ab2d48d5` |

Chain ID 5042002. The source of truth is [`contracts/deployments/5042002.json`](contracts/deployments/5042002.json); the dashboard's Docs page lists the current addresses for every chain.

## Use it from a contract

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

Then create and fund a subscription on the dashboard and add the contract as a consumer. The developer guide on the site (`/docs`) covers both payment methods, every request parameter, fees, porting from Chainlink and security rules.

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

Four steps, about 15 minutes:

```bash
make install && make keys    # 1. laptop: create .env with fresh keys, print addresses to fund
                             # 2. fund the deployer and node addresses with USDC
make deploy-contracts        # 3. laptop: deploy, then commit contracts/deployments/<chainId>.json
make up                      # 4. server: build and start web + vrf-node with Docker
```

**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** is the full operator guide: key handling, every environment variable, health checks, alerts, scaling, updates, key rotation and troubleshooting. Run `make help` for all commands.

## Security and trust model

- **Three keys, separated.** The *proving key* computes randomness and never holds funds. The *node transaction key* only pays gas for answers. The *deployer key* owns the contracts and stays on your laptop, never on the server.
- **The operator can delay an answer but cannot choose it.** A different number would need a different proof, which fails verification on-chain. Anyone who holds the proving key can *predict* results, so keep it secret.
- **One operator at launch.** The coordinator owner can change fees and register or remove keys.
- **Not audited yet.** The changes from Chainlink VRF v2.5 are small and covered by tests, but treat this as testnet software until an audit is done.

## Status and roadmap

Running on Arc testnet. Not done yet: batch fulfilment in the node (the batch contract is deployed), an indexer (the dashboard reads logs directly), measured Arc gas overheads, KMS key storage, an audit, a second operator, mainnet.

## License

See [`NOTICE`](NOTICE). Derived from Chainlink VRF v2.5.
