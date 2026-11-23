import '@rainbow-me/rainbowkit/styles.css'
import type { Viewport } from 'next'
import { SiteFooter } from '@/components/footer'
import { Sidebar } from '@/components/sidebar'
import { TopBar } from '@/components/top-bar'
import { Providers } from '../providers'

// The dashboard is always light (see [data-app] in globals.css).
export const viewport: Viewport = { themeColor: '#ffffff' }

// Dashboard shell: wallet providers, full-width top bar, sidebar (icon rail at lg, full at xl, drawer below lg).
export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div data-app className="min-h-screen bg-app text-ink">
        <TopBar />
        <div className="lg:grid lg:grid-cols-[4.5rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)]">
          <Sidebar />
          <div className="flex min-h-[calc(100dvh-3.5rem)] min-w-0 flex-col">
            <main id="main" className="w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
              {children}
            </main>
            <SiteFooter compact />
          </div>
        </div>
      </div>
    </Providers>
  )
}
