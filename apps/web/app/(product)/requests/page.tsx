'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { RecentFulfilments } from '@/components/network-status'
import { Button, Input, PageHead, Panel } from '@/components/ui'

export default function RequestsPage() {
  return (
    <>
      <PageHead title="Requests">
        Look up any request to see who asked, what it cost, and every step of how its number was made.
      </PageHead>
      <div className="grid gap-5 xl:grid-cols-[1fr_1.3fr]">
        <TraceRequest />
        <RecentFulfilments limit={12} />
      </div>
    </>
  )
}

function TraceRequest() {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  return (
    <Panel title="Trace a request" className="self-start">
      <form
        className="flex flex-col gap-4"
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
        <Input
          label="Request ID"
          placeholder="Decimal or 0x hex"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError('')
          }}
          hint="From your contract’s RandomWordsRequested event, or the explorer."
        />
        <div>
          <Button type="submit" disabled={!value.trim()}>
            Trace
          </Button>
        </div>
      </form>
      {error && (
        <p className="alert mt-3 text-sm" role="alert">
          {error}
        </p>
      )}
    </Panel>
  )
}
