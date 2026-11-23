'use client'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { usePathname } from 'next/navigation'
import { MobileNav, isActive, nav } from './sidebar'

/** Slim app bar: where you are, and the wallet. Navigation lives in the sidebar. */
export function TopBar() {
  const path = usePathname()
  const current = nav.flatMap((s) => s.items).find((i) => isActive(i, path))
  const detail = current && path !== current.href
  return (
    <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-rule bg-paper px-4 sm:px-6 lg:px-8">
      <MobileNav />
      <p className="label min-w-0 truncate text-muted">
        <span className={detail ? 'hidden sm:inline' : 'text-ink'}>{current?.label ?? 'Arc VRF'}</span>
        {detail && <span className="text-ink"><span className="hidden sm:inline"> / </span>{current.label.replace(/s$/, '')}</span>}
      </p>
      <div className="ml-auto shrink-0">
        <ConnectButton chainStatus="icon" showBalance={{ smallScreen: false, largeScreen: true }} accountStatus="address" />
      </div>
    </header>
  )
}
