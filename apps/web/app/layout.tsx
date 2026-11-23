import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono, Playfair_Display, Source_Serif_4 } from 'next/font/google'
import './globals.css'

const display = Playfair_Display({ subsets: ['latin'], style: ['normal', 'italic'], display: 'swap', variable: '--font-playfair' })
const serif = Source_Serif_4({ subsets: ['latin'], display: 'swap', variable: '--font-source-serif' })
const mono = JetBrains_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-jetbrains' })

export const metadata: Metadata = {
  title: 'Arc VRF',
  description: 'Verifiable random numbers for smart contracts on Arc, paid in USDC.',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#1e1f63' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${serif.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <a
          href="#main"
          className="label sr-only z-50 bg-ink text-paper focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:px-4 focus:py-3"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
