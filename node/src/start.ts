// Starts the Arc VRF node from env vars (see .env.example). Used by the CLI (src/index.ts)
// and by the Next.js app (apps/web/instrumentation.ts) to run the node in-process.
import { getDeployment } from '@arc-vrf/sdk'
import { createPublicClient, parseEther, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createServer } from 'node:http'
import { alert } from './alert.ts'
import { log, rpcTransport } from './chain.ts'
import { runOracle, type NodeStatus } from './oracle.ts'

// On globalThis: Next.js bundles instrumentation and route handlers separately, so a plain
// module-level object wouldn't be shared between the node loop and /api/health.
const g = globalThis as { __arcVrfNodeStatus?: NodeStatus }
export function getNodeStatus(): NodeStatus | undefined {
  return g.__arcVrfNodeStatus
}

const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

async function startOnce(status: NodeStatus, signal?: AbortSignal) {
  const rpcUrl = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
  const chainId = await createPublicClient({ transport: rpcTransport(rpcUrl) }).getChainId()
  const deployment = getDeployment(chainId)
  const coordinator = (process.env.COORDINATOR ?? deployment?.coordinator) as Address | undefined
  if (!coordinator) throw new Error(`no COORDINATOR set and no deployment for chain ${chainId}`)

  await runOracle({
    rpcUrl,
    coordinator,
    provingKey: BigInt(env('VRF_PROVING_KEY')),
    txAccount: privateKeyToAccount(env('NODE_TX_KEY') as Hex),
    startBlock: process.env.START_BLOCK
      ? BigInt(process.env.START_BLOCK)
      : deployment
        ? BigInt(deployment.deployBlock)
        : undefined,
    pollMs: Number(process.env.POLL_MS ?? 500),
    minBalanceWei: parseEther(process.env.MIN_BALANCE_USDC ?? '1'),
    signal,
    status,
  })
}

/** Runs the node until `signal` aborts. Startup failures (RPC down, key not registered yet)
 * are logged and retried every 5 s instead of killing the host process. */
export async function startFromEnv(signal?: AbortSignal) {
  // Config mistakes fail fast; only runtime failures are retried.
  env('VRF_PROVING_KEY')
  env('NODE_TX_KEY')
  const status: NodeStatus = (g.__arcVrfNodeStatus = { pending: 0 })
  if (process.env.HEALTH_PORT) serveHealth(Number(process.env.HEALTH_PORT), status)
  while (!signal?.aborted) {
    try {
      await startOnce(status, signal)
    } catch (e) {
      status.lastError = (e as Error).message.split('\n')[0]
      log(`node stopped: ${status.lastError}; restarting in 5s`)
      void alert('node-restart', `node stopped and is restarting: ${status.lastError}`)
      await new Promise((r) => setTimeout(r, 5_000))
    }
  }
}

const STALE_MS = 30_000

/** GET anything -> node status JSON; 503 when the node hasn't polled recently. No secrets. */
function serveHealth(port: number, s: NodeStatus) {
  createServer((_req, res) => {
    const ok = !!s.lastPollAt && Date.now() - s.lastPollAt < STALE_MS
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        node: ok ? 'ok' : 'stale',
        lastPollAt: s.lastPollAt ? new Date(s.lastPollAt).toISOString() : null,
        head: s.head?.toString() ?? null,
        pending: s.pending,
        lastFulfilAt: s.lastFulfilAt ? new Date(s.lastFulfilAt).toISOString() : null,
        balanceUsdc: s.balanceWei !== undefined ? (Number(s.balanceWei) / 1e18).toString() : null,
        lastError: s.lastError ?? null,
      }),
    )
  }).listen(port, () => log(`health on :${port}`))
}
