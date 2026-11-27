import { RpcRequestError } from 'viem'
import { describe, expect, it } from 'vitest'
import { blockRangeLimit, errMsg } from '../src/chain.ts'
import { SCAN_LAG, isOld, readNearHead } from '../src/oracle.ts'

describe('errMsg', () => {
  it('keeps the provider message on one line and masks the URL', () => {
    const e = new RpcRequestError({
      body: { method: 'eth_getLogs' },
      url: 'https://arc-testnet.g.alchemy.com/v2/SECRETKEY',
      error: { code: -32600, message: 'One of the blocks specified in filter cannot be found.' },
    })
    const m = errMsg(e)
    expect(m).toContain('One of the blocks specified in filter cannot be found.')
    expect(m).not.toContain('SECRETKEY')
    expect(m).not.toContain('\n')
  })
})

describe('readNearHead', () => {
  const head = 1_000n
  // A backend 5 blocks behind: refuses any range ending past its head.
  const lagging = async (from: bigint, to: bigint) => {
    if (to > head - 5n) throw new Error('JSON is not a valid request object.')
    return [from, to]
  }

  it('reads up to head when the RPC allows it', async () => {
    expect(await readNearHead(async (f, t) => [f, t], 900n, 1_000n, head)).toEqual({ logs: [900n, 1_000n], to: 1_000n })
  })

  it('steps back SCAN_LAG blocks when the newest range is refused', async () => {
    expect(await readNearHead(lagging, 900n, 1_000n, head)).toEqual({ logs: [900n, head - SCAN_LAG], to: head - SCAN_LAG })
  })

  it('reads nothing (not an error) when every block in the range is that new', async () => {
    expect(await readNearHead(lagging, 995n, 1_000n, head)).toEqual({ logs: [], to: 994n })
  })

  it('still throws rate limits and failures in older ranges', async () => {
    await expect(readNearHead(async () => { throw new Error('429 Too Many Requests') }, 900n, 1_000n, head)).rejects.toThrow('429')
    await expect(readNearHead(async () => { throw new Error('boom') }, 100n, 500n, head)).rejects.toThrow('boom')
  })
})

describe('blockRangeLimit', () => {
  const rpcErr = (message: string, code = -32600) =>
    new RpcRequestError({ body: { method: 'eth_getLogs' }, url: 'https://arc-testnet.g.alchemy.com/v2/KEY', error: { code, message } })

  it('reads the Alchemy Free-tier limit', () => {
    const e = rpcErr(
      'Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range. Based on your parameters, this block range should work: [0x4671107, 0x4671110]. Upgrade to PAYG for expanded block range.',
    )
    expect(blockRangeLimit(e)).toBe(10n)
  })

  it('falls back to the suggested range', () => {
    expect(blockRangeLimit(rpcErr('block range too wide, this block range should work: [0x10, 0x14]'))).toBe(5n)
  })

  it('ignores other errors', () => {
    expect(blockRangeLimit(rpcErr('One of the blocks specified in filter cannot be found.'))).toBeUndefined()
    expect(blockRangeLimit(rpcErr('Your app has exceeded its compute units per second capacity', 429))).toBeUndefined()
    expect(blockRangeLimit(new Error('fetch failed'))).toBeUndefined()
  })
})

describe('isOld', () => {
  it('routes only chunks older than the main RPCs keep to the full-history RPCs', () => {
    expect(isOld(600_000n, 1_000_000n, 300_000n)).toBe(true)
    expect(isOld(700_000n, 1_000_000n, 300_000n)).toBe(false) // exactly at the edge: main RPCs still have it
    expect(isOld(900_000n, 1_000_000n, 300_000n)).toBe(false)
    expect(isOld(0n, 1_000_000n, undefined)).toBe(false) // no archive configured
  })
})
