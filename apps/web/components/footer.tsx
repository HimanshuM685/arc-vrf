import Link from 'next/link'
import { REPO } from '@/lib/format'

const links = [
  { href: '/docs', label: 'Docs', external: false },
  { href: REPO, label: 'GitHub', external: true },
  { href: `${REPO}/blob/main/docs/ARCHITECTURE.md`, label: 'Architecture', external: true },
  { href: `${REPO}/blob/main/docs/DEPLOYMENT.md`, label: 'Run a node', external: true },
]

const linkClass = 'label inline-flex min-h-11 items-center underline-offset-4 hover:underline'

/** Marketing footer. The dashboard uses the compact variant. */
export function SiteFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={compact ? 'border-t border-rule' : 'border-t-4 border-ink'}>
      <div
        className={`mx-auto flex max-w-6xl flex-col gap-4 px-4 sm:px-8 md:flex-row md:justify-between lg:px-12 ${
          compact ? 'py-4 md:items-center' : 'gap-6 py-10 md:items-start'
        }`}
      >
        <div className="max-w-md">
          {!compact && <p className="font-display text-2xl font-bold tracking-tight">Arc VRF</p>}
          <p className={`text-sm leading-relaxed text-muted ${compact ? '' : 'mt-2'}`}>
            A fork of Chainlink VRF v2.5 contracts (MIT), adapted for Arc. Not affiliated with Chainlink.
          </p>
        </div>
        <ul className="flex flex-wrap gap-x-6 gap-y-1">
          {links.map((l) => (
            <li key={l.label}>
              {l.external ? (
                <a href={l.href} target="_blank" rel="noreferrer" className={linkClass}>
                  {l.label} ↗
                </a>
              ) : (
                <Link href={l.href} className={linkClass}>
                  {l.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </footer>
  )
}
