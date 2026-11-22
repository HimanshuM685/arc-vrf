import type { Metadata } from 'next'
import { IBM_Plex_Mono, Schibsted_Grotesk } from 'next/font/google'
import { Nav } from '@/components/nav'
import { Providers } from './providers'
import './globals.css'

const sans = Schibsted_Grotesk({ subsets: ['latin'], variable: '--font-schibsted' })
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono' })

export const metadata: Metadata = {
  title: 'Arc VRF',
  description: 'Verifiable random numbers for smart contracts on Arc, paid in USDC.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          <Nav />
          <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">{children}</main>
          <footer className="mx-auto max-w-6xl border-t border-rule px-4 py-8 text-sm text-muted sm:px-6">
            Arc VRF is a fork of Chainlink VRF v2.5 contracts (MIT), adapted for Arc. Not affiliated with Chainlink.
          </footer>
        </Providers>
      </body>
    </html>
  )
}
