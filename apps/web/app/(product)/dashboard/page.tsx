'use client'
import Link from 'next/link'
import { NetworkStatus } from '@/components/network-status'
import { PageHead } from '@/components/ui'

const actions = [
  { href: '/subscriptions', title: 'Create a subscription', text: 'Fund one balance and add the contracts allowed to spend it.' },
  { href: '/direct-funding', title: 'Price a request', text: 'Fee calculator for direct funding, at the live gas price.' },
  { href: '/requests', title: 'Trace a request', text: 'See how any number was made, step by step.' },
  { href: '/docs#subscription', title: 'Read the quick start', text: 'Request randomness from a contract in a few lines.' },
]

export default function DashboardPage() {
  return (
    <>
      <PageHead title="Overview">Your Arc VRF tools and the live state of the network.</PageHead>

      <section aria-labelledby="actions">
        <h2 id="actions" className="label mb-2 text-muted">Quick actions</h2>
        <ul className="grid border-t border-l border-ink sm:grid-cols-2 xl:grid-cols-4">
          {actions.map((a) => (
            <li key={a.href} className="border-r border-b border-ink">
              <Link href={a.href} className="group flex h-full flex-col gap-1 p-4 transition-colors duration-100 hover:bg-ink hover:text-paper">
                <span className="flex items-center justify-between gap-2 font-medium">
                  {a.title}
                  <span aria-hidden="true">→</span>
                </span>
                <span className="text-sm leading-relaxed text-muted group-hover:text-paper">{a.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="network" className="mt-8">
        <h2 id="network" className="label mb-2 text-muted">Network</h2>
        <NetworkStatus />
      </section>
    </>
  )
}
