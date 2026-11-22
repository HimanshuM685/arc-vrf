# Arc VRF

Verifiable random numbers for smart contracts on [Arc](https://docs.arc.io), paid in native USDC.
A fork of Chainlink VRF v2.5 with LINK removed, 0-confirmation requests, and an EIP-2935 block-hash fallback.

Both payment methods ship: **subscriptions** (fund once, add consumers) and **direct funding** (pay per request through the wrapper).

```
contracts/      Foundry: ArcVRFCoordinator, ArcVRFWrapper, consumer bases, VRF.sol (unchanged), samples, tests
node/           TypeScript VRF node: proof generator (port of Chainlink's Go prover), listener, deploy + e2e scripts
packages/sdk/   ABIs, Arc chains, deployments, fee formulas — shared by node and web
apps/web/       Next.js dashboard: overview, subscription manager, direct-funding fee calculator, request trace, playground, docs
```

## How it runs

```
                 users / your dApps
                        │ HTTPS (your load balancer, Cloudflare, Caddy…)
             ┌──────────▼──────────┐
             │ web  × N            │  Next.js dashboard. Stateless, no keys. Scale freely.
             └─────────────────────┘
             ┌─────────────────────┐
             │ vrf-node  × 1       │  Watches requests, proves, answers. Holds the keys.
             └──────────┬──────────┘  No public port. Exactly one copy.
                        │ RPC (comma-separated list = automatic failover)
                  Arc contracts: coordinator, wrapper, BlockhashStore
```

One Docker image, two services (`docker-compose.yml`). The contracts are on-chain and permanent; the node is the only piece that must stay up. If it stops, requests wait on-chain and are answered as soon as it is back.

## Production in 4 steps

You need Docker on the server. On your laptop: Node 22+, pnpm 10 and [Foundry](https://getfoundry.sh) (or [Arc Foundry](https://docs.arc.io/arc/tutorials/install-arc-foundry.md)). Run `make help` for every command.

**1. Keys (laptop).** Creates `.env` with three fresh keys and prints the two addresses to fund:

```bash
make install && make keys
```

| Key | What it does | Fund it? |
|---|---|---|
| `VRF_PROVING_KEY` | Computes the randomness. Anyone holding it can predict results. | Never |
| `NODE_TX_KEY` | Pays gas for answers (~0.005 USDC each). | ~1 USDC, top up over time |
| `DEPLOYER_KEY` | Deploys and owns the contracts, sets fees, withdraws earnings. | ~3 USDC |

**2. Fund** the deployer and node addresses (testnet: https://faucet.circle.com).

**3. Deploy the contracts (laptop).** Uses `RPC_URL` from `.env` (testnet by default), writes `contracts/deployments/<chainId>.json` and updates the SDK. Commit and push that file so the server builds with the new addresses.

```bash
make deploy-contracts
```

**4. Run (server).** Clone the repo, copy `.env` over **without** the `DEPLOYER_KEY` line, then:

```bash
make up
```

Check it with `make health`: you want `{"web":"ok"}` and `"node":"ok"`. The site is on port 3000 (`WEB_PORT`). Put your HTTPS proxy in front, for example `caddy reverse-proxy --from vrf.example.com --to :3000`.

## Operations

| Task | How |
|---|---|
| Health | `make health`, or have an uptime monitor hit `/api/health` on the site. The node's own health (polling, pending requests, gas balance) is on port 8080 inside its container. |
| Logs | `make logs` (rotated automatically, 3 × 10 MB per service) |
| Alerts | Set `ALERT_WEBHOOK_URL` to a Discord or Slack incoming webhook. You get a message for: low gas balance (below `MIN_BALANCE_USDC`), no successful RPC poll for 60 s and its recovery, a request still failing after 5 attempts, node restarts. Each kind is sent at most every 30 min. |
| RPC failover | `RPC_URL=https://rpc.testnet.arc.io,https://rpc.drpc.testnet.arc.io,https://rpc.quicknode.testnet.arc.io`. The first is preferred; the node switches when one errors or rate-limits. |
| Top up gas | Send USDC to the node address (printed by `make keys`, also in the node's startup log). |
| Update | `make update` (git pull, rebuild, restart; pending requests are picked up again) |
| Scale the site | `web` is stateless: run more copies (other servers, or `docker compose up --scale web=3` after removing its fixed port mapping) behind your load balancer. Never run more than one `vrf-node`: two would race to answer the same requests. |
| Rotate the proving key | Generate a new key, register it on the coordinator, point the wrapper and your consumers at the new key hash, deregister the old one (or redeploy on testnet). |
| Fees earned | Accrue in the coordinator (subscriptions) and the wrapper (direct funding). The deployer withdraws them with `withdrawNative`; the wrapper's subscription can be topped up from the dashboard. |

Rebuild the image (`make up`) after every contract deploy: the contract addresses are baked into it.

## Develop locally

```bash
make install
pnpm contracts:build && pnpm --filter @arc-vrf/sdk gen
```

```bash
make test
```

Contract tests generate real VRF proofs through the TypeScript prover (`forge test --ffi`). The node tests also verify the prover against a real Chainlink proof from Base Sepolia (`node/test/fixtures`).

```bash
pnpm e2e
```

Starts anvil, deploys everything, runs the node, plays HiLoGame (subscription) and DiceDirect (direct funding), and checks both subscriptions were charged. `KEEP=1 pnpm e2e` leaves the chain and node running; then `pnpm dev` opens the dashboard on http://localhost:3000, defaulting to the local chain.

Without Docker, the node also runs directly: `set -a && . ./.env && set +a && pnpm vrf-node`.

CI (`.github/workflows/ci.yml`) runs the contract tests, node tests, web build, node bundle and Docker build on every push and pull request.

## Design notes

- **USDC only.** `extraArgs` may be empty or `ExtraArgsV1({nativePayment: true})`; `nativePayment: false` reverts with `LinkPaymentNotSupported`.
- **0 confirmations.** Arc finalises on inclusion; the field stays for apps that want more.
- **Old block hashes.** `BLOCKHASH` → EIP-2935 history (`0x0000F908…2935`, ~8191 blocks) → `BlockhashStore`.
- **Pull-safe refunds.** If a cancellation refund can't be sent (Arc blocklist), it's held for `withdrawRefund(recipient)`.
- **Stateless node.** A request is pending iff `s_requestCommitments(requestId) != 0`, so restarts never double-fulfil, and failed answers retry with backoff until they land.
- **Deploys in TypeScript**, not a forge script: subscription IDs depend on the previous block hash, so a forge simulation's IDs don't match what lands on-chain.

## Not done yet (later milestones)

Batch fulfilment in the node (the contract is deployed), an indexer (the dashboard reads logs directly), measured Arc gas overheads, KMS key storage, audit, a second operator, mainnet. See `NOTICE` for licensing.
