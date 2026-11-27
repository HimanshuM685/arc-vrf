import { ARC_LOG_HISTORY_BLOCKS, chains, getDeployment } from '@arc-vrf/sdk'
import { UpstreamError, createRpcProxy } from '@/lib/rpc-proxy'

// The dashboard's only way to the chain: forwards a small set of read calls to Arc's public RPCs (the
// hard-coded list in the SDK), failing over in order. See lib/rpc-proxy.ts for the allowlists and caching.
export const dynamic = 'force-dynamic'

const MAX_BODY = 64 * 1024

/** Arc testnet and mainnet only: local anvil is reached directly by the browser. */
const upstreamFor = (chainId: number) =>
  chainId === 31337 ? undefined : chains.find((c) => c.id === chainId)?.rpcUrls.default.http

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

  const key = String(chainId)
  let proxy = proxies.get(key)
  if (!proxy) {
    const d = getDeployment(chainId)
    const allowed = d ? [d.coordinator, d.wrapper, d.blockhashStore, d.batchCoordinator] : []
    proxy = createRpcProxy({ upstream, allowed, startBlock: d?.deployBlock ?? 0, historyBlocks: ARC_LOG_HISTORY_BLOCKS })
    proxies.set(key, proxy)
  }

  try {
    return Response.json(await proxy(body))
  } catch (e) {
    // Pass the RPC's status through (429 especially), never its URL.
    if (e instanceof UpstreamError) return Response.json({ error: e.message }, { status: e.status })
    return Response.json({ error: 'Arc RPC unreachable' }, { status: 502 })
  }
}
