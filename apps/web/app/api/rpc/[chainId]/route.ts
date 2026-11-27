import { getDeployment } from '@arc-vrf/sdk'
import { UpstreamError, createRpcProxy } from '@/lib/rpc-proxy'

// The dashboard's only way to the chain: forwards a small set of read calls to Alchemy with the key kept
// server-side (see lib/rpc-proxy.ts for the allowlists and caching). No public RPC fallback.
export const dynamic = 'force-dynamic'

const MAX_BODY = 64 * 1024

/** Server-only env, read per request so `docker compose up` picks up a changed .env without a rebuild. */
const upstreamFor = (chainId: number) =>
  ({ 5042002: process.env.ARC_TESTNET_RPC_URL, 5042: process.env.ARC_MAINNET_RPC_URL })[chainId] || undefined

const proxies = new Map<string, ReturnType<typeof createRpcProxy>>()

export async function POST(req: Request, { params }: { params: Promise<{ chainId: string }> }) {
  const chainId = Number((await params).chainId)
  const upstream = upstreamFor(chainId)
  if (!upstream) return Response.json({ error: `RPC not configured for chain ${chainId}` }, { status: 503 })

  const text = await req.text()
  if (text.length > MAX_BODY) return Response.json({ error: 'Request too large' }, { status: 413 })
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 })
  }

  const key = `${chainId}:${upstream}`
  let proxy = proxies.get(key)
  if (!proxy) {
    const d = getDeployment(chainId)
    const allowed = d ? [d.coordinator, d.wrapper, d.blockhashStore, d.batchCoordinator] : []
    proxy = createRpcProxy({ upstream, allowed, startBlock: d?.deployBlock ?? 0 })
    proxies.set(key, proxy)
  }

  try {
    return Response.json(await proxy(body))
  } catch (e) {
    // Pass Alchemy's status through (429 especially), never its URL: that holds the API key.
    if (e instanceof UpstreamError) return Response.json({ error: e.message }, { status: e.status })
    return Response.json({ error: 'Arc RPC unreachable' }, { status: 502 })
  }
}
