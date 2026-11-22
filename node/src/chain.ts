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
 * the next when one errors or rate-limits (e.g. Circle's public RPC, then dRPC, then QuickNode). */
export function rpcTransport(rpcUrl: string): Transport {
  const urls = rpcUrl.split(',').map((u) => u.trim()).filter(Boolean)
  if (urls.length === 0) throw new Error('RPC_URL is empty')
  // Arc's load-balanced RPC may briefly return -32014; retry before failing over.
  const one = (u: string) => http(u, { retryCount: urls.length > 1 ? 2 : 5, retryDelay: 250, timeout: 10_000 })
  // rank: ping each endpoint every 10 s and prefer the healthy, fast ones, so a dead first URL
  // doesn't add latency to every call.
  return urls.length === 1 ? one(urls[0]!) : fallback(urls.map(one), { rank: { interval: 10_000 } })
}

export async function connect(rpcUrl: string, account: Account) {
  const transport = rpcTransport(rpcUrl)
  const id = await createPublicClient({ transport }).getChainId()
  const chain: Chain =
    chains.find((c) => c.id === id) ??
    defineChain({
      id,
      name: `chain-${id}`,
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: { default: { http: rpcUrl.split(',').map((u) => u.trim()) } },
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
