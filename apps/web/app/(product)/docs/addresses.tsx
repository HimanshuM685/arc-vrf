'use client'
import { chains, deployments, type Deployment } from '@arc-vrf/sdk'
import { useState } from 'react'
import { explorerAddress } from '@/lib/format'

// Local anvil deployments only make sense while developing.
const showLocal = process.env.NODE_ENV === 'development'

function Row({ label, hint, value, explorer }: { label: string; hint: string; value: string; explorer?: string }) {
  const [copied, setCopied] = useState(false)
  const href = value.length === 42 ? explorerAddress(explorer, value) : undefined
  return (
    <li className="grid gap-x-6 gap-y-1 border-b border-rule py-4 sm:grid-cols-[11rem_1fr]">
      <div>
        <div className="font-semibold">{label}</div>
        <div className="text-sm text-muted">{hint}</div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <code className="hex min-w-0 break-all">{value}</code>
        <span className="label flex gap-4 text-muted">
          <button
            type="button"
            className="min-h-10 cursor-pointer text-accent underline-offset-4 hover:underline"
            onClick={() => {
              navigator.clipboard?.writeText(value).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          {href && (
            <a href={href} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center !no-underline hover:!underline">
              Explorer ↗
            </a>
          )}
        </span>
      </div>
    </li>
  )
}

export function Addresses() {
  const all = Object.entries(deployments as Record<string, Deployment>).filter(([id]) => showLocal || id !== '31337')
  if (!all.length) return <p>No deployments recorded yet.</p>
  return (
    <>
      {all.map(([id, d]) => {
        const chain = chains.find((c) => String(c.id) === id)
        const explorer = chain?.blockExplorers?.default.url
        return (
          <div key={id}>
            <h3>{chain?.name ?? `Chain ${id}`}</h3>
            <p className="text-muted">
              Chain ID <code>{id}</code>
              {chain && id !== '31337' && <> · RPC <code>{chain.rpcUrls.default.http[0]}</code></>} · gas is paid in USDC
            </p>
            <ul className="!list-none !pl-0">
              <Row label="Coordinator" hint="Subscriptions call this" value={d.coordinator} explorer={explorer} />
              <Row label="Wrapper" hint="Direct funding calls this" value={d.wrapper} explorer={explorer} />
              <Row label="Key hash" hint="Pass this in every request" value={d.keyHash} explorer={explorer} />
            </ul>
            <details>
              <summary>Also deployed</summary>
              <ul className="!list-none !pl-0">
                <Row label="BlockhashStore" hint="Old block hashes" value={d.blockhashStore} explorer={explorer} />
                <Row label="Batch helper" hint="Many answers in one tx" value={d.batchCoordinator} explorer={explorer} />
              </ul>
            </details>
          </div>
        )
      })}
    </>
  )
}
