# Deployment

Set up Arc VRF from scratch and run it in production. For how it works, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Requirements

- Docker with the Compose plugin
- Node 22+ and pnpm 10
- [Foundry](https://getfoundry.sh)
- git
- USDC for gas: ~3 for the deployer, ~1 for the node. Testnet faucet: https://faucet.circle.com

## 1. Install

```bash
git clone https://github.com/HimanshuM685/arc-vrf.git
cd arc-vrf
make install
```

## 2. Configure

```bash
make keys
```

Creates `.env` with three fresh keys and prints the deployer and node addresses. Edit `.env` for anything else in the table below. Never commit `.env`.

| Variable | Required | Default | What it does |
|---|---|---|---|
| `RPC_URL` | yes | `https://rpc.testnet.arc.io` | Arc RPC. Comma-separate several for failover; first is preferred. |
| `VRF_PROVING_KEY` | yes | set by `make keys` | Computes the randomness. Never fund it. Anyone holding it can predict results. |
| `NODE_TX_KEY` | yes | set by `make keys` | Pays gas for answers (~0.005 USDC each). |
| `DEPLOYER_KEY` | deploy only | set by `make keys` | Deploys and owns the contracts. Remove from `.env` after step 4. |
| `ALERT_WEBHOOK_URL` | no | off | Discord or Slack webhook for alerts. |
| `MIN_BALANCE_USDC` | no | `1` | Alert when the node's gas balance drops below this. |
| `WEB_PORT` | no | `3000` | Port for the website. |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | no | empty | Enables WalletConnect / mobile wallets ([cloud.reown.com](https://cloud.reown.com)). |
| `NEXT_PUBLIC_ARC_TESTNET_RPC` | no | public RPC | RPC the dashboard uses in the browser. |
| `COORDINATOR` | no | from deployment file | Override the coordinator address. |
| `START_BLOCK` | no | deployment block | Block the node starts scanning from. |
| `POLL_MS` | no | `500` | How often the node checks for requests. |
| `PREMIUM_PCT` | no | `50` | Subscription fee on top of gas, %. Used by step 4. |
| `WRAPPER_PREMIUM_PCT` | no | `60` | Direct-funding fee on top of gas, %. Used by step 4. |
| `FLAT_FEE_PPM` | no | `0` | Flat fee per request, millionths of a USDC. Used by step 4. |
| `MAX_GAS_PRICE_GWEI` | no | `500` | Highest gas price the node answers at. Used by step 4. |
| `WRAPPER_FUNDING_USDC` | no | `1` | Starting balance of the wrapper's subscription. Used by step 4. |
| `EXAMPLE_FUNDING_USDC` | no | `0.5` | Starting balance of the sample game. Used by step 4. |

`NEXT_PUBLIC_*` values are built into the website: run `make up` again after changing them.

## 3. Fund

Send USDC to the two addresses `make keys` printed: ~3 to the deployer, ~1 to the node.

## 4. Deploy the contracts

```bash
make deploy-contracts
git add contracts/deployments packages/sdk
git commit -m "deploy: arc testnet"
git push
sed -i.bak '/^DEPLOYER_KEY=/d' .env && rm .env.bak
```

Deploys the coordinator, wrapper, `BlockhashStore`, batch helper and two sample games, registers the proving key, sets fees, funds the subscriptions, and writes the addresses to `contracts/deployments/<chainId>.json`. The last line removes `DEPLOYER_KEY` so the running services never have it; keep a backup of it somewhere safe, it owns the contracts.

## 5. Run

```bash
make up
make health
```

Expected:

```
{"web":"ok"}
{"node":"ok","lastPollAt":"…","head":"…","pending":0,"lastFulfilAt":null,"balanceUsdc":"1","lastError":null}
```

The website is on port 3000. Open **Playground** and roll the dice: the answer arrives within a few seconds. Both services restart automatically after a crash or reboot.

## 6. HTTPS

```bash
caddy reverse-proxy --from vrf.example.com --to :3000
```

Or any load balancer, nginx or Cloudflare Tunnel in front of port 3000. Point uptime monitors at `https://vrf.example.com/api/health`.

## What runs

| Service | Copies | Has keys | Public |
|---|---|---|---|
| `web` | 1 or more | No | Port 3000 |
| `vrf-node` | **Exactly 1** | Proving + node keys | No port |

Both come from one Docker image. The website never receives a key.

## Operations

### Commands

| Command | Does |
|---|---|
| `make up` | Build and (re)start both services |
| `make down` | Stop both services |
| `make logs` | Follow logs from both services |
| `make health` | Print web and node health |
| `make update` | `git pull`, rebuild, restart |

Logs are rotated automatically (3 files × 10 MB per service).

### Alerts

Set `ALERT_WEBHOOK_URL` to a Discord or Slack incoming webhook. The node sends a message when:

| Alert | Trigger |
|---|---|
| Low gas balance | Node balance below `MIN_BALANCE_USDC` |
| RPC outage | No successful poll for 60 s |
| RPC recovered | Polling works again after an outage |
| Request failing | A request still fails after 5 attempts (it keeps retrying) |
| Node restart | The node loop crashed and is restarting |

Each kind is sent at most once every 30 minutes, so a long outage produces one message, not hundreds.

### Keeping the node funded

Each answer costs the node about 0.005 USDC in gas. Send USDC to the node address (printed by `make keys` and in the node's startup log). The subscriptions reimburse the coordinator, not the node, so top-ups come from fees you withdraw (below).

### Collecting fees

Fees accrue in the coordinator (subscriptions) and the wrapper (direct funding). The deployer calls `withdrawNative(recipient)` on each. Keep the wrapper's subscription funded: you can top it up from the **Direct funding** page on the dashboard.

### Updating

```bash
make update
```

Pending requests survive restarts: the node re-reads them from the chain and answers each exactly once. After redeploying contracts, commit the new deployment file and run `make update` so the image picks up the new addresses.

### Scaling

- **Website:** stateless. Run more copies on other servers behind your load balancer, or on one host remove the fixed `ports` mapping and use `docker compose up -d --scale web=3` behind a proxy.
- **Node:** never run more than one per proving key. Two nodes race to answer the same requests and waste gas on reverted transactions. If throughput ever becomes a limit, the next step is batch fulfilment through `BatchArcVRFCoordinator` (deployed, not yet used by the node).

### RPC failover

```
RPC_URL=https://rpc.testnet.arc.io,https://rpc.drpc.testnet.arc.io,https://rpc.quicknode.testnet.arc.io
```

The node uses the first URL and switches to the next when a call errors or is rate-limited. A paid RPC as the first entry is recommended for production.

### Rotating the proving key

1. Generate a new key. `VRF_PROVING_KEY=0x… pnpm --filter @arc-vrf/node register-key` prints its public key and key hash; the owner passes the public key to `registerProvingKey` on the coordinator.
2. Point the node at the new key (`VRF_PROVING_KEY`) and restart.
3. Update the wrapper's key hash and tell consumers to use the new key hash.
4. Once no requests use the old key hash, deregister it.

On testnet, redeploying with a fresh `.env` is simpler.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `make up` fails with `set VRF_PROVING_KEY in .env` | `.env` is missing or a required key is empty. |
| Node logs `missing env …` or a key error and exits | A key is malformed. Config errors stop the node at once instead of retrying. |
| Node logs `keyHash … is not registered` and keeps restarting | The deployment used a different proving key, or `COORDINATOR` points elsewhere. Redeploy, or register the key. |
| `make health` shows `"node":"stale"` | The node can't reach the RPC. Check `make logs`, add fallback URLs to `RPC_URL`. |
| Requests stay "Waiting for proof" | Check the node log for `fulfil … failed`. Common causes: the subscription balance is too low (fund it; the node retries automatically), the node is out of gas (top up), or Arc's gas price is above `MAX_GAS_PRICE_GWEI`. |
| Dashboard says "Arc VRF isn't deployed on … yet" | The image was built before the deployment file existed. Commit it and run `make update`. |
| Dashboard can't connect mobile wallets | Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` and run `make up`. |

## Running without Docker

```bash
set -a && . ./.env && set +a
pnpm vrf-node          # the node
pnpm --filter web build && pnpm --filter web start   # the website
```

Use a process manager (systemd, pm2) to restart them on failure.
