// RPCs answer bursts with HTTP 429 (Alchemy: "exceeded its compute units per second capacity") or
// "Request is being rate limited". viem can surface that from gas estimation as a contract revert.
// Range and result-size limits ("block range limit exceeded", -32005 "query returned more than…")
// are deliberately not matched: callers split the range for those instead of waiting.
const RATE_LIMITED = /rate.?limit|rate exceeded|too many requests|compute units per second|status: 429\b/i

export function isRateLimited(e: unknown): boolean {
  // HTTP 429 (status), or a JSON-RPC error with code 429 (Alchemy answers some limits that way).
  for (let x = e as { status?: number; code?: number; cause?: unknown } | undefined, i = 0; x && i < 10; x = x.cause as typeof x, i++) {
    if (x.status === 429 || x.code === 429) return true
  }
  if (!(e instanceof Error)) return RATE_LIMITED.test(String(e))
  const err = e as Error & { details?: string; shortMessage?: string }
  return RATE_LIMITED.test(`${err.message} ${err.shortMessage ?? ''} ${err.details ?? ''}`)
}

/** Retries `fn` with exponential backoff (baseMs, 2×, 4×…) while the RPC is rate limiting; any
 * other error is thrown at once. Wrap only idempotent calls (reads, receipt waits): retrying a
 * send can broadcast it twice. */
export async function retryRateLimited<T>(
  fn: () => Promise<T>,
  attempts = 7,
  baseMs = 1_000,
  onRetry?: (ms: number, attempt: number) => void,
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i >= attempts || !isRateLimited(e)) throw e
      const ms = baseMs * 2 ** (i - 1)
      onRetry?.(ms, i)
      await new Promise((r) => setTimeout(r, ms))
    }
  }
}

/** A comma-separated RPC list (the optional RPC_URL override): requests go to the first and fall back
 * to the next when one errors. */
export function parseRpcUrls(rpcUrl: string): string[] {
  const urls = rpcUrl.split(',').map((u) => u.trim()).filter(Boolean)
  if (urls.length === 0) throw new Error('RPC_URL is empty')
  return urls
}
