import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono, Playfair_Display, Source_Serif_4 } from 'next/font/google'
import Link from 'next/link'
import { Nav } from '@/components/nav'
import { REPO } from '@/lib/format'
import { Providers } from './providers'
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

const footerLinks = [
  { href: '/docs', label: 'Docs', external: false },
  { href: REPO, label: 'GitHub', external: true },
  { href: `${REPO}/blob/main/docs/ARCHITECTURE.md`, label: 'Architecture', external: true },
  { href: `${REPO}/blob/main/docs/DEPLOYMENT.md`, label: 'Run a node', external: true },
]

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
        <Providers>
          <Nav />
          <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-8 lg:px-12">
            {children}
          </main>
          <footer className="border-t-4 border-ink">
            <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-8 md:flex-row md:items-start md:justify-between lg:px-12">
              <div className="max-w-md">
                <p className="font-display text-2xl font-bold tracking-tight">Arc VRF</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  A fork of Chainlink VRF v2.5 contracts (MIT), adapted for Arc. Not affiliated with Chainlink.
                </p>
              </div>
              <ul className="flex flex-wrap gap-x-6 gap-y-1">
                {footerLinks.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a href={l.href} target="_blank" rel="noreferrer" className="label inline-flex min-h-11 items-center underline-offset-4 hover:underline">
                        {l.label} ↗
                      </a>
                    ) : (
                      <Link href={l.href} className="label inline-flex min-h-11 items-center underline-offset-4 hover:underline">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  )
}
