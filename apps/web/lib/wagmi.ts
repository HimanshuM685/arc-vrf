'use client'
import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { arcLocal, arcMainnet, arcTestnet } from '@arc-vrf/sdk'
import { createConfig, http, type Transport } from 'wagmi'

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

// Arc testnet and mainnet go through the web app's own /api/rpc proxy, which forwards to Alchemy with the
// key kept server-side (app/api/rpc/[chainId]/route.ts). No public RPCs. batch: the dashboard's many
// small reads go out as one HTTP request per tick.
const proxied = (chainId: number): Transport => http(`/api/rpc/${chainId}`, { batch, retryCount: 2, retryDelay: 500 })

export const wagmiConfig = createConfig({
  chains: appChains as unknown as readonly [typeof arcTestnet],
  connectors,
  transports: {
    [arcTestnet.id]: proxied(arcTestnet.id),
    [arcMainnet.id]: proxied(arcMainnet.id),
    // Local anvil only: straight from the browser, nothing to hide.
    [arcLocal.id]: http(process.env.NEXT_PUBLIC_LOCAL_RPC || arcLocal.rpcUrls.default.http[0], { batch }),
  } as Record<typeof arcTestnet.id, Transport>,
  ssr: true,
})
