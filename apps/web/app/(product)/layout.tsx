import '@rainbow-me/rainbowkit/styles.css'
import { SiteFooter } from '@/components/footer'
import { ProductHeader } from '@/components/product-header'
import { Providers } from '../providers'

// Dashboard shell: wallet providers, product tabs, Connect Wallet.
export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="flex min-h-screen flex-col">
        <ProductHeader />
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 sm:px-8 lg:px-12">
          {children}
        </main>
        <SiteFooter compact />
      </div>
    </Providers>
  )
}
