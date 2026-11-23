'use client'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CurveMark } from './primitives'

const links = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/subscriptions', label: 'Subscriptions' },
  { href: '/direct-funding', label: 'Direct funding' },
  { href: '/docs', label: 'Docs' },
]

/** Dashboard app bar: product tabs and the wallet. Only used inside the (product) layout. */
export function ProductHeader() {
  const path = usePathname()
  return (
    <header className="sticky top-0 z-40 border-b-2 border-ink bg-paper">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 px-4 sm:px-8 lg:flex-nowrap lg:px-12">
        <Link href="/dashboard" className="flex min-h-14 items-center gap-2 font-display text-xl font-bold tracking-tight">
          <CurveMark />
          Arc VRF
          <span className="label ml-1 hidden bg-ink px-1.5 py-1 font-sans text-paper sm:inline">Dashboard</span>
        </Link>
        <nav aria-label="Product" className="no-scrollbar order-3 -mx-4 flex w-[calc(100%+2rem)] items-center overflow-x-auto border-t border-rule px-4 sm:-mx-8 sm:w-[calc(100%+4rem)] sm:px-8 lg:order-none lg:mx-0 lg:w-auto lg:border-0 lg:px-0">
          {links.map((l) => {
            const active = path === l.href || path.startsWith(`${l.href}/`) || (l.href === '/subscriptions' && path.startsWith('/requests/'))
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
          <Link href="/" className="label ml-auto inline-flex min-h-11 items-center whitespace-nowrap pl-3 text-muted underline-offset-4 hover:text-ink hover:underline lg:hidden">
            ← Site
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-4 py-2">
          <Link href="/" className="label hidden min-h-11 items-center whitespace-nowrap text-muted underline-offset-4 hover:text-ink hover:underline lg:inline-flex">
            ← Site
          </Link>
          <ConnectButton chainStatus="icon" showBalance={{ smallScreen: false, largeScreen: true }} accountStatus="address" />
        </div>
      </div>
    </header>
  )
}
