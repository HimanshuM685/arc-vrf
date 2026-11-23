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

const rpcOptions = { batch: { wait: 50 }, retryCount: 4, retryDelay: 500 } as const

export const wagmiConfig = createConfig({
  chains: appChains as unknown as readonly [typeof arcTestnet],
  connectors,
  transports: {
    // batch: the dashboard's many small reads go out as one HTTP request per tick, which keeps
    // public RPCs from rate limiting it. Set NEXT_PUBLIC_ARC_*_RPC to a dedicated RPC for production.
    [arcTestnet.id]: http(process.env.NEXT_PUBLIC_ARC_TESTNET_RPC, rpcOptions),
    [arcMainnet.id]: http(process.env.NEXT_PUBLIC_ARC_MAINNET_RPC, rpcOptions),
    [arcLocal.id]: http(process.env.NEXT_PUBLIC_LOCAL_RPC ?? 'http://127.0.0.1:8545', rpcOptions),
  } as Record<typeof arcTestnet.id, Transport>,
  ssr: true,
})
