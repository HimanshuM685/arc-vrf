'use client'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/', label: 'Overview' },
  { href: '/subscriptions', label: 'Subscriptions' },
  { href: '/direct-funding', label: 'Direct funding' },
  { href: '/docs', label: 'Docs' },
]

export function Nav() {
  const path = usePathname()
  return (
    <header className="sticky top-0 z-40 border-b-2 border-ink bg-paper">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 px-4 sm:px-8 lg:flex-nowrap lg:px-12">
        <Link href="/" className="flex min-h-14 items-center gap-2 font-display text-xl font-bold tracking-tight">
          <CurveMark />
          Arc VRF
        </Link>
        <nav aria-label="Main" className="no-scrollbar order-3 -mx-4 flex w-[calc(100%+2rem)] overflow-x-auto border-t border-rule px-4 sm:-mx-8 sm:w-[calc(100%+4rem)] sm:px-8 lg:order-none lg:mx-0 lg:w-auto lg:border-0 lg:px-0">
          {links.map((l) => {
            const active = l.href === '/' ? path === '/' : path.startsWith(l.href)
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`label inline-flex min-h-11 items-center whitespace-nowrap px-3 transition-colors duration-100 ${
                  active ? 'bg-ink text-paper' : 'text-muted underline-offset-4 hover:text-ink hover:underline'
                }`}
              >
                {l.label}
              </Link>
            )
          })}
        </nav>
        <div className="ml-auto py-2">
          <ConnectButton chainStatus="icon" showBalance={{ smallScreen: false, largeScreen: true }} accountStatus="address" />
        </div>
      </div>
    </header>
  )
}

/** y² = x³ + 7 over the reals, with one marked point: the curve every proof lives on. */
function CurveMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 3c-6 1-9 5-10 9s4 8 10 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      <rect x="8.6" y="9.4" width="5.2" height="5.2" fill="currentColor" />
    </svg>
  )
}
