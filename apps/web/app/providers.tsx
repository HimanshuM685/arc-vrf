'use client'
import { RainbowKitProvider, darkTheme, lightTheme } from '@rainbow-me/rainbowkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { WagmiProvider } from 'wagmi'
import { wagmiConfig } from '@/lib/wagmi'

/** Monochrome wallet UI: sharp corners, no shadows, indigo (or white) accent. */
type Vars = ReturnType<typeof lightTheme>
const flat = (t: Vars): Vars => ({
  ...t,
  shadows: { connectButton: 'none', dialog: 'none', profileDetailsAction: 'none', selectedOption: 'none', selectedWallet: 'none', walletLogo: 'none' },
})
const theme = {
  lightMode: flat(lightTheme({ accentColor: '#1e1f63', accentColorForeground: '#ffffff', borderRadius: 'none', fontStack: 'system' })),
  darkMode: flat(darkTheme({ accentColor: '#ffffff', accentColorForeground: '#1e1f63', borderRadius: 'none', fontStack: 'system' })),
}

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 3000 } } }))
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider theme={theme}>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
