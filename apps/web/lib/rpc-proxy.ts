// Server-side JSON-RPC proxy for the dashboard: the browser talks to /api/rpc/<chainId>, this forwards to
// Alchemy with the key held server-side. Pure module (no Next imports) so it can be unit tested.
//
// Guard rails, so the proxy isn't a free Alchemy relay for anyone who finds it:
//  - read methods only (writes go through the user's own wallet),
//  - eth_call / eth_estimateGas / eth_getLogs only against this deployment's contracts,
//  - batches of at most MAX_BATCH calls.
//
// Cost control (Alchemy bills per call):
//  - Log index: every log of the deployment's contracts is held in memory and eth_getLogs is answered
//    from it, whatever the filter. Alchemy sees at most one eth_blockNumber + one eth_getLogs per
//    SYNC_MS, and only while someone is using the dashboard. eth_blockNumber is answered from the index
//    head too, so browsers never ask for blocks the index hasn't read.
//  - Everything else: identical calls in flight share one upstream request, results cached SHORT_TTL_MS.
// ponytail: index and cache are per process; move them to Redis or an indexer if the web service runs as
// several copies or mainnet log volume outgrows memory.

export type RpcCall = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown }
export type RpcReply = { jsonrpc: '2.0'; id: unknown; result?: unknown; error?: { code: number; message: string } }
type RawLog = { address: string; topics: string[]; blockNumber: string; blockHash?: string }
type LogFilter = { address?: unknown; topics?: unknown[]; fromBlock?: unknown; toBlock?: unknown; blockHash?: unknown }

export const MAX_BATCH = 50
const SHORT_TTL_MS = 5_000
const SYNC_MS = 5_000
/** Logs this far behind head are final in the index; newer ones are re-read every sync, in case the
 * backend node that answered was a block or two behind. */
const SETTLED_BLOCKS = 64n
/** Alchemy Pay As You Go: at most 10,000 blocks per eth_getLogs. */
const CHUNK = 10_000n

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
const hex = (n: bigint) => `0x${n.toString(16)}`
const lower = (s: unknown) => (typeof s === 'string' ? s.toLowerCase() : s)

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

/** eth_getLogs filter semantics over logs held in memory. */
export function filterLogs(logs: RawLog[], f: LogFilter, head: bigint): RawLog[] {
  const block = (v: unknown, dflt: bigint) =>
    v === undefined || v === null ? dflt : v === 'earliest' ? 0n : typeof v === 'string' && v.startsWith('0x') ? BigInt(v) : head // latest / safe / finalized / pending
  const from = block(f.fromBlock, head)
  const to = block(f.toBlock, head)
  const addrs = new Set((Array.isArray(f.address) ? f.address : [f.address]).map(lower))
  const topics = f.topics ?? []
  return logs.filter((l) => {
    if (f.blockHash !== undefined) {
      if (lower(l.blockHash) !== lower(f.blockHash)) return false
    } else {
      const b = BigInt(l.blockNumber)
      if (b < from || b > to) return false
    }
    if (!addrs.has(l.address.toLowerCase())) return false
    return topics.every((t, i) => t === null || t === undefined || (Array.isArray(t) ? t.map(lower) : [lower(t)]).includes(lower(l.topics[i])))
  })
}

type Entry = { result: unknown; expires: number }

export function createRpcProxy(o: {
  upstream: string
  /** Contract addresses eth_call / eth_getLogs may target (any case). Their logs are indexed. */
  allowed: string[]
  /** Deployment block: where the log index starts. */
  startBlock: number
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

  /** One upstream batch for the given calls. */
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

  /** One upstream call; a JSON-RPC error becomes an UpstreamError. */
  async function call1(method: string, params: unknown[]): Promise<unknown> {
    const [r] = await sendUpstream([{ method, params }])
    if (r!.error) throw new UpstreamError(502, r!.error.message)
    return r!.result
  }

  // ---- Log index ----
  const addresses = [...allowed]
  let settledTo = BigInt(o.startBlock) - 1n
  const settledLogs: RawLog[] = []
  let recent: RawLog[] = []
  let head: bigint | undefined
  let lastSync = -Infinity
  let lastError: unknown
  let syncing: Promise<void> | undefined

  const getLogs = (from: bigint, to: bigint) => call1('eth_getLogs', [{ address: addresses, fromBlock: hex(from), toBlock: hex(to) }]) as Promise<RawLog[]>

  /** Brings the index up to head, at most once per SYNC_MS. Concurrent callers share one sync. A failed
   * sync keeps serving the last good index (and waits SYNC_MS before trying again, so a rate-limited
   * Alchemy isn't hammered); only a first sync that fails surfaces the error. */
  function sync(): Promise<void> {
    if (syncing) return syncing
    if (now() - lastSync < SYNC_MS) return head !== undefined ? Promise.resolve() : Promise.reject(lastError)
    syncing = (async () => {
      try {
        const h = BigInt((await call1('eth_blockNumber', [])) as string)
        const settled = h - SETTLED_BLOCKS
        // Backfill (first sync, or after a long quiet spell) in full chunks, then whatever keeps the
        // final tail read within one chunk.
        while (settled - settledTo >= CHUNK) {
          settledLogs.push(...(await getLogs(settledTo + 1n, settledTo + CHUNK)))
          settledTo += CHUNK
        }
        if (h - settledTo > CHUNK) {
          settledLogs.push(...(await getLogs(settledTo + 1n, settled)))
          settledTo = settled
        }
        const tail = settledTo < h ? await getLogs(settledTo + 1n, h) : []
        if (settled > settledTo) {
          settledLogs.push(...tail.filter((l) => BigInt(l.blockNumber) <= settled))
          settledTo = settled
        }
        recent = tail.filter((l) => BigInt(l.blockNumber) > settledTo)
        head = h
      } catch (e) {
        lastError = e
        if (head === undefined) throw e
      } finally {
        lastSync = now()
        syncing = undefined
      }
    })()
    return syncing
  }

  async function fromIndex(method: string, params: unknown[]): Promise<unknown> {
    await sync()
    if (method === 'eth_blockNumber') return hex(head!)
    return filterLogs([...settledLogs, ...recent], (params[0] ?? {}) as LogFilter, head!)
  }

  // ---- Everything else: shared, briefly cached upstream calls ----
  const store = (key: string, reply: RpcReply) => {
    if (reply.error) return
    cache.delete(key) // re-insert at the end: Map order is the eviction order
    cache.set(key, { result: reply.result, expires: now() + SHORT_TTL_MS })
    for (const k of cache.keys()) {
      if (cache.size <= maxEntries) break
      cache.delete(k)
    }
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
      // No deployment on this chain: no index (an empty address list would fetch every log on the chain).
      // eth_getLogs was already rejected above in that case; eth_blockNumber falls through to the cache.
      if (addresses.length > 0 && (method === 'eth_getLogs' || method === 'eth_blockNumber')) {
        out.push(fromIndex(method, params).then((result) => ({ jsonrpc: '2.0', id: call.id ?? null, result })))
        continue
      }
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
          store(m.key, replies[i]!)
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
