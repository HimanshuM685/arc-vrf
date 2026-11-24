import { Playfair_Display, Source_Serif_4 } from 'next/font/google'
import { SiteFooter } from '@/components/footer'
import { SiteHeader } from '@/components/site-header'

// The editorial faces live here, not in the root layout: only marketing routes preload them, and the
// dashboard (system font) never downloads them. `.marketing` in globals.css points the theme fonts at them.
const display = Playfair_Display({ subsets: ['latin'], style: ['normal', 'italic'], display: 'swap', variable: '--font-playfair' })
const serif = Source_Serif_4({ subsets: ['latin'], display: 'swap', variable: '--font-source-serif' })

// Marketing shell: no wallet providers, so the landing page ships no web3 JavaScript.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`marketing ${display.variable} ${serif.variable} font-sans`}>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl px-4 sm:px-8 lg:px-12">
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}
