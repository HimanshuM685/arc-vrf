'use client'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/', label: 'Overview' },
  { href: '/subscriptions', label: 'Subscriptions' },
  { href: '/direct-funding', label: 'Direct funding' },
  { href: '/playground', label: 'Playground' },
  { href: '/docs', label: 'Docs' },
]

export function Nav() {
  const path = usePathname()
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <CurveMark />
          Arc VRF
        </Link>
        <nav className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto text-[0.95rem] sm:order-none sm:w-auto">
          {links.map((l) => {
            const active = l.href === '/' ? path === '/' : path.startsWith(l.href)
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap rounded px-2.5 py-1.5 ${active ? 'bg-ink text-paper' : 'text-muted hover:text-ink'}`}
              >
                {l.label}
              </Link>
            )
          })}
        </nav>
        <div className="ml-auto">
          <ConnectButton chainStatus="icon" showBalance={{ smallScreen: false, largeScreen: true }} accountStatus="address" />
        </div>
      </div>
    </header>
  )
}

/** y² = x³ + 7 over the reals, with one marked point: the curve every proof lives on. */
function CurveMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" className="text-lane">
      <path d="M21 3c-6 1-9 5-10 9s4 8 10 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="11.2" cy="12" r="2.6" fill="currentColor" />
    </svg>
  )
}
