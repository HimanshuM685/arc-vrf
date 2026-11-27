// Run: pnpm --filter web test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_BATCH, UpstreamError, createRpcProxy, filterLogs, type RpcReply } from './rpc-proxy.ts'

const COORD = '0xe852aab2d5c609b89ea2b39e1451608d8649827a'
const WRAP = '0xd854d5f611938f60d614a69ec58033d37af54d75'
const OTHER = '0x0000000000000000000000000000000000000001'
const T_REQ = '0x' + 'aa'.repeat(32)
const T_FUL = '0x' + 'bb'.repeat(32)
const SUB1 = '0x' + '01'.padStart(64, '0')
const SUB2 = '0x' + '02'.padStart(64, '0')
const hex = (n: number) => `0x${n.toString(16)}`

/** Fake Alchemy over an in-memory chain: answers blockNumber and getLogs (range + address), counts calls. */
function fakeChain(opts: { head: number; logs?: { address: string; topics: string[]; block: number }[]; status?: number }) {
  const chain = { head: opts.head, logs: opts.logs ?? [] }
  const seen: string[] = []
  const fetch = (async (_url: string, init: { body: string }) => {
    const calls = JSON.parse(init.body) as { id: number; method: string; params: { address: string[]; fromBlock: string; toBlock: string }[] }[]
    seen.push(...calls.map((c) => c.method))
    const answer = (c: (typeof calls)[number]) => {
      if (c.method === 'eth_blockNumber') return hex(chain.head)
      if (c.method === 'eth_getLogs') {
        const f = c.params[0]!
        const from = Number(f.fromBlock)
        const to = Number(f.toBlock)
        if (to - from + 1 > 10_000) throw new Error(`range too wide: ${from}-${to}`)
        return chain.logs
          .filter((l) => l.block >= from && l.block <= to && f.address.includes(l.address))
          .map((l) => ({ address: l.address, topics: l.topics, blockNumber: hex(l.block) }))
      }
      return '0x1'
    }
    return new Response(JSON.stringify(calls.map((c) => ({ jsonrpc: '2.0', id: c.id, result: answer(c) }))), { status: opts.status ?? 200 })
  }) as unknown as typeof globalThis.fetch
  return { chain, fetch, seen }
}

const logsOf = async (p: ReturnType<typeof createRpcProxy>, filter: object) =>
  ((await p({ id: 1, method: 'eth_getLogs', params: [filter] })) as RpcReply).result as { blockNumber: string; topics: string[] }[]

test('rejects methods outside the allowlist without calling upstream', async () => {
  const up = fakeChain({ head: 100 })
  const proxy = createRpcProxy({ upstream: 'u', allowed: [COORD], startBlock: 0, fetch: up.fetch })
  const r = (await proxy({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: ['0x00'] })) as RpcReply
  assert.equal(r.error?.code, -32601)
  assert.equal(r.id, 1)
  assert.deepEqual(up.seen, [])
})

test('eth_call and eth_getLogs only reach the deployment contracts', async () => {
  const up = fakeChain({ head: 100 })
  const proxy = createRpcProxy({ upstream: 'u', allowed: [COORD], startBlock: 0, fetch: up.fetch })
  const [foreign, missing, ours] = (await proxy([
    { id: 1, method: 'eth_call', params: [{ to: OTHER, data: '0x' }, 'latest'] },
    { id: 2, method: 'eth_getLogs', params: [{ fromBlock: '0x1', toBlock: '0x2' }] },
    { id: 3, method: 'eth_call', params: [{ to: COORD.toUpperCase().replace('0X', '0x'), data: '0x' }, 'latest'] },
  ])) as RpcReply[]
  assert.equal(foreign!.error?.code, -32602)
  assert.equal(missing!.error?.code, -32602, 'getLogs without an address is not allowed')
  assert.equal(ours!.result, '0x1')
  assert.deepEqual(up.seen, ['eth_call'])
})

test('rejects empty and oversized batches', async () => {
  const proxy = createRpcProxy({ upstream: 'u', allowed: [], startBlock: 0, fetch: fakeChain({ head: 1 }).fetch })
  assert.equal(((await proxy([])) as RpcReply).error?.code, -32600)
  const big = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ id: i, method: 'eth_chainId' }))
  assert.equal(((await proxy(big)) as RpcReply).error?.code, -32600)
})

test('identical concurrent eth_calls go upstream once, then come from the cache', async () => {
  const up = fakeChain({ head: 1 })
  let t = 0
  const proxy = createRpcProxy({ upstream: 'u', allowed: [COORD], startBlock: 0, fetch: up.fetch, now: () => t })
  const call = (id: string) => proxy({ id, method: 'eth_call', params: [{ to: COORD, data: '0x' }, 'latest'] })
  const [a, b] = await Promise.all([call('a'), call('b')])
  assert.equal((a as RpcReply).id, 'a')
  assert.equal((b as RpcReply).id, 'b')
  await call('c')
  assert.deepEqual(up.seen, ['eth_call'])
  t = 10_000 // past the short TTL
  await call('d')
  assert.deepEqual(up.seen, ['eth_call', 'eth_call'])
})

test('filterLogs: address, block range, topics (null / value / any-of), blockHash', () => {
  const logs = [
    { address: COORD, topics: [T_REQ, SUB1], blockNumber: '0x10', blockHash: '0xaa' },
    { address: COORD, topics: [T_FUL, SUB1], blockNumber: '0x20', blockHash: '0xbb' },
    { address: WRAP, topics: [T_REQ, SUB2], blockNumber: '0x30', blockHash: '0xcc' },
  ]
  const n = (f: object) => filterLogs(logs, f, 0x40n).map((l) => l.blockNumber)
  assert.deepEqual(n({ address: COORD }), [], 'fromBlock defaults to latest')
  assert.deepEqual(n({ address: COORD, fromBlock: '0x0' }), ['0x10', '0x20'])
  assert.deepEqual(n({ address: [COORD, WRAP], fromBlock: '0x0', topics: [T_REQ] }), ['0x10', '0x30'])
  assert.deepEqual(n({ address: [COORD, WRAP], fromBlock: '0x0', topics: [null, SUB1] }), ['0x10', '0x20'])
  assert.deepEqual(n({ address: [COORD, WRAP], fromBlock: '0x0', topics: [[T_REQ, T_FUL], SUB2] }), ['0x30'])
  assert.deepEqual(n({ address: COORD, fromBlock: '0x11', toBlock: 'latest' }), ['0x20'])
  assert.deepEqual(n({ address: COORD.toUpperCase().replace('0X', '0x'), blockHash: '0xBB' }), ['0x20'])
})

test('log index: backfills in 10k chunks, then answers any filter from memory', async () => {
  const up = fakeChain({
    head: 25_100,
    logs: [
      { address: COORD, topics: [T_REQ, SUB1], block: 5 },
      { address: COORD, topics: [T_FUL, SUB1], block: 12_000 },
      { address: WRAP, topics: [T_REQ, SUB2], block: 25_090 }, // within the last 64 blocks: "recent"
      { address: OTHER, topics: [T_REQ, SUB1], block: 50 }, // not ours: never fetched
    ],
  })
  const proxy = createRpcProxy({ upstream: 'u', allowed: [COORD, WRAP], startBlock: 0, fetch: up.fetch, now: () => 0 })
  // 20 different filters at once: one sync for all of them.
  const filters = Array.from({ length: 20 }, (_, i) => ({ address: i % 2 ? COORD : [COORD, WRAP], fromBlock: '0x0', topics: i % 3 ? [T_REQ] : [] }))
  const results = await Promise.all(filters.map((f) => logsOf(proxy, f)))
  assert.deepEqual(results[0]!.map((l) => Number(l.blockNumber)), [5, 12_000, 25_090])
  assert.deepEqual(results[1]!.map((l) => Number(l.blockNumber)), [5])
  // blockNumber + 2 full chunks [0,9999] [10000,19999] + tail [20000, 25100] (fits one chunk)
  assert.deepEqual(up.seen, ['eth_blockNumber', 'eth_getLogs', 'eth_getLogs', 'eth_getLogs'])
  await logsOf(proxy, { address: COORD, fromBlock: '0x0' })
  assert.equal(up.seen.length, 4, 'still within SYNC_MS: no new upstream calls')
})

test('backfill chunks go out as one batch', async () => {
  const up = fakeChain({ head: 35_000 })
  const batches: number[] = []
  const fetch = ((url: string, init: { body: string }) => {
    batches.push((JSON.parse(init.body) as unknown[]).length)
    return up.fetch(url, init as RequestInit)
  }) as unknown as typeof globalThis.fetch
  const proxy = createRpcProxy({ upstream: 'u', allowed: [COORD], startBlock: 0, fetch, now: () => 0 })
  await logsOf(proxy, { address: COORD, fromBlock: '0x0' })
  assert.deepEqual(batches, [1, 3, 1], 'blockNumber, three 10k chunks in one round trip, tail')
})

test('a sync that fails after backfilling never returns a log twice', async () => {
  let failGetLogsAfter = Infinity
  const up = fakeChain({ head: 1_000, logs: [{ address: COORD, topics: [T_REQ], block: 990 }] })
  let n = 0
  const fetch = ((url: string, init: { body: string }) => {
    const calls = JSON.parse(init.body) as { method: string }[]
    if (calls.some((c) => c.method === 'eth_getLogs') && calls.length === 1 && n++ >= failGetLogsAfter)
      return Promise.resolve(new Response('limited', { status: 429 }))
    return up.fetch(url, init as RequestInit)
  }) as unknown as typeof globalThis.fetch
  let t = 0
  const proxy = createRpcProxy({ upstream: 'u', allowed: [COORD], startBlock: 0, fetch, now: () => t })
  assert.equal((await logsOf(proxy, { address: COORD, fromBlock: '0x0' })).length, 1) // 990 is "recent"
  // Long quiet spell: the backfill batch (which re-reads block 990 into settled) succeeds, the tail read fails.
  up.chain.head = 30_000
  failGetLogsAfter = n
  t = 60_000
  const logs = await logsOf(proxy, { address: COORD, fromBlock: '0x0', toBlock: hex(1_000) })
  assert.deepEqual(logs.map((l) => Number(l.blockNumber)), [990])
})

test('a lagging blockNumber never moves the index back; asking past the index is an error, not a gap', async () => {
  let lag = false
  const up = fakeChain({ head: 1_000, logs: [{ address: COORD, topics: [T_REQ], block: 995 }] })
  const fetch = ((url: string, init: { body: string }) => {
    const calls = JSON.parse(init.body) as { method: string }[]
    if (lag && calls[0]!.method === 'eth_blockNumber') {
      return Promise.resolve(Response.json([{ jsonrpc: '2.0', id: 0, result: hex(990) }]))
    }
    return up.fetch(url, init as RequestInit)
  }) as unknown as typeof globalThis.fetch
  let t = 0
  const proxy = createRpcProxy({ upstream: 'u', allowed: [COORD], startBlock: 0, fetch, now: () => t })
  assert.equal((await logsOf(proxy, { address: COORD, fromBlock: '0x0' })).length, 1)
  lag = true
  t = 6_000
  assert.equal((await logsOf(proxy, { address: COORD, fromBlock: '0x0' })).length, 1, 'block 995 still there')
  t = 12_000
  await assert.rejects(
    proxy({ id: 1, method: 'eth_getLogs', params: [{ address: COORD, fromBlock: '0x0', toBlock: hex(2_000) }] }),
    (e) => e instanceof UpstreamError && e.status === 503,
  )
})

test('eth_blockNumber goes upstream and is cached only briefly', async () => {
  const up = fakeChain({ head: 1 })
  let t = 0
  const proxy = createRpcProxy({ upstream: 'u', allowed: [COORD], startBlock: 0, fetch: up.fetch, now: () => t })
  await proxy({ id: 1, method: 'eth_blockNumber' })
  t = 1_500
  await proxy({ id: 2, method: 'eth_blockNumber' })
  assert.deepEqual(up.seen, ['eth_blockNumber', 'eth_blockNumber'])
})

test('log index: later syncs only read the unsettled tail; a lagging answer is re-read', async () => {
  const up = fakeChain({ head: 1_000, logs: [{ address: COORD, topics: [T_REQ], block: 990 }] })
  let t = 0
  const proxy = createRpcProxy({ upstream: 'u', allowed: [COORD], startBlock: 0, fetch: up.fetch, now: () => t })
  assert.equal((await logsOf(proxy, { address: COORD, fromBlock: '0x0' })).length, 1)
  // A log lands in block 995 that the first tail read didn't include (lagging backend): still found later.
  up.chain.logs.push({ address: COORD, topics: [T_REQ], block: 995 })
  up.chain.head = 1_010
  t = 6_000
  up.seen.length = 0
  const after = await logsOf(proxy, { address: COORD, fromBlock: '0x0' })
  assert.deepEqual(after.map((l) => Number(l.blockNumber)), [990, 995])
  assert.deepEqual(up.seen, ['eth_blockNumber', 'eth_getLogs'], 'one tail read per sync once caught up')
})

test('no traffic, no upstream calls; a failed sync keeps serving the last good index', async () => {
  let status = 200
  const base = fakeChain({ head: 100, logs: [{ address: COORD, topics: [T_REQ], block: 50 }] })
  const fetch = ((url: string, init: { body: string }) =>
    status === 200 ? base.fetch(url, init as RequestInit) : Promise.resolve(new Response('limited', { status }))) as unknown as typeof globalThis.fetch
  let t = 0
  const proxy = createRpcProxy({ upstream: 'u', allowed: [COORD], startBlock: 0, fetch, now: () => t })
  assert.deepEqual(base.seen, [], 'creating the proxy calls nothing')
  assert.equal((await logsOf(proxy, { address: COORD, fromBlock: '0x0' })).length, 1)
  status = 429
  t = 60_000
  assert.equal((await logsOf(proxy, { address: COORD, fromBlock: '0x0' })).length, 1, 'stale but served')
})

test('a first sync that fails, and any other upstream HTTP error, surface with their status', async () => {
  const limited = fakeChain({ head: 1, status: 429 })
  const a = createRpcProxy({ upstream: 'u', allowed: [COORD], startBlock: 0, fetch: limited.fetch })
  await assert.rejects(a({ id: 1, method: 'eth_blockNumber' }), (e) => e instanceof UpstreamError && e.status === 429)
  const b = createRpcProxy({ upstream: 'u', allowed: [], startBlock: 0, fetch: limited.fetch })
  await assert.rejects(b({ id: 1, method: 'eth_chainId' }), (e) => e instanceof UpstreamError && e.status === 429)
})
