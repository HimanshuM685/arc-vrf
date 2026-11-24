import Link from 'next/link'
import { REPO } from '@/lib/format'
import { MenuLink } from './menu-link'
import { CurveMark, buttonClass } from './primitives'

const links = [
  { href: '/#how', label: 'How it works' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/docs', label: 'Docs' },
]

const linkClass = 'label inline-flex min-h-11 items-center whitespace-nowrap underline-offset-4 hover:underline'

/** Marketing header: no wallet, no product tabs. One call to action into the dashboard. Server component, no JS. */
export function SiteHeader() {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex min-h-20 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-8 lg:px-12">
        <Link href="/" className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
          <CurveMark />
          Arc VRF
        </Link>
        <nav aria-label="Site" className="ml-auto hidden items-center gap-6 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={linkClass}>
              {l.label}
            </Link>
          ))}
          <a href={REPO} target="_blank" rel="noreferrer" className={linkClass}>
            GitHub ↗
          </a>
        </nav>
        <Link href="/dashboard" className={`${buttonClass('primary')} ml-auto md:ml-0`}>
          <span className="hidden sm:inline">Start building</span>
          <span className="sm:hidden">Open app</span>
          <span aria-hidden="true">→</span>
        </Link>
        {/* Phones: the same links in a native disclosure; MenuLink only closes it after a tap. */}
        <details className="group relative md:hidden">
          <summary className="label flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center border-2 border-ink [&::-webkit-details-marker]:hidden" aria-label="Menu">
            <span aria-hidden="true" className="group-open:hidden">☰</span>
            <span aria-hidden="true" className="hidden group-open:inline">✕</span>
          </summary>
          <nav aria-label="Site" className="absolute right-0 z-40 mt-2 flex w-56 flex-col border-2 border-ink bg-paper p-2">
            {links.map((l) => (
              <MenuLink key={l.href} href={l.href} className={`${linkClass} px-3`}>
                {l.label}
              </MenuLink>
            ))}
            <a href={REPO} target="_blank" rel="noreferrer" className={`${linkClass} px-3`}>
              GitHub ↗
            </a>
          </nav>
        </details>
      </div>
    </header>
  )
}
