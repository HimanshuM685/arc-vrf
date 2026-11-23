'use client'
import {
  ArrowLeft,
  BookOpen,
  FileText,
  GitBranch,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  MessageSquare,
  Search,
  Server,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { REPO } from '@/lib/format'
import { CurveMark } from './primitives'

type Item = {
  href: string
  label: string
  icon: LucideIcon
  external?: boolean
  /** Hash links never show as the current page. */
  noActive?: boolean
}

/** Single source for the dashboard navigation: the sidebar and the mobile drawer both read it. */
export const nav: { title: string; items: Item[] }[] = [
  {
    title: 'Main',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/subscriptions', label: 'Subscriptions', icon: Layers },
      { href: '/direct-funding', label: 'Direct funding', icon: Zap },
      { href: '/requests', label: 'Requests', icon: Search },
    ],
  },
  {
    title: 'Resources',
    items: [
      { href: '/docs', label: 'Docs', icon: BookOpen },
      { href: '/docs#help', label: 'Help', icon: LifeBuoy, noActive: true },
      { href: `${REPO}/issues/new`, label: 'Contact', icon: MessageSquare, external: true },
    ],
  },
  {
    title: 'External',
    items: [
      { href: REPO, label: 'GitHub', icon: GitBranch, external: true },
      { href: `${REPO}/blob/main/docs/ARCHITECTURE.md`, label: 'Architecture', icon: FileText, external: true },
      { href: `${REPO}/blob/main/docs/DEPLOYMENT.md`, label: 'Run a node', icon: Server, external: true },
    ],
  },
]

const isActive = (item: Item, path: string) =>
  !item.external && !item.noActive && (path === item.href || path.startsWith(`${item.href}/`))

export function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <Link href="/dashboard" onClick={onClick} className="flex items-center gap-2 text-[0.95rem] font-semibold text-ink">
      <span className="text-accent">
        <CurveMark />
      </span>
      Arc VRF
      <span className="hidden rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent sm:inline">Dashboard</span>
    </Link>
  )
}

/** `rail`: icon-only between lg and xl, where space is tight. The drawer always shows labels. */
function SidebarNav({ rail = false, onNavigate }: { rail?: boolean; onNavigate?: () => void }) {
  const path = usePathname()
  const text = rail ? 'hidden xl:inline' : ''
  const row = `flex h-9 items-center gap-3 rounded-md px-2.5 text-sm transition-colors duration-100 ${rail ? 'justify-center xl:justify-start' : ''}`
  return (
    <div className="flex h-full flex-col">
      <nav aria-label="Dashboard" className="flex-1 space-y-6 px-3 py-5">
        {nav.map((section) => (
          <div key={section.title}>
            <p className={`mb-1 px-2.5 text-xs font-medium text-muted/80 ${rail ? 'hidden xl:block' : ''}`}>{section.title}</p>
            {rail && <hr className="mx-2 mb-2 border-rule xl:hidden" aria-hidden="true" />}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item, path)
                const Icon = item.icon
                const cls = `${row} ${active ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-app hover:text-ink'}`
                const body = (
                  <>
                    <Icon size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                    <span className={`${text} flex-1`}>{item.label}</span>
                    {item.external && <span aria-hidden="true" className={`${text} text-xs text-muted/70`}>↗</span>}
                  </>
                )
                return (
                  <li key={item.label}>
                    {item.external ? (
                      <a href={item.href} target="_blank" rel="noreferrer" className={cls} title={rail ? item.label : undefined} aria-label={rail ? `${item.label} (opens in a new tab)` : undefined}>
                        {body}
                      </a>
                    ) : (
                      <Link href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={cls} title={rail ? item.label : undefined} aria-label={rail ? item.label : undefined}>
                        {body}
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-rule p-3">
        <Link href="/" className={`${row} text-muted hover:bg-app hover:text-ink`} title={rail ? 'Back to site' : undefined} aria-label={rail ? 'Back to site' : undefined}>
          <ArrowLeft size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          <span className={text}>Back to site</span>
        </Link>
      </div>
    </div>
  )
}

/** Desktop column, below the top bar. Hidden below lg, where MobileNav takes over. */
export function Sidebar() {
  return (
    <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] overflow-y-auto border-r border-rule bg-paper lg:block">
      <SidebarNav rail />
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
        className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-md text-muted hover:bg-app hover:text-ink lg:hidden"
      >
        <Menu size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <dialog
        ref={ref}
        aria-label="Navigation"
        onClick={(e) => e.target === e.currentTarget && close()}
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] rounded-r-xl border-r border-rule bg-paper p-0 text-ink shadow-xl backdrop:bg-black/30 lg:hidden"
      >
        <div className="flex h-14 items-center justify-between border-b border-rule px-4">
          <Logo onClick={close} />
          <button type="button" onClick={close} aria-label="Close navigation" className="flex size-10 items-center justify-center rounded-md text-muted hover:bg-app hover:text-ink">
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className="h-[calc(100%-3.5rem)]">
          <SidebarNav onNavigate={close} />
        </div>
      </dialog>
    </>
  )
}
