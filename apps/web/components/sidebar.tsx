'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { REPO } from '@/lib/format'
import { CurveMark } from './primitives'

type Item = { href: string; label: string; external?: boolean; /** Hash links never show as the current page. */ noActive?: boolean }

/** Single source for the dashboard navigation: the sidebar, the mobile drawer and the top bar title all read it. */
export const nav: { title: string; items: Item[] }[] = [
  {
    title: 'Main',
    items: [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/subscriptions', label: 'Subscriptions' },
      { href: '/direct-funding', label: 'Direct funding' },
      { href: '/requests', label: 'Requests' },
    ],
  },
  {
    title: 'Resources',
    items: [
      { href: '/docs', label: 'Docs' },
      { href: '/docs#help', label: 'Help', noActive: true },
      { href: `${REPO}/issues/new`, label: 'Contact', external: true },
    ],
  },
  {
    title: 'External',
    items: [
      { href: REPO, label: 'GitHub', external: true },
      { href: `${REPO}/blob/main/docs/ARCHITECTURE.md`, label: 'Architecture', external: true },
      { href: `${REPO}/blob/main/docs/DEPLOYMENT.md`, label: 'Run a node', external: true },
    ],
  },
]

export const isActive = (item: Item, path: string) =>
  !item.external && !item.noActive && (path === item.href || path.startsWith(`${item.href}/`))

const row = 'flex min-h-10 items-center justify-between gap-2 px-3 text-[0.95rem] transition-colors duration-100'

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname()
  return (
    <div className="flex h-full flex-col">
      <Link href="/dashboard" onClick={onNavigate} className="flex min-h-14 items-center gap-2 border-b border-rule px-5 font-display text-xl font-bold tracking-tight">
        <CurveMark />
        Arc VRF
      </Link>
      <nav aria-label="Dashboard" className="flex-1 space-y-6 px-2 py-5">
        {nav.map((section) => (
          <div key={section.title}>
            <p className="label mb-1.5 px-3 text-muted">{section.title}</p>
            <ul>
              {section.items.map((item) => {
                const active = isActive(item, path)
                const cls = `${row} ${active ? 'bg-ink text-paper' : 'text-ink/80 hover:bg-code hover:text-ink'}`
                return (
                  <li key={item.label}>
                    {item.external ? (
                      <a href={item.href} target="_blank" rel="noreferrer" className={cls}>
                        {item.label}
                        <span aria-hidden="true" className="text-xs text-muted">↗</span>
                      </a>
                    ) : (
                      <Link href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={cls}>
                        {item.label}
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-rule p-2">
        <Link href="/" className={`${row} label text-muted hover:bg-code hover:text-ink`}>
          ← Back to site
        </Link>
      </div>
    </div>
  )
}

/** Desktop: fixed column. Hidden below lg, where MobileNav takes over. */
export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen overflow-y-auto border-r-2 border-ink bg-paper lg:block">
      <SidebarNav />
    </aside>
  )
}

/** Phones and tablets: a menu button that opens the same nav in a native <dialog> sheet
 * (focus trap, Escape to close and an inert page come from the browser). */
export function MobileNav() {
  const ref = useRef<HTMLDialogElement>(null)
  const path = usePathname()
  const close = () => ref.current?.close()
  useEffect(close, [path])
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        aria-label="Open navigation"
        className="flex size-11 shrink-0 items-center justify-center border-2 border-ink lg:hidden"
      >
        <span aria-hidden="true">☰</span>
      </button>
      <dialog
        ref={ref}
        aria-label="Navigation"
        onClick={(e) => e.target === e.currentTarget && close()}
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r-2 border-ink bg-paper p-0 text-ink backdrop:bg-ink/40 lg:hidden"
      >
        <button type="button" onClick={close} aria-label="Close navigation" className="absolute top-2 right-2 flex size-11 items-center justify-center">
          <span aria-hidden="true">✕</span>
        </button>
        <SidebarNav onNavigate={close} />
      </dialog>
    </>
  )
}
