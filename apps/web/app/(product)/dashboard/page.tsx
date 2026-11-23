'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { NetworkStatus } from '@/components/network-status'
import { Button, Input, PageHead, Panel } from '@/components/ui'

const tools = [
  { href: '/subscriptions', title: 'Subscriptions', text: 'Create a subscription, fund it with USDC, and add the contracts allowed to spend it.' },
  { href: '/direct-funding', title: 'Direct funding', text: 'Price a request before you send it, and see recent direct-funding requests.' },
  { href: '/docs', title: 'Docs', text: 'Quick starts for both payment methods, request parameters and troubleshooting.' },
]

export default function DashboardPage() {
  return (
    <>
      <PageHead title="Dashboard">
        Manage your subscriptions, price direct-funding requests, and trace any request on Arc.
      </PageHead>

      <div className="grid gap-5 md:grid-cols-3">
        {tools.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group flex flex-col border-2 border-ink p-6 transition-colors duration-100 hover:bg-ink hover:text-paper"
          >
            <h2 className="text-3xl font-bold">{t.title}</h2>
            <p className="mt-3 leading-relaxed text-muted group-hover:text-paper">{t.text}</p>
            <span className="label mt-auto inline-flex items-center gap-2 pt-6 underline-offset-4 group-hover:underline">
              Open <span aria-hidden="true">→</span>
            </span>
          </Link>
        ))}
      </div>

      <TraceRequest />

      <section className="mt-16 border-t-4 border-ink pt-8">
        <h2 className="mb-8 text-4xl font-bold">Network</h2>
        <NetworkStatus />
      </section>
    </>
  )
}

function TraceRequest() {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  return (
    <Panel title="Trace a request" className="mt-5">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          let id: bigint
          try {
            id = BigInt(value.trim())
          } catch {
            return setError('Enter a request ID: a decimal number or 0x hex.')
          }
          if (id < 0n) return setError('Request IDs are never negative.')
          router.push(`/requests/${id}`)
        }}
      >
        <div className="min-w-0 flex-1 basis-72">
          <Input
            label="Request ID"
            placeholder="From your contract’s event or the explorer"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError('')
            }}
            hint="See who asked, what it cost, and every step of how the number was made."
          />
        </div>
        <Button type="submit" disabled={!value.trim()}>
          Trace
        </Button>
      </form>
      {error && (
        <p className="alert mt-3 text-sm" role="alert">
          {error}
        </p>
      )}
    </Panel>
  )
}
