# Deployment and operations

This guide takes you from an empty server to a running Arc VRF service, then covers day-to-day operation. For how the system works, see [ARCHITECTURE.md](ARCHITECTURE.md).

## What you are running

| Piece | Where | Copies | Holds keys |
|---|---|---|---|
| Contracts | Arc, deployed once from your laptop | — | Owned by the deployer key |
| `vrf-node` | Docker on your server | **Exactly 1** | Proving key + node transaction key |
| `web` (dashboard) | Docker on your server | 1 or more | None |

Both services come from one Docker image (`Dockerfile`) and are defined in `docker-compose.yml`. The node has no public port. The website listens on port 3000.

## Prerequisites

- **Laptop** (deploys contracts): Node 22+, pnpm 10, [Foundry](https://getfoundry.sh) or [Arc Foundry](https://docs.arc.io/arc/tutorials/install-arc-foundry.md), git.
- **Server** (runs the services): Docker with the Compose plugin, git. 1 vCPU and 1 GB RAM is enough.
- **USDC** for gas: about 3 USDC for the deployer and 1 USDC for the node. On testnet, use the faucet at https://faucet.circle.com.

Run `make help` at any time to list every command.

## Keys

| Key | What it does | Fund it? | Lives on |
|---|---|---|---|
| `VRF_PROVING_KEY` | Computes the randomness. Anyone holding it can predict results. | Never | Server |
| `NODE_TX_KEY` | Pays gas for answers (about 0.005 USDC each). | ~1 USDC, top up over time | Server |
| `DEPLOYER_KEY` | Deploys and owns the contracts, sets fees, withdraws earnings. | ~3 USDC | Laptop only |

`make keys` generates all three into `.env` (mode 600) and refuses to overwrite an existing `.env`. Never commit `.env` and never paste keys into chats, tickets or logs.

## Step 1: generate keys (laptop)

```bash
git clone git@github.com:HimanshuM685/arc-vrf.git && cd arc-vrf
make install
make keys
```

`make keys` prints the deployer and node addresses. Review `.env`: `RPC_URL` defaults to Arc testnet.

## Step 2: fund the addresses

Send USDC to both printed addresses: about 3 to the deployer, about 1 to the node.

## Step 3: deploy the contracts (laptop)

```bash
make deploy-contracts
```

This builds the contracts and deploys the `BlockhashStore`, coordinator, batch helper, wrapper and the two sample games. It registers the proving key, sets fees from `.env`, creates and funds the wrapper's and the samples' subscriptions, then writes `contracts/deployments/<chainId>.json` and regenerates the SDK.

Commit and push that deployment file. The Docker image reads contract addresses from it at build time.

```bash
git add contracts/deployments packages/sdk && git commit -m "deploy: arc testnet" && git push
```

## Step 4: start the services (server)

```bash
git clone git@github.com:HimanshuM685/arc-vrf.git && cd arc-vrf
# Copy .env from your laptop, then remove the deployer key from the server copy:
sed -i '/^DEPLOYER_KEY=/d' .env
make up
```

`make up` builds the image and starts both services in the background. They restart automatically after a crash or reboot.

## Step 5: check it

```bash
make health
```

Expected output:

```
{"web":"ok"}
{"node":"ok","lastPollAt":"…","head":"…","pending":0,"lastFulfilAt":null,"balanceUsdc":"1","lastError":null}
```

`node` reads `stale` if it hasn't polled the chain in the last 30 s. Then open the dashboard on port 3000, go to **Playground** and roll the dice: the answer should arrive within a few seconds.

## Step 6: HTTPS

Put a TLS-terminating proxy in front of port 3000. The simplest is [Caddy](https://caddyserver.com), which gets certificates automatically:

```bash
caddy reverse-proxy --from vrf.example.com --to :3000
```

Any load balancer, nginx or Cloudflare Tunnel works the same way. Point uptime monitors at `https://vrf.example.com/api/health`.

## Environment variables

Set in `.env` next to `docker-compose.yml`. Only the variables a service needs are passed into its container: the website never receives a key, and `DEPLOYER_KEY` never enters either container.

### Server

| Variable | Default | Purpose |
|---|---|---|
| `RPC_URL` | `https://rpc.testnet.arc.io` | Arc RPC. Comma-separate several for failover; the first is preferred. |
| `VRF_PROVING_KEY` | required | Proving key (hex private key). |
| `NODE_TX_KEY` | required | Key that sends fulfilment transactions. |
| `COORDINATOR` | from deployment file | Override the coordinator address. |
| `START_BLOCK` | deployment block | Block the node starts scanning from on boot. |
| `POLL_MS` | `500` | How often the node polls for new requests. |
| `ALERT_WEBHOOK_URL` | empty (off) | Discord or Slack incoming-webhook URL. |
| `MIN_BALANCE_USDC` | `1` | Alert when the node's gas balance drops below this. |
| `WEB_PORT` | `3000` | Host port for the website. |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | empty | Enables WalletConnect and mobile wallets ([cloud.reown.com](https://cloud.reown.com)). Build-time. |
| `NEXT_PUBLIC_ARC_TESTNET_RPC`, `NEXT_PUBLIC_ARC_MAINNET_RPC` | public RPC | RPC the dashboard uses in users' browsers. Build-time. |

`NEXT_PUBLIC_*` values are baked into the image, so run `make up` again after changing them.

### Laptop only (contract deployment)

| Variable | Default | Purpose |
|---|---|---|
| `DEPLOYER_KEY` | required | Deploys and owns the contracts. |
| `PREMIUM_PCT` | `50` | Subscription premium on top of gas, in percent. |
| `WRAPPER_PREMIUM_PCT` | `60` | Direct-funding premium, in percent. |
| `FLAT_FEE_PPM` | `0` | Flat fee per request, in millionths of a USDC. |
| `MAX_GAS_PRICE_GWEI` | `500` | Gas lane cap: the node won't be paid above this gas price. |
| `WRAPPER_FUNDING_USDC` | `1` | Initial funding of the wrapper's subscription. |
| `EXAMPLE_FUNDING_USDC` | `0.5` | Initial funding of the sample game's subscription. |

## Operations

### Everyday commands (server)

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
