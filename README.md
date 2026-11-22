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

## Requirements

Node 22+, pnpm 10, [Foundry](https://getfoundry.sh) (or [Arc Foundry](https://docs.arc.io/arc/tutorials/install-arc-foundry.md) for Arc deployments).

```bash
pnpm install
```

```bash
pnpm contracts:build && pnpm --filter @arc-vrf/sdk gen
```

## Test

```bash
pnpm contracts:test
```

Foundry tests generate real VRF proofs through the TypeScript prover (`vm.ffi`), so run `pnpm install` first.

```bash
pnpm --filter @arc-vrf/node test
```

Verifies the TS prover against a real Chainlink proof from Base Sepolia (`node/test/fixtures`).

```bash
pnpm e2e
```

Starts anvil, deploys everything, runs the node, plays HiLoGame (subscription) and DiceDirect (direct funding), and checks both subscriptions were charged. `KEEP=1 pnpm e2e` leaves the chain and node running for the dashboard.

## Run the dashboard

```bash
pnpm dev
```

Opens on http://localhost:3000. In development it defaults to the local anvil chain. Copy `apps/web/.env.example` to `apps/web/.env.local` to set a WalletConnect project id or RPC overrides.

## Deploy to Arc testnet

1. Generate two keys: a VRF proving key (never sends transactions) and a node transaction key. Fund the node key and your deployer with testnet USDC from https://faucet.circle.com.
2. Print the public key and key hash: `VRF_PROVING_KEY=0x... pnpm --filter @arc-vrf/node register-key`
3. Deploy (writes `contracts/deployments/5042002.json` and regenerates the SDK):

```bash
RPC_URL=https://rpc.testnet.arc.io DEPLOYER_KEY=0x... VRF_PUBLIC_KEY=<x>,<y> pnpm --filter @arc-vrf/node deploy
```

4. Run the node: `RPC_URL=https://rpc.testnet.arc.io VRF_PROVING_KEY=0x... NODE_TX_KEY=0x... pnpm node`

See `.env.example` for fee settings. Wrapper gas overheads start at Chainlink's Base Sepolia values and must be re-measured on Arc.

## Design notes

- **USDC only.** `extraArgs` may be empty or `ExtraArgsV1({nativePayment: true})`; `nativePayment: false` reverts with `LinkPaymentNotSupported`.
- **0 confirmations.** Arc finalises on inclusion; the field stays for apps that want more.
- **Old block hashes.** `BLOCKHASH` → EIP-2935 history (`0x0000F908…2935`, ~8191 blocks) → `BlockhashStore`.
- **Pull-safe refunds.** If a cancellation refund can't be sent (Arc blocklist), it's held for `withdrawRefund()`.
- **Stateless node.** A request is pending iff `s_requestCommitments(requestId) != 0`, so restarts never double-fulfil.
- **Deploys in TypeScript**, not a forge script: subscription IDs depend on the previous block hash, so a forge simulation's IDs don't match what lands on-chain.

## Not done yet (later milestones)

Batch fulfilment in the node (the contract is deployed), monitoring/alerts, an indexer (the dashboard reads logs directly), measured Arc gas overheads, KMS key storage, audit, second operator, mainnet. See `NOTICE` for licensing.
