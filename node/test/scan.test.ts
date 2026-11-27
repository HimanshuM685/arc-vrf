import { RpcRequestError } from 'viem'
import { describe, expect, it } from 'vitest'
import { errMsg } from '../src/chain.ts'
import { SCAN_LAG, readNearHead } from '../src/oracle.ts'

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
