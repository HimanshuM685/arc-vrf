import { describe, expect, it, vi } from 'vitest'
import { isRateLimited, withRetry } from '../src/chain.ts'

describe('withRetry', () => {
  it('recognises rate-limit errors, including viem revert-shaped ones', () => {
    expect(isRateLimited(new Error('The contract function "createSubscription" reverted with the following reason:\nRequest is being rate limited.'))).toBe(true)
    expect(isRateLimited(new Error('HTTP request failed. Status: 429'))).toBe(true)
    expect(isRateLimited(new Error('execution reverted: InvalidConsumer'))).toBe(false)
    expect(isRateLimited(new Error('gas required exceeds allowance'))).toBe(false)
    // Range limits must split, not wait; amounts like 0.429 must not look like HTTP 429.
    expect(isRateLimited(new Error('eth_getLogs block range limit exceeded'))).toBe(false)
    expect(isRateLimited(new Error('Request exceeds defined limit. Details: query returned more than 10000 results'))).toBe(false)
    expect(isRateLimited(new Error('execution reverted\n  value: 0.429 USDC'))).toBe(false)
    expect(isRateLimited(Object.assign(new Error('call failed'), { cause: { status: 429 } }))).toBe(true)
    expect(isRateLimited(new Error('project ID request rate exceeded'))).toBe(true)
    // Alchemy: HTTP 200 with a JSON-RPC error code 429.
    expect(isRateLimited(Object.assign(new Error('Your app has exceeded its compute units per second capacity'), { code: 429 }))).toBe(true)
  })

  it('retries rate limits, then returns', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Request is being rate limited'))
      .mockRejectedValueOnce(new Error('Request is being rate limited'))
      .mockResolvedValue('ok')
    expect(await withRetry('t', fn, 5, 1)).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry real errors, and gives up after the attempt limit', async () => {
    const real = vi.fn().mockRejectedValue(new Error('execution reverted'))
    await expect(withRetry('t', real, 5, 1)).rejects.toThrow('execution reverted')
    expect(real).toHaveBeenCalledTimes(1)
    const limited = vi.fn().mockRejectedValue(new Error('rate limited'))
    await expect(withRetry('t', limited, 3, 1)).rejects.toThrow('rate limited')
    expect(limited).toHaveBeenCalledTimes(3)
  })
})
