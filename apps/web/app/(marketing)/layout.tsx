import { SiteFooter } from '@/components/footer'
import { SiteHeader } from '@/components/site-header'

// Marketing shell: no wallet providers, so the landing page ships no web3 JavaScript.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl px-4 sm:px-8 lg:px-12">
        {children}
      </main>
      <SiteFooter />
    </>
  )
}
