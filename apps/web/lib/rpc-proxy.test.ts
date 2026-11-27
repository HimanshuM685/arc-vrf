// Run: pnpm --filter web test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_BATCH, UpstreamError, createRpcProxy, type RpcReply } from './rpc-proxy.ts'

const COORD = '0xE852aab2D5C609B89eA2b39E1451608d8649827A'
const OTHER = '0x0000000000000000000000000000000000000001'

/** Fake Alchemy: answers every call with `0x1` (or the given result) and counts upstream calls. */
function fakeUpstream(result: (method: string) => unknown = () => '0x1', status = 200) {
  const seen: string[] = []
  const fetch = (async (_url: string, init: { body: string }) => {
    const calls = JSON.parse(init.body) as { id: number; method: string }[]
    seen.push(...calls.map((c) => c.method))
    return new Response(JSON.stringify(calls.map((c) => ({ jsonrpc: '2.0', id: c.id, result: result(c.method) }))), { status })
  }) as unknown as typeof globalThis.fetch
  return { fetch, seen }
}

test('rejects methods outside the allowlist without calling upstream', async () => {
  const up = fakeUpstream()
  const proxy = createRpcProxy({ upstream: 'u', allowed: [COORD], fetch: up.fetch })
  const r = (await proxy({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: ['0x00'] })) as RpcReply
  assert.equal(r.error?.code, -32601)
  assert.equal(r.id, 1)
  assert.deepEqual(up.seen, [])
})

test('eth_call and eth_getLogs only reach the deployment contracts', async () => {
  const up = fakeUpstream()
  const proxy = createRpcProxy({ upstream: 'u', allowed: [COORD], fetch: up.fetch })
  const [foreign, missing, ours] = (await proxy([
    { id: 1, method: 'eth_call', params: [{ to: OTHER, data: '0x' }, 'latest'] },
    { id: 2, method: 'eth_getLogs', params: [{ fromBlock: '0x1', toBlock: '0x2' }] },
    { id: 3, method: 'eth_call', params: [{ to: COORD.toLowerCase(), data: '0x' }, 'latest'] },
  ])) as RpcReply[]
  assert.equal(foreign!.error?.code, -32602)
  assert.equal(missing!.error?.code, -32602, 'getLogs without an address is not allowed')
  assert.equal(ours!.result, '0x1')
  assert.deepEqual(up.seen, ['eth_call'])
})

test('rejects empty and oversized batches', async () => {
  const proxy = createRpcProxy({ upstream: 'u', allowed: [], fetch: fakeUpstream().fetch })
  assert.equal(((await proxy([])) as RpcReply).error?.code, -32600)
  const big = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ id: i, method: 'eth_blockNumber' }))
  assert.equal(((await proxy(big)) as RpcReply).error?.code, -32600)
})

test('identical concurrent calls go upstream once, then come from the cache', async () => {
  const up = fakeUpstream()
  let t = 0
  const proxy = createRpcProxy({ upstream: 'u', allowed: [], fetch: up.fetch, now: () => t })
  const [a, b] = await Promise.all([proxy({ id: 'a', method: 'eth_blockNumber' }), proxy({ id: 'b', method: 'eth_blockNumber' })])
  assert.equal((a as RpcReply).id, 'a')
  assert.equal((b as RpcReply).id, 'b')
  await proxy({ id: 'c', method: 'eth_blockNumber' })
  assert.deepEqual(up.seen, ['eth_blockNumber'])
  t = 10_000 // past the short TTL
  await proxy({ id: 'd', method: 'eth_blockNumber' })
  assert.deepEqual(up.seen, ['eth_blockNumber', 'eth_blockNumber'])
})

test('getLogs over settled blocks stays cached; near-head ranges expire quickly', async () => {
  const up = fakeUpstream((m) => (m === 'eth_blockNumber' ? '0x1000' : []))
  let t = 0
  const proxy = createRpcProxy({ upstream: 'u', allowed: [COORD], fetch: up.fetch, now: () => t })
  await proxy({ id: 1, method: 'eth_blockNumber' })
  const logs = (toBlock: string) => proxy({ id: 2, method: 'eth_getLogs', params: [{ address: COORD, fromBlock: '0x1', toBlock }] })
  await logs('0x100') // far below head 0x1000: settled
  await logs('0xff0') // within 64 blocks of head
  t = 60_000
  await logs('0x100')
  await logs('0xff0')
  assert.deepEqual(up.seen, ['eth_blockNumber', 'eth_getLogs', 'eth_getLogs', 'eth_getLogs'])
})

test('an upstream HTTP error surfaces as UpstreamError with its status', async () => {
  const proxy = createRpcProxy({ upstream: 'u', allowed: [], fetch: fakeUpstream(undefined, 429).fetch })
  await assert.rejects(proxy({ id: 1, method: 'eth_blockNumber' }), (e) => e instanceof UpstreamError && e.status === 429)
})
