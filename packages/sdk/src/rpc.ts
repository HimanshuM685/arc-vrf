// Public RPCs (e.g. rpc.testnet.arc.io) answer bursts with "Request is being rate limited". viem
// surfaces that from gas estimation as a contract revert, which is misleading.
const RATE_LIMITED = /rate.?limit|too many requests|\b429\b|-32005|limit exceeded/i

export function isRateLimited(e: unknown): boolean {
  if (!(e instanceof Error)) return RATE_LIMITED.test(String(e))
  const err = e as Error & { details?: string; shortMessage?: string }
  return RATE_LIMITED.test(`${err.message} ${err.shortMessage ?? ''} ${err.details ?? ''}`)
}

/** RPC_URL may list several endpoints, comma-separated: requests go to the first and fall back to
 * the next when one errors (e.g. Circle's public RPC, then Blockdaemon, then QuickNode). */
export function parseRpcUrls(rpcUrl: string): string[] {
  const urls = rpcUrl.split(',').map((u) => u.trim()).filter(Boolean)
  if (urls.length === 0) throw new Error('RPC_URL is empty')
  return urls
}
