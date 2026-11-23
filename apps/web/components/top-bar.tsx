'use client'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { Logo, MobileNav } from './sidebar'

/** Slim app bar across the full width: logo left, network + balance + wallet right. Navigation lives in the sidebar. */
export function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-rule bg-paper px-4 sm:px-6">
      <MobileNav />
      <Logo />
      <div className="ml-auto shrink-0">
        <ConnectButton
          chainStatus={{ smallScreen: 'icon', largeScreen: 'full' }}
          showBalance={{ smallScreen: false, largeScreen: true }}
          accountStatus={{ smallScreen: 'avatar', largeScreen: 'full' }}
        />
      </div>
    </header>
  )
}
