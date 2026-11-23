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
