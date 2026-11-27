# Deployment

Set up Arc VRF from scratch and run it in production. For how it works, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Requirements

- Docker with the Compose plugin
- Node 22+ and pnpm 10
- [Foundry](https://getfoundry.sh)
- git
- An [Alchemy](https://dashboard.alchemy.com) account on **Pay As You Go**, with two apps on Arc Testnet (one for the node, one for the dashboard). The free tier caps `eth_getLogs` at 10 blocks, too small for the node and dashboard scans. There is no public RPC fallback.
- USDC for gas: ~2.5 for the deployer, ~1 for the node. Testnet faucet: https://faucet.circle.com

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
| `RPC_URL` | yes | none | The node's Alchemy URL, `https://arc-testnet.g.alchemy.com/v2/<key>`. Also used by `make deploy-contracts`. |
| `ARC_TESTNET_RPC_URL` | yes | none | The dashboard's Alchemy URL. Used server-side by its `/api/rpc` proxy, never sent to browsers. |
| `ARC_MAINNET_RPC_URL` | no | empty | Same, for Arc mainnet once deployed there. |
| `VRF_PROVING_KEY` | yes | set by `make keys` | Computes the randomness. Never fund it. Anyone holding it can predict results. |
| `NODE_TX_KEY` | yes | set by `make keys` | Pays gas for answers (~0.005 USDC each). |
| `DEPLOYER_KEY` | deploy only | set by `make keys` | Deploys and owns the contracts. Remove from `.env` after step 4. |
| `ALERT_WEBHOOK_URL` | no | off | Discord or Slack webhook for alerts. |
| `MIN_BALANCE_USDC` | no | `1` | Alert when the node's gas balance drops below this. |
| `WEB_PORT` | no | `3000` | Port the website is published on (also used without Docker). Change it, then run `make up`. |
| `WEB_BIND` | no | all interfaces | Address the website port listens on (IPv4 and IPv6 when empty). Set `127.0.0.1` behind a reverse proxy on the same host (step 6). |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | no | empty | Enables WalletConnect / mobile wallets ([cloud.reown.com](https://cloud.reown.com)). |
| `COORDINATOR` | no | from deployment file | Override the coordinator address. |
| `START_BLOCK` | no | deployment block | Block the node starts scanning from. |
| `POLL_MS` | no | `30000` | Safety scan interval, in ms. Requests normally arrive instantly over WebSocket; the scan catches anything the socket missed. Each scan costs ~70 Alchemy compute units: ~6M CU/month at 30000. |
| `RPC_WS_URL` | no | `RPC_URL` with `https` → `wss` | WebSocket URL the node subscribes to requests on. Alchemy serves both on the same path, so leave it empty. |
| `PREMIUM_PCT` | no | `50` | Subscription fee on top of gas, %. Used by step 4. |
| `WRAPPER_PREMIUM_PCT` | no | `60` | Direct-funding fee on top of gas, %. Used by step 4. |
| `FLAT_FEE_PPM` | no | `0` | Flat fee per request, millionths of a USDC. Used by step 4. |
| `MAX_GAS_PRICE_GWEI` | no | `500` | Highest gas price the node answers at. Used by step 4. |
| `WRAPPER_FUNDING_USDC` | no | `1` | Starting balance of the wrapper's subscription. Used by step 4. |

`NEXT_PUBLIC_*` values are built into the website: run `make up` again after changing them.

## 3. Fund

Send USDC to the two addresses `make keys` printed: ~2.5 to the deployer, ~1 to the node.

## 4. Deploy the contracts

```bash
make deploy-contracts
git add contracts/deployments packages/sdk
git commit -m "deploy: arc testnet"
git push
sed -i.bak '/^DEPLOYER_KEY=/d' .env && rm .env.bak
```

Deploys the coordinator, wrapper, `BlockhashStore` and batch helper, registers the proving key, sets fees, funds the wrapper’s subscription, and writes the addresses to `contracts/deployments/<chainId>.json`. The last line removes `DEPLOYER_KEY` so the running services never have it; keep a backup of it somewhere safe, it owns the contracts.

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

`make health` is the node check: `"node":"ok"` means it is watching the chain. `lastPollAt` moves on every successful safety scan (and the faster scans while a request is waiting), so it can be up to ~30 s old (`POLL_MS`); the node is reported `stale` after 90 s (three missed scans). Run it again after a minute; if `lastPollAt` hasn't moved, check `make logs`. The dashboard's “Live” badge next to **Network** on `/dashboard` only shows that your browser reaches a public RPC, not that the node works.

The website is on port `WEB_PORT` (default 3000). To test a real request end to end, create a subscription, add your consumer contract, and request randomness: `lastFulfilAt` in `make health` updates and the answer arrives within a few seconds. Both services restart automatically after a crash or reboot.

## 6. HTTPS

```bash
WEB_PORT=$(grep -E '^WEB_PORT=' .env | cut -d= -f2)   # only the port: the proxy never needs the keys
caddy reverse-proxy --from vrf.example.com --to "127.0.0.1:${WEB_PORT:-3000}"
```

Or any load balancer, nginx or Cloudflare Tunnel in front of port `WEB_PORT`. Point uptime monitors at `https://vrf.example.com/api/health`.

When the proxy runs on the same host, set `WEB_BIND=127.0.0.1` in `.env` and run `make up`. Otherwise plain HTTP on `WEB_PORT` stays reachable from the internet, and a host firewall such as ufw does not block it: Docker opens published ports itself.

## What runs

| Service | Copies | Has keys | Public |
|---|---|---|---|
| `web` | 1 or more ([Scaling](#scaling)) | No | `WEB_PORT` (default 3000), one copy per host |
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

### RPC (Alchemy)

Everything goes through Alchemy; nothing uses Arc's public RPCs.

- **Node:** `RPC_URL` and its WebSocket twin (`RPC_WS_URL`, default `wss://` on the same Alchemy URL). Requests arrive by `eth_subscribe` (billed per event, ~0 while idle). A safety scan every `POLL_MS` (eth_blockNumber + eth_getLogs from the last scanned block, at most 2,000 blocks per call, within Pay As You Go's 10,000-block limit) catches anything the socket missed: ~6M CU/month at the default 30 s, against ~90M for the old 2 s polling. Answers go out through `RPC_URL`. A WebSocket drop is logged and resubscribed with backoff; meanwhile requests take up to `POLL_MS` to be noticed.
- **Dashboard:** browsers call the web app's `/api/rpc/<chainId>`, which forwards to `ARC_TESTNET_RPC_URL`. The key never reaches the browser. The proxy only allows read methods, only `eth_call`/`eth_getLogs` against this deployment's contracts, and batches of at most 50. It keeps every log of the deployment's contracts in memory and answers all eth_getLogs calls from that index. Alchemy sees at most one eth_blockNumber and one eth_getLogs every 5 seconds, and only while someone is using the dashboard; after a restart the index rebuilds in a few batched round trips. eth_blockNumber is cached for 1 second, so wallets see receipts promptly. Other reads are shared between visitors and cached for 5 seconds.
- Use two Alchemy apps so the Alchemy dashboard shows the node's and the website's usage separately. If Alchemy rate limits (HTTP 429), the node backs off and retries, and the dashboard shows "Couldn't reach the Arc RPC. Retrying…".

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
| Alert or log: `safety scan failing … Free tier … up to a 10 block range` | The node's Alchemy app is on the Free tier, which allows eth_getLogs over only 10 blocks. The node notices and keeps scanning in 10-block ranges, but that costs ~45M CU/month at `POLL_MS=30000`, more than the Free tier's allowance. Put the app on Pay As You Go (or point `RPC_URL` at a PAYG app), then `make up`. To stay on Free tier for now, raise `POLL_MS` to `120000`. |
| `make health` shows `"node":"stale"` | The node can't reach Alchemy. Check `make logs`, then the key in `RPC_URL`, your plan and its compute-unit usage in the Alchemy dashboard. |
| Requests stay "Waiting for proof" | Check the node log for `fulfil … failed`. Common causes: the subscription balance is too low (fund it; the node retries automatically), the node is out of gas (top up), or Arc's gas price is above `MAX_GAS_PRICE_GWEI`. |
| Dashboard says "Arc VRF isn't deployed on … yet" | The image was built before the deployment file existed. Commit it and run `make update`. |
| Dashboard can't connect mobile wallets | Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` and run `make up`. |

## Running without Docker

```bash
set -a && . ./.env && set +a
pnpm vrf-node          # the node
pnpm --filter web build && PORT=${WEB_PORT:-3000} pnpm --filter web start   # the website
```

Use a process manager (systemd, pm2) to restart them on failure.
