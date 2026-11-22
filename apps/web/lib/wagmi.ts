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

export const wagmiConfig = createConfig({
  chains: appChains as unknown as readonly [typeof arcTestnet],
  connectors,
  transports: {
    [arcTestnet.id]: http(process.env.NEXT_PUBLIC_ARC_TESTNET_RPC),
    [arcMainnet.id]: http(process.env.NEXT_PUBLIC_ARC_MAINNET_RPC),
    [arcLocal.id]: http(process.env.NEXT_PUBLIC_LOCAL_RPC ?? 'http://127.0.0.1:8545'),
  } as Record<typeof arcTestnet.id, Transport>,
  ssr: true,
})
