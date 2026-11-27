// Server-side JSON-RPC proxy for the dashboard: the browser talks to /api/rpc/<chainId>, this forwards to
// Alchemy with the key held server-side. Pure module (no Next imports) so it can be unit tested.
//
// Guard rails, so the proxy isn't a free Alchemy relay for anyone who finds it:
//  - read methods only (writes go through the user's own wallet),
//  - eth_call / eth_estimateGas / eth_getLogs only against this deployment's contracts,
//  - batches of at most MAX_BATCH calls.
// Cost control: identical calls in flight share one upstream request, results are cached briefly, and
// eth_getLogs over settled blocks (Arc has instant finality) is cached for an hour, so every visitor's
// history scan reuses the same chunks.
// ponytail: cache is per process; move it to Redis if the web service runs as several copies.

export type RpcCall = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown }
export type RpcReply = { jsonrpc: '2.0'; id: unknown; result?: unknown; error?: { code: number; message: string } }

export const MAX_BATCH = 50
const SHORT_TTL_MS = 2_000
const SETTLED_TTL_MS = 60 * 60_000
const SETTLED_BLOCKS = 64n

const METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_getLogs',
  'eth_getBalance',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getBlockByNumber',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
])

/** Thrown when Alchemy itself answers with a non-2xx status (e.g. 429). The route passes the status
 * through, so the browser's viem client sees a real HTTP 429 and its rate-limit handling kicks in. */
export class UpstreamError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const fail = (id: unknown, code: number, message: string): RpcReply => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

/** Contract addresses a call targets, or undefined when the method isn't address-restricted. */
function targets(method: string, params: unknown[]): unknown[] | undefined {
  const p0 = params[0] as { to?: unknown; address?: unknown } | undefined
  if (method === 'eth_call' || method === 'eth_estimateGas') return [p0?.to]
  if (method === 'eth_getLogs') return Array.isArray(p0?.address) ? p0.address : [p0?.address]
  return undefined
}

/** Returns an error reply if the call isn't allowed, else undefined. */
export function rejectReason(call: RpcCall, allowed: Set<string>): RpcReply | undefined {
  if (typeof call !== 'object' || call === null || typeof call.method !== 'string') return fail(call?.id, -32600, 'Invalid request')
  if (!METHODS.has(call.method)) return fail(call.id, -32601, `Method ${call.method} is not available through this proxy`)
  const params = call.params ?? []
  if (!Array.isArray(params)) return fail(call.id, -32602, 'params must be an array')
  const to = targets(call.method, params)
  if (to && (to.length === 0 || !to.every((a) => typeof a === 'string' && allowed.has(a.toLowerCase())))) {
    return fail(call.id, -32602, `${call.method} is only allowed against this deployment's contracts`)
  }
  return undefined
}

type Entry = { result: unknown; expires: number }

export function createRpcProxy(o: {
  upstream: string
  /** Contract addresses eth_call / eth_getLogs may target (any case). */
  allowed: string[]
  fetch?: typeof fetch
  now?: () => number
  maxEntries?: number
}) {
  const doFetch = o.fetch ?? fetch
  const now = o.now ?? Date.now
  const maxEntries = o.maxEntries ?? 5_000
  const allowed = new Set(o.allowed.map((a) => a.toLowerCase()))
  const cache = new Map<string, Entry>()
  const inflight = new Map<string, Promise<RpcReply>>()
  let head: bigint | undefined

  const ttl = (method: string, params: unknown[]) => {
    if (method === 'eth_chainId') return SETTLED_TTL_MS
    if (method === 'eth_getLogs') {
      const to = (params[0] as { toBlock?: unknown } | undefined)?.toBlock
      if (typeof to === 'string' && to.startsWith('0x') && head !== undefined && BigInt(to) <= head - SETTLED_BLOCKS) return SETTLED_TTL_MS
    }
    return SHORT_TTL_MS
  }

  const store = (key: string, method: string, params: unknown[], reply: RpcReply) => {
    if (reply.error) return
    if (method === 'eth_blockNumber' && typeof reply.result === 'string') head = BigInt(reply.result)
    cache.delete(key) // re-insert at the end: Map order is the eviction order
    cache.set(key, { result: reply.result, expires: now() + ttl(method, params) })
    for (const k of cache.keys()) {
      if (cache.size <= maxEntries) break
      cache.delete(k)
    }
  }

  /** One upstream batch for all calls that missed the cache. */
  async function sendUpstream(calls: { method: string; params: unknown[] }[]): Promise<RpcReply[]> {
    const res = await doFetch(o.upstream, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c.method, params: c.params }))),
    })
    if (!res.ok) throw new UpstreamError(res.status, `Arc RPC answered HTTP ${res.status}`)
    const body = (await res.json()) as RpcReply[] | RpcReply
    if (!Array.isArray(body)) throw new UpstreamError(502, body?.error?.message ?? 'Arc RPC returned an invalid batch response')
    const byId = new Map(body.map((r) => [r.id, r]))
    return calls.map((_, i) => byId.get(i) ?? fail(i, -32603, 'Missing response from Arc RPC'))
  }

  async function handleMany(calls: RpcCall[]): Promise<RpcReply[]> {
    const out: (RpcReply | Promise<RpcReply>)[] = []
    const misses: { key: string; method: string; params: unknown[]; resolve: (r: RpcReply) => void; reject: (e: unknown) => void }[] = []
    for (const call of calls) {
      const bad = rejectReason(call, allowed)
      if (bad) {
        out.push(bad)
        continue
      }
      const method = call.method as string
      const params = (call.params ?? []) as unknown[]
      const key = `${method}:${JSON.stringify(params)}`
      const hit = cache.get(key)
      if (hit && hit.expires > now()) {
        out.push({ jsonrpc: '2.0', id: call.id ?? null, result: hit.result })
        continue
      }
      let shared = inflight.get(key)
      if (!shared) {
        shared = new Promise<RpcReply>((resolve, reject) => misses.push({ key, method, params, resolve, reject }))
        inflight.set(key, shared)
        void shared.then(
          () => inflight.delete(key),
          () => inflight.delete(key),
        )
      }
      out.push(shared.then((r) => ({ ...r, id: call.id ?? null })))
    }
    if (misses.length) {
      try {
        const replies = await sendUpstream(misses)
        misses.forEach((m, i) => {
          store(m.key, m.method, m.params, replies[i]!)
          m.resolve(replies[i]!)
        })
      } catch (e) {
        for (const m of misses) m.reject(e)
      }
    }
    return Promise.all(out)
  }

  /** Handles a parsed JSON-RPC body: one call or a batch. Throws UpstreamError when Alchemy fails. */
  return async function handle(body: unknown): Promise<RpcReply | RpcReply[]> {
    if (Array.isArray(body)) {
      if (body.length === 0 || body.length > MAX_BATCH) return fail(null, -32600, `Batches must hold 1 to ${MAX_BATCH} calls`)
      return handleMany(body as RpcCall[])
    }
    return (await handleMany([body as RpcCall]))[0]!
  }
}
