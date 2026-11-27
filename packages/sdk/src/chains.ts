import { defineChain } from 'viem'

// Arc's native gas token is USDC with 18 decimals (the ERC-20 interface uses 6; never mix them).
const usdc = { name: 'USDC', symbol: 'USDC', decimals: 18 } as const

export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: usdc,
  rpcUrls: {
    default: {
      // The public RPCs the node and the dashboard use, tried in this order (from Chainlist, tested).
      // publicnode and Blockdaemon serve 10,000-block eth_getLogs and batches, so they go first; Circle
      // and QuickNode allow 2,000 blocks and rate limit batches; dRPC's free tier only 100 blocks.
      http: [
        'https://arc-testnet-rpc.publicnode.com',
        'https://rpc.blockdaemon.testnet.arc.io',
        'https://rpc.testnet.arc.io',
        'https://rpc.quicknode.testnet.arc.io',
        'https://arc-testnet.drpc.org',
      ],
      webSocket: [
        'wss://arc-testnet-rpc.publicnode.com',
        'wss://rpc.testnet.arc.io',
        'wss://rpc.blockdaemon.testnet.arc.io:443/websocket',
        'wss://rpc.quicknode.testnet.arc.io',
      ],
    },
  },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.io' } },
  testnet: true,
})

export const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: usdc,
  rpcUrls: {
    default: {
      // From Chainlist; untested (no mainnet deployment yet).
      http: [
        'https://rpc.mainnet.arc.io',
        'https://rpc.blockdaemon.mainnet.arc.io',
        'https://rpc.quicknode.mainnet.arc.io',
        'https://rpc.beamrpc.com',
        'https://arc-rpc.blockreq.com/v1/rpc/public',
        'https://arc.drpc.org',
      ],
      webSocket: ['wss://rpc.mainnet.arc.io'],
    },
  },
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

/** How far back the node and dashboard read logs on Arc. publicnode and Blockdaemon prune logs older than
 * ~430,000 blocks (~2.5 days) and answer "pruned history unavailable"; this stays inside that window.
 * ponytail: older history needs an archive RPC or an indexer. */
export const ARC_LOG_HISTORY_BLOCKS = 300_000n

/** Arc's mempool silently drops transactions with maxFeePerGas below 20 gwei. */
export const ARC_MIN_MAX_FEE_PER_GAS = 20_000_000_000n
