'use client'
import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { arcLocal, arcMainnet, arcTestnet, parseRpcUrls } from '@arc-vrf/sdk'
import type { Chain } from 'viem'
import { createConfig, fallback, http, type Transport } from 'wagmi'

// WalletConnect-based wallets need a project id (https://cloud.reown.com). Without one,
// browser-extension wallets still work.
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
const showLocal = process.env.NEXT_PUBLIC_SHOW_LOCAL === '1' || process.env.NODE_ENV === 'development'

// The first chain is what a disconnected visitor sees. Local dev starts on anvil.
export const appChains = showLocal ? ([arcLocal, arcTestnet, arcMainnet] as const) : ([arcTestnet, arcMainnet] as const)

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Wallets',
      wallets: projectId
        ? [injectedWallet, metaMaskWallet, rabbyWallet, coinbaseWallet, walletConnectWallet]
        : [injectedWallet, rabbyWallet, coinbaseWallet],
    },
  ],
  { appName: 'Arc VRF', projectId: projectId ?? 'unset' },
)

const batch = { wait: 50 } as const

// batch: the dashboard's many small reads go out as one HTTP request per tick. fallback: when one
// public RPC rate limits or refuses a query, the next one answers. The env var (comma list
// allowed) replaces the chain's public list, e.g. with a dedicated RPC for production.
function transport(chain: Chain, env: string | undefined): Transport {
  // A value of only commas/spaces counts as unset rather than crashing every page.
  const urls = env?.replace(/[\s,]/g, '') ? parseRpcUrls(env) : [...chain.rpcUrls.default.http]
  // Retries live in one layer only: per-URL retries inside a fallback multiply into dozens of requests.
  return urls.length === 1
    ? http(urls[0], { batch, retryCount: 2, retryDelay: 500 })
    : fallback(urls.map((u) => http(u, { batch, retryCount: 0 })), { retryCount: 1, retryDelay: 500 })
}

export const wagmiConfig = createConfig({
  chains: appChains as unknown as readonly [typeof arcTestnet],
  connectors,
  transports: {
    [arcTestnet.id]: transport(arcTestnet, process.env.NEXT_PUBLIC_ARC_TESTNET_RPC),
    [arcMainnet.id]: transport(arcMainnet, process.env.NEXT_PUBLIC_ARC_MAINNET_RPC),
    [arcLocal.id]: transport(arcLocal, process.env.NEXT_PUBLIC_LOCAL_RPC),
  } as Record<typeof arcTestnet.id, Transport>,
  ssr: true,
})
