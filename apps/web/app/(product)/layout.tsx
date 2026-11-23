import '@rainbow-me/rainbowkit/styles.css'
import { SiteFooter } from '@/components/footer'
import { Sidebar } from '@/components/sidebar'
import { TopBar } from '@/components/top-bar'
import { Providers } from '../providers'

// Dashboard shell: wallet providers, fixed sidebar (a drawer below lg), slim top bar with the wallet.
export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="min-h-screen lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <Sidebar />
        <div className="flex min-h-screen min-w-0 flex-col">
          <TopBar />
          <main id="main" className="w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
          <SiteFooter compact />
        </div>
      </div>
    </Providers>
  )
}
