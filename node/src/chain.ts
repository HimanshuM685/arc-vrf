import { ARC_MIN_MAX_FEE_PER_GAS, chains, isRateLimited, parseRpcUrls, retryRateLimited } from '@arc-vrf/sdk'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  http,
  type Account,
  type Chain,
  type PublicClient,
  type Transport,
  webSocket,
} from 'viem'

export function rpcTransport(rpcUrl: string): Transport {
  const urls = parseRpcUrls(rpcUrl)
  // Arc's load-balanced RPC may briefly return -32014; retry before failing over.
  // With several URLs, one retry per URL and one pass over the list: retries multiply otherwise.
  const one = (u: string) => http(u, { retryCount: urls.length > 1 ? 1 : 5, retryDelay: 250, timeout: 10_000 })
  // ponytail: no health ranking; a dead first URL costs one failed call per request. Add ranking
  // (viem fallback `rank`) only if that latency shows up. `rank` runs a timer per transport
  // that is never stopped, so it leaks in a retry loop.
  return urls.length === 1 ? one(urls[0]!) : fallback(urls.map(one), { retryCount: 1 })
}

/** Pass `chainId` when the caller already probed it, to skip a round-trip. */
export async function connect(rpcUrl: string, account: Account, chainId?: number) {
  const transport = rpcTransport(rpcUrl)
  const id = chainId ?? (await createPublicClient({ transport }).getChainId())
  const chain: Chain =
    chains.find((c) => c.id === id) ??
    defineChain({
      id,
      name: `chain-${id}`,
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: { default: { http: parseRpcUrls(rpcUrl) } },
    })
  const publicClient = createPublicClient({ chain, transport, pollingInterval: 500 }) as PublicClient
  const walletClient = createWalletClient({ chain, transport, account, pollingInterval: 500 })
  return { chain, publicClient, walletClient }
}

/** Default WebSocket URL: the first `RPC_URL` with http(s) -> ws(s). Alchemy and anvil serve both on one URL. */
export const defaultWsUrl = (rpcUrl: string) => parseRpcUrls(rpcUrl)[0]!.replace(/^http/, 'ws')

/** Push-only client for eth_subscribe. viem's own reconnect is off: after a drop it would not
 * resubscribe, so the caller re-watches instead (a fresh socket each time). */
export const wsClient = (url: string) =>
  createPublicClient({ transport: webSocket(url, { reconnect: false, retryCount: 0, timeout: 10_000 }) })

/** EIP-1559 fees with Arc's 20 gwei maxFeePerGas floor (lower is silently dropped by the mempool). */
export async function arcFees(client: PublicClient) {
  const { maxFeePerGas, maxPriorityFeePerGas } = await client.estimateFeesPerGas()
  return {
    maxFeePerGas: maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS ? maxFeePerGas : ARC_MIN_MAX_FEE_PER_GAS,
    maxPriorityFeePerGas,
  }
}

export const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args)

export { isRateLimited, parseRpcUrls }

/** `retryRateLimited` with a log line per retry. Sends must pin their nonce (see deploy.ts), so a
 * retry after a send that went out fails with "nonce too low" instead of sending twice. */
export const withRetry = <T>(label: string, fn: () => Promise<T>, attempts = 7, baseMs = 1_000): Promise<T> =>
  retryRateLimited(fn, attempts, baseMs, (ms, i) => log(`${label}: RPC is rate limiting, retrying in ${ms / 1000}s (${i}/${attempts - 1})`))

/** The eth_getLogs block range the provider says it allows, when it refused a wider one
 * (Alchemy Free tier: "up to a 10 block range ... this block range should work: [0xA, 0xB]"). */
export function blockRangeLimit(e: unknown): bigint | undefined {
  let text = ''
  for (let x = e as { message?: string; shortMessage?: string; details?: string; cause?: unknown } | undefined, i = 0; x && i < 10; x = x.cause as typeof x, i++)
    text += ` ${x.message ?? ''} ${x.shortMessage ?? ''} ${x.details ?? ''}`
  if (!/block range/i.test(text)) return undefined
  const upTo = text.match(/up to (?:a )?(\d+)[ -]block range/i)
  if (upTo) return BigInt(upTo[1]!)
  const ok = text.match(/\[(0x[0-9a-f]+),\s*(0x[0-9a-f]+)\]/i)
  return ok ? BigInt(ok[2]!) - BigInt(ok[1]!) + 1n : undefined
}

/** One-line error text for logs and alerts: viem's summary plus the provider's own message
 * (`details`), which viem keeps off the first line. URLs are masked: they can hold API keys. */
export function errMsg(e: unknown): string {
  const err = e as { shortMessage?: string; details?: string; message?: string }
  const short = err.shortMessage ?? String(err.message ?? e).split('\n')[0]!
  const details = err.details?.split('\n')[0]
  const text = details && !short.includes(details) ? `${short} (${details})` : short
  return text.replace(/\b(?:https?|wss?):\/\/\S+/g, '<url>')
}
