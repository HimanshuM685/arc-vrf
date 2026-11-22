import { afterEach, describe, expect, it, vi } from 'vitest'
import { alert, resetAlert } from '../src/alert.ts'

describe('alert', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('is a no-op without ALERT_WEBHOOK_URL', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', '')
    expect(await alert('x', 'm')).toBe(false)
  })

  it('sends once per kind within the cooldown, again after reset', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.example/abc')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await alert('low', 'a', 1_000)).toBe(true)
    expect(await alert('low', 'b', 2_000)).toBe(false) // rate-limited
    expect(await alert('other', 'c', 2_000)).toBe(true) // different kind
    expect(await alert('low', 'd', 1_000 + 31 * 60_000)).toBe(true) // cooldown passed
    resetAlert('low')
    expect(await alert('low', 'e', 1_000 + 31 * 60_000 + 1)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ content: '[Arc VRF node] a', text: '[Arc VRF node] a' })
  })

  it('never throws when the webhook is down, and retries on the next trigger', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.example/abc')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    expect(await alert('down', 'm', 5)).toBe(false)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    expect(await alert('down', 'm', 6)).toBe(true) // not blocked by the failed attempt
  })
})
