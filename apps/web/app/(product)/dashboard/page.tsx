'use client'
import { BookOpen, Calculator, Plus, Search } from 'lucide-react'
import Link from 'next/link'
import { NetworkStatus, RecentFulfilments } from '@/components/network-status'
import { PageHead, appButtonClass } from '@/components/ui'

const actions = [
  { href: '/subscriptions', label: 'Create subscription', icon: Plus, primary: true },
  { href: '/direct-funding', label: 'Price a request', icon: Calculator },
  { href: '/requests', label: 'Trace a request', icon: Search },
  { href: '/docs#subscription', label: 'Quick start', icon: BookOpen },
]

export default function DashboardPage() {
  return (
    <>
      <PageHead title="Overview">Your Arc VRF tools and the live state of the network.</PageHead>

      <nav aria-label="Quick actions" className="mb-10 flex flex-wrap gap-2">
        {actions.map(({ href, label, icon: Icon, primary }) => (
          <Link key={href} href={href} className={appButtonClass(primary ? 'primary' : 'quiet')}>
            <Icon size={16} strokeWidth={2} aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="space-y-10">
        <NetworkStatus />
        <RecentFulfilments />
      </div>
    </>
  )
}
