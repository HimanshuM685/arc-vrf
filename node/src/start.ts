// Starts the Arc VRF node from env vars (see .env.example). Used by the CLI (src/index.ts).
import { getDeployment } from '@arc-vrf/sdk'
import { createPublicClient, parseEther, type Address, type Hex } from 'viem'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { createServer } from 'node:http'
import { alert } from './alert.ts'
import { log, rpcTransport } from './chain.ts'
import { runOracle, type NodeStatus } from './oracle.ts'

const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

/** Validates everything that can be wrong in config, before any network call or retry. */
function loadKeys(): { provingKey: bigint; txAccount: PrivateKeyAccount } {
  const rawVrf = env('VRF_PROVING_KEY')
  let provingKey: bigint
  try {
    provingKey = BigInt(rawVrf)
  } catch {
    throw new Error('VRF_PROVING_KEY must be a decimal or 0x-hex integer')
  }
  const rawTx = env('NODE_TX_KEY')
  if (!/^0x[0-9a-fA-F]{64}$/.test(rawTx)) throw new Error('NODE_TX_KEY must be 0x followed by 64 hex characters')
  return { provingKey, txAccount: privateKeyToAccount(rawTx as Hex) }
}

async function startOnce(
  keys: ReturnType<typeof loadKeys>,
  status: NodeStatus,
  signal?: AbortSignal,
) {
  const rpcUrl = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
  const chainId = await createPublicClient({ transport: rpcTransport(rpcUrl) }).getChainId()
  const deployment = getDeployment(chainId)
  // `||` not `??`: docker-compose passes an empty string when the override is unset.
  const coordinator = (process.env.COORDINATOR || deployment?.coordinator) as Address | undefined
  if (!coordinator) throw new Error(`no COORDINATOR set and no deployment for chain ${chainId}`)

  await runOracle({
    rpcUrl,
    wsUrl: process.env.RPC_WS_URL || undefined, // empty (docker-compose default) = derive from RPC_URL
    chainId,
    coordinator,
    provingKey: keys.provingKey,
    txAccount: keys.txAccount,
    startBlock: process.env.START_BLOCK
      ? BigInt(process.env.START_BLOCK)
      : deployment
        ? BigInt(deployment.deployBlock)
        : undefined,
    pollMs: pollMs(),
    minBalanceWei: parseEther(process.env.MIN_BALANCE_USDC ?? '1'),
    signal,
    status,
  })
}

/** Runs the node until `signal` aborts. Config errors throw immediately. Runtime and startup
 * failures (RPC down, key not registered yet) are logged and retried every 5 s. */
export async function startFromEnv(signal?: AbortSignal) {
  const keys = loadKeys()
  const status: NodeStatus = { pending: 0 }
  if (process.env.HEALTH_PORT) serveHealth(Number(process.env.HEALTH_PORT), status)
  while (!signal?.aborted) {
    try {
      await startOnce(keys, status, signal)
    } catch (e) {
      status.lastError = (e as Error).message.split('\n')[0]
      log(`node stopped: ${status.lastError}; restarting in 5s`)
      void alert('node-restart', `node stopped and is restarting: ${status.lastError}`)
      await new Promise((r) => setTimeout(r, 5_000))
    }
  }
}

// Requests arrive over WebSocket; POLL_MS is only the safety scan, so the default is slow.
const pollMs = () => Number(process.env.POLL_MS || 30_000)
// lastPollAt moves on every scan (and WS event), so allow three missed scans before "stale".
const STALE_MS = Math.max(30_000, 3 * pollMs())

/** GET anything -> node status JSON; 503 when the node hasn't polled recently. No secrets.
 * Bound to loopback: the only client is the container's own HEALTHCHECK. A listen failure
 * (port in use) is logged and the node keeps running without the endpoint. */
function serveHealth(port: number, s: NodeStatus) {
  const server = createServer((_req, res) => {
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
  })
  server.on('error', (e) => log(`health endpoint disabled: ${(e as Error).message}`))
  server.listen(port, '127.0.0.1', () => log(`health on 127.0.0.1:${port}`))
}
