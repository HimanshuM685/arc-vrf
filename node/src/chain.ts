import { ARC_MIN_MAX_FEE_PER_GAS, chains } from '@arc-vrf/sdk'
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

/** RPC_URL may list several endpoints, comma-separated: requests go to the first and fall back to
 * the next when one errors (e.g. Circle's public RPC, then dRPC, then QuickNode). */
export function parseRpcUrls(rpcUrl: string): string[] {
  const urls = rpcUrl.split(',').map((u) => u.trim()).filter(Boolean)
  if (urls.length === 0) throw new Error('RPC_URL is empty')
  return urls
}

export function rpcTransport(rpcUrl: string): Transport {
  const urls = parseRpcUrls(rpcUrl)
  // Arc's load-balanced RPC may briefly return -32014; retry before failing over.
  const one = (u: string) => http(u, { retryCount: urls.length > 1 ? 2 : 5, retryDelay: 250, timeout: 10_000 })
  // ponytail: no health ranking; a dead first URL costs one failed call per request. Add ranking
  // (viem fallback `rank`) only if that latency shows up. `rank` runs a timer per transport
  // that is never stopped, so it leaks in a retry loop.
  return urls.length === 1 ? one(urls[0]!) : fallback(urls.map(one))
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
