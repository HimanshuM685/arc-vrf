import { defineChain } from 'viem'

// Arc's native gas token is USDC with 18 decimals (the ERC-20 interface uses 6; never mix them).
const usdc = { name: 'USDC', symbol: 'USDC', decimals: 18 } as const

export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: usdc,
  rpcUrls: {
    default: {
      // Public endpoints, tried in order. dRPC is last: its free plan caps getLogs at 100 blocks.
      http: [
        'https://rpc.testnet.arc.io',
        'https://rpc.blockdaemon.testnet.arc.io',
        'https://rpc.quicknode.testnet.arc.io',
        'https://rpc.drpc.testnet.arc.io',
      ],
      webSocket: ['wss://rpc.testnet.arc.io'],
    },
  },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.io' } },
  testnet: true,
})

export const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: usdc,
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'], webSocket: ['wss://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
})

/** Local anvil, priced in "USDC" so the dashboard reads the same as on Arc. */
export const arcLocal = defineChain({
  id: 31337,
  name: 'Anvil (local)',
  nativeCurrency: usdc,
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
  testnet: true,
})

export const chains = [arcTestnet, arcMainnet, arcLocal] as const

/** Arc's mempool silently drops transactions with maxFeePerGas below 20 gwei. */
export const ARC_MIN_MAX_FEE_PER_GAS = 20_000_000_000n
