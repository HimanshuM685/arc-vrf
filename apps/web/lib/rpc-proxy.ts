// Server-side JSON-RPC proxy for the dashboard: the browser talks to /api/rpc/<chainId>, this forwards to
// Arc's public RPCs (hard-coded list in the SDK), failing over in order. Pure module (no Next imports) so
// it can be unit tested.
//
// Guard rails, so the proxy isn't a free relay for anyone who finds it:
//  - read methods only (writes go through the user's own wallet),
//  - eth_call / eth_estimateGas / eth_getLogs only against this deployment's contracts,
//  - batches of at most MAX_BATCH calls.
//
// Load control (public RPCs rate limit bursts):
//  - Failover: each call goes to the first RPC that isn't resting, then the rest in order (resting ones
//    last, never skipped). Only health failures (network error, timeout, HTTP 5xx/429, rate limiting) rest
//    an RPC for UPSTREAM_REST_MS; an answer that is wrong for this request (HTTP 4xx, a per-call error, a
//    backend too far behind) fails over without resting it.
//  - Log index: every log of the deployment's contracts is held in memory and eth_getLogs is answered
//    from it, whatever the filter. The RPCs see at most one eth_blockNumber + one eth_getLogs per
//    SYNC_MS, and only while someone is using the dashboard. It covers everything since the deploy block:
//    recent blocks go out as JSON-RPC batches of 10,000-block reads; blocks older than `historyBlocks`
//    (pruned on the first RPCs) one 10,000-block read per request, which the full-history RPCs serve.
//  - Everything else: identical calls in flight share one upstream request, results cached briefly
//    (eth_blockNumber for BLOCK_TTL_MS, so wallets see new blocks and receipts promptly).
// ponytail: index and cache are per process; move them to Redis or an indexer if the web service runs as
// several copies or mainnet log volume outgrows memory.

import { isRateLimited } from '@arc-vrf/sdk'

export type RpcCall = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown }
export type RpcReply = { jsonrpc: '2.0'; id: unknown; result?: unknown; error?: { code: number; message: string } }
type RawLog = { address: string; topics: string[]; blockNumber: string; blockHash?: string }
type LogFilter = { address?: unknown; topics?: unknown[]; fromBlock?: unknown; toBlock?: unknown; blockHash?: unknown }

export const MAX_BATCH = 50
const SHORT_TTL_MS = 5_000
const BLOCK_TTL_MS = 1_000
const SYNC_MS = 5_000
/** Logs this far behind head are final in the index; newer ones are re-read every sync, in case the
 * backend node that answered was a block or two behind. */
const SETTLED_BLOCKS = 64n
/** Blocks per eth_getLogs: every listed RPC but dRPC serves 10,000. */
const CHUNK = 10_000n
/** How long an RPC that failed or rate limited is tried last. */
const UPSTREAM_REST_MS = 30_000
/** Per RPC request: a hung RPC must fail over, not block the shared index sync. */
const UPSTREAM_TIMEOUT_MS = 10_000
/** After the upstream refused our log range (Free tier: 10 blocks), wait this long before trying again. */
const RANGE_REFUSED_MS = 60_000

/** The block range the provider says it allows, when it refused a wider eth_getLogs (e.g. Alchemy Free tier:
 * "up to a 10 block range"). Undefined for any other error. */
export function blockRangeLimit(message: string): bigint | undefined {
  if (!/block range/i.test(message)) return undefined
  const upTo = message.match(/up to (?:a )?(\d+)[ -]block range/i)
  if (upTo) return BigInt(upTo[1]!)
  const ok = message.match(/\[(0x[0-9a-f]+),\s*(0x[0-9a-f]+)\]/i)
  return ok ? BigInt(ok[2]!) - BigInt(ok[1]!) + 1n : undefined
}

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

/** Thrown when the RPC itself answers with a non-2xx status (e.g. 429). The route passes the status
 * through, so the browser's viem client sees a real HTTP 429 and its rate-limit handling kicks in. */
export class UpstreamError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** A JSON-RPC error object as an Error, so the SDK's isRateLimited can read its code and message. */
const rpcError = (e: { code: number; message: string }) => Object.assign(new Error(e.message), { code: e.code })

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
  /** RPC URL, or several tried in order. */
  upstream: string | readonly string[]
  /** Contract addresses eth_call / eth_getLogs may target (any case). Their logs are indexed. */
  allowed: string[]
  /** Deployment block: where the log index starts. */
  startBlock: number
  /** The first RPCs keep logs this far back from head; older chunks are read one per request (the
   * full-history RPCs further down the list rate limit batches). */
  historyBlocks?: bigint
  fetch?: typeof fetch
  now?: () => number
  maxEntries?: number
  timeoutMs?: number
}) {
  const doFetch = o.fetch ?? fetch
  const now = o.now ?? Date.now
  const maxEntries = o.maxEntries ?? 5_000
  const allowed = new Set(o.allowed.map((a) => a.toLowerCase()))
  const cache = new Map<string, Entry>()
  const inflight = new Map<string, Promise<RpcReply>>()

  const upstreams: readonly string[] = typeof o.upstream === "string" ? [o.upstream] : o.upstream
  const restUntil = new Map<string, number>()
  /** Failed over without resting the RPC: the answer was wrong for this request, not a sign of ill health. */
  class WrongAnswer extends UpstreamError {}

  /** One batch to each RPC in turn (resting ones last) until one answers. Fails over on a network or HTTP
   * error, a bad body, or a rate-limited answer. `strict` (index reads): any per-call error fails over too,
   * e.g. a range that RPC won't serve; otherwise per-call errors (an eth_call revert) are real answers.
   * `accept` can refuse a whole answer (a backend too far behind). Throws a range refusal only when every RPC
   * refused the range; any other failure wins, so a blip on the good RPCs isn't mistaken for one. */
  async function sendUpstream(
    calls: { method: string; params: unknown[] }[],
    strict = false,
    accept?: (replies: RpcReply[]) => boolean,
  ): Promise<RpcReply[]> {
    const t = now()
    const order = [...upstreams].sort((a, b) => Number((restUntil.get(a) ?? 0) > t) - Number((restUntil.get(b) ?? 0) > t))
    const errors: unknown[] = []
    for (const u of order) {
      try {
        const replies = await sendTo(u, calls)
        const bad = replies.find((r) => r.error && (strict || isRateLimited(rpcError(r.error))))
        if (bad) {
          if (isRateLimited(rpcError(bad.error!))) throw new UpstreamError(429, bad.error!.message)
          throw new WrongAnswer(502, bad.error!.message)
        }
        if (accept && !accept(replies)) throw new WrongAnswer(503, 'Arc RPC is behind the chain')
        restUntil.delete(u)
        return replies
      } catch (e) {
        errors.push(e)
        if (upstreams.length > 1 && !(e instanceof WrongAnswer)) restUntil.set(u, now() + UPSTREAM_REST_MS)
      }
    }
    const isRange = (e: unknown) => e instanceof UpstreamError && blockRangeLimit(e.message) !== undefined
    throw errors.find((e) => !isRange(e)) ?? errors[errors.length - 1]
  }

  async function sendTo(url: string, calls: { method: string; params: unknown[] }[]): Promise<RpcReply[]> {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c.method, params: c.params }))),
      signal: AbortSignal.timeout(o.timeoutMs ?? UPSTREAM_TIMEOUT_MS),
    })
    if (!res.ok) {
      const msg = `Arc RPC answered HTTP ${res.status}`
      // 4xx (but 429) is about what was sent, not the RPC's health.
      throw res.status >= 500 || res.status === 429 ? new UpstreamError(res.status, msg) : new WrongAnswer(res.status, msg)
    }
    const body = (await res.json()) as RpcReply[] | RpcReply
    // A single error object for a batch: this RPC won't take this batch (size, shape), not ill health.
    if (!Array.isArray(body)) throw new WrongAnswer(502, body?.error?.message ?? 'Arc RPC returned an invalid batch response')
    const byId = new Map(body.map((r) => [r.id, r]))
    return calls.map((_, i) => byId.get(i) ?? fail(i, -32603, 'Missing response from Arc RPC'))
  }

  /** One upstream call; a JSON-RPC error becomes an UpstreamError. */
  async function call1(method: string, params: unknown[]): Promise<unknown> {
    const [r] = await sendUpstream([{ method, params }], true)
    return r!.result
  }

  // ---- Log index ----
  const addresses = [...allowed]
  let settledTo = BigInt(o.startBlock) - 1n
  const settledLogs: RawLog[] = []
  let recent: RawLog[] = []
  let head: bigint | undefined
  let lastSync = -Infinity
  let nextGapMs = 0 // extra wait after the upstream refused our log range
  let lastError: unknown
  let syncing: Promise<void> | undefined

  const logsFilter = (from: bigint, to: bigint) => ({ method: 'eth_getLogs', params: [{ address: addresses, fromBlock: hex(from), toBlock: hex(to) }] })
  /** Logs for each [from, to] range, in one batch with an eth_blockNumber from the same RPC. Failover can
   * land on an RPC other than the one that gave `h`; if that one is behind, it may answer [] for blocks it
   * hasn't seen, and those would be settled for good. So its own head must cover every range it answers
   * (up to `settled`: newer logs are re-read every sync anyway). */
  async function readLogs(ranges: [bigint, bigint][], settled: bigint): Promise<RawLog[][]> {
    const need = ranges.reduce((m, [, to]) => (to > m ? to : m), 0n)
    const replies = await sendUpstream([...ranges.map(([f, t]) => logsFilter(f, t)), { method: 'eth_blockNumber', params: [] }], true, (r) => {
      const theirs = BigInt(r[r.length - 1]!.result as string)
      return theirs >= (need < settled ? need : settled)
    })
    return replies.slice(0, -1).map((r) => r.result as RawLog[])
  }

  /** Brings the index up to head, at most once per `minGapMs`. Concurrent callers share one sync. A
   * failed sync keeps serving the last good index (and waits before trying again, so a rate-limited
   * RPC isn't hammered); only a first sync that fails surfaces the error. */
  function sync(minGapMs = SYNC_MS): Promise<void> {
    if (syncing) return syncing
    if (now() - lastSync < Math.max(minGapMs, nextGapMs)) return head !== undefined ? Promise.resolve() : Promise.reject(lastError)
    syncing = (async () => {
      try {
        const h = BigInt((await call1('eth_blockNumber', [])) as string)
        // A load-balanced backend that is behind: keep the index we have rather than move head back.
        if (head !== undefined && h < head) return
        const settled = h - SETTLED_BLOCKS
        // Pruned on the first RPCs: read one chunk per request (the full-history RPCs rate limit batches).
        const pruned = o.historyBlocks !== undefined ? h - o.historyBlocks : -1n
        // Backfill (first sync, or after a long quiet spell): full chunks, up to MAX_BATCH - 1 per round trip
        // (one slot is the head check). A batch is applied only if every read in it succeeded, so settledTo
        // never skips a failed range.
        while (settled - settledTo >= CHUNK) {
          const n = (settled - settledTo) / CHUNK
          const max = settledTo + CHUNK <= pruned ? 1n : BigInt(MAX_BATCH - 1)
          const ranges = Array.from({ length: Number(n < max ? n : max) }, (_, i): [bigint, bigint] => [
            settledTo + 1n + BigInt(i) * CHUNK,
            settledTo + BigInt(i + 1) * CHUNK,
          ])
          for (const logs of await readLogs(ranges, settled)) settledLogs.push(...logs)
          settledTo += BigInt(ranges.length) * CHUNK
        }
        if (h - settledTo > CHUNK) {
          settledLogs.push(...(await readLogs([[settledTo + 1n, settled]], settled))[0]!)
          settledTo = settled
        }
        const tail = settledTo < h ? (await readLogs([[settledTo + 1n, h]], settled))[0]! : []
        if (settled > settledTo) {
          settledLogs.push(...tail.filter((l) => BigInt(l.blockNumber) <= settled))
          settledTo = settled
        }
        recent = tail.filter((l) => BigInt(l.blockNumber) > settledTo)
        head = h
        nextGapMs = 0
      } catch (e) {
        // The index needs wide log reads (10,000 blocks each). Indexing from the deploy block a few blocks at
        // a time is thousands of calls and trips rate limits, so back off and say so instead.
        const lim = e instanceof UpstreamError ? blockRangeLimit(e.message) : undefined
        if (lim !== undefined) {
          e = new UpstreamError(503, `Every dashboard RPC refused 10,000-block eth_getLogs (one allows ${lim}); retrying in a minute`)
          nextGapMs = RANGE_REFUSED_MS
        }
        lastError = e
        if (head === undefined) throw e
      } finally {
        lastSync = now()
        syncing = undefined
      }
    })()
    return syncing
  }

  async function fromIndex(params: unknown[]): Promise<unknown> {
    const f = (params[0] ?? {}) as LogFilter
    const want = typeof f.toBlock === 'string' && f.toBlock.startsWith('0x') ? BigInt(f.toBlock) : undefined
    // The browser's block number is fresher than the index: catch up (at most once a second) first.
    await sync(want !== undefined && head !== undefined && want > head ? BLOCK_TTL_MS : SYNC_MS)
    // Still well short of what was asked (sync failing): an error, never a silently incomplete answer,
    // which the browser would cache as final.
    if (want !== undefined && want > head! + SETTLED_BLOCKS / 2n) throw new UpstreamError(503, 'Log index is behind the chain, retry shortly')
    // A failed sync can leave recent logs that a backfill already moved into settledLogs.
    const fresh = recent.filter((l) => BigInt(l.blockNumber) > settledTo)
    return filterLogs([...settledLogs, ...fresh], f, head!)
  }

  // ---- Everything else: shared, briefly cached upstream calls ----
  const store = (key: string, method: string, reply: RpcReply) => {
    // null = not mined / not found yet: don't make a wallet wait SHORT_TTL_MS to see its receipt.
    if (reply.error || reply.result === null) return
    cache.delete(key) // re-insert at the end: Map order is the eviction order
    cache.set(key, { result: reply.result, expires: now() + (method === 'eth_blockNumber' ? BLOCK_TTL_MS : SHORT_TTL_MS) })
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
      // No deployment on this chain: no index (an empty address list would fetch every log on the chain),
      // and eth_getLogs was already rejected above.
      if (addresses.length > 0 && method === 'eth_getLogs') {
        out.push(fromIndex(params).then((result) => ({ jsonrpc: '2.0', id: call.id ?? null, result })))
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
          store(m.key, m.method, replies[i]!)
          m.resolve(replies[i]!)
        })
      } catch (e) {
        for (const m of misses) m.reject(e)
      }
    }
    return Promise.all(out)
  }

  /** Handles a parsed JSON-RPC body: one call or a batch. Throws UpstreamError when every RPC fails. */
  return async function handle(body: unknown): Promise<RpcReply | RpcReply[]> {
    if (Array.isArray(body)) {
      if (body.length === 0 || body.length > MAX_BATCH) return fail(null, -32600, `Batches must hold 1 to ${MAX_BATCH} calls`)
      return handleMany(body as RpcCall[])
    }
    return (await handleMany([body as RpcCall]))[0]!
  }
}
