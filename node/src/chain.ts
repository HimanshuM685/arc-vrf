import { ARC_MIN_MAX_FEE_PER_GAS, chains } from '@arc-vrf/sdk'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Account,
  type Chain,
  type PublicClient,
} from 'viem'

export async function connect(rpcUrl: string, account: Account) {
  const probe = createPublicClient({ transport: http(rpcUrl) })
  const id = await probe.getChainId()
  const chain: Chain =
    chains.find((c) => c.id === id) ??
    defineChain({
      id,
      name: `chain-${id}`,
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    })
  const transport = http(rpcUrl, { retryCount: 5, retryDelay: 250 }) // Arc RPC may return -32014 briefly
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
