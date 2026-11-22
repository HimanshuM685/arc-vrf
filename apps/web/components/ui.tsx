'use client'
import type { ReactNode } from 'react'
import { useAccount } from 'wagmi'
import type { TxState } from '@/lib/hooks'
import { explorerAddress, explorerTx, short } from '@/lib/format'

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="pt-10 pb-6">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      {children && <div className="mt-3 max-w-[68ch] text-lg leading-relaxed text-muted">{children}</div>}
    </div>
  )
}

export function Panel({ title, aside, children, className = '' }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-rule bg-panel p-5 ${className}`}>
      {(title || aside) && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {aside && <div className="text-sm text-muted">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Fields({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-2.5 text-[0.95rem]">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'quiet' | 'danger'
  type?: 'button' | 'submit'
}) {
  const styles = {
    primary: 'bg-lane text-lane-ink hover:brightness-110',
    quiet: 'border border-rule text-ink hover:border-ink',
    danger: 'border border-fault text-fault hover:bg-fault hover:text-paper',
  }[variant]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-3.5 py-2 text-sm font-medium transition-[filter,background-color] disabled:cursor-not-allowed disabled:opacity-45 ${styles}`}
    >
      {children}
    </button>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const { label, hint, ...rest } = props
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <input
        {...rest}
        className="min-w-0 rounded border border-rule bg-paper px-3 py-2 font-mono text-[0.9rem] outline-none focus:border-lane"
      />
      {hint && <span className="text-muted">{hint}</span>}
    </label>
  )
}

export function TxNote({ tx, explorer, done = 'Confirmed.' }: { tx: TxState; explorer?: string; done?: string }) {
  if (tx.status === 'idle') return null
  const link = tx.hash ? explorerTx(explorer, tx.hash) : undefined
  const text = {
    signing: 'Confirm in your wallet…',
    pending: 'Waiting for the block…',
    done,
    error: tx.error,
  }[tx.status]
  const color = tx.status === 'error' ? 'text-fault' : tx.status === 'done' ? 'text-verified' : 'text-waiting'
  return (
    <p className={`mt-2 text-sm ${color}`} role="status">
      {text}{' '}
      {link && (
        <a href={link} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          View transaction
        </a>
      )}
    </p>
  )
}

export function Addr({ value, explorer }: { value?: string; explorer?: string }) {
  if (!value) return <span className="text-muted">…</span>
  const href = explorerAddress(explorer, value)
  const body = <span className="hex" title={value}>{short(value, 8, 6)}</span>
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="hover:text-lane">
      {body}
    </a>
  ) : (
    body
  )
}

export function NotDeployed({ chainName }: { chainName?: string }) {
  return (
    <Panel>
      <p className="font-medium">Arc VRF isn't deployed on {chainName ?? 'this network'} yet.</p>
      <p className="mt-2 text-muted">
        Switch to a network with a deployment, or deploy your own with <code className="hex">pnpm --filter @arc-vrf/node deploy</code>{' '}
        and regenerate the SDK.
      </p>
    </Panel>
  )
}

export function NeedsWallet({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount()
  if (isConnected) return <>{children}</>
  return (
    <Panel>
      <p className="font-medium">Connect a wallet to manage subscriptions.</p>
      <p className="mt-2 text-muted">Subscriptions are on-chain accounts owned by your address. The dashboard only sends the transactions.</p>
    </Panel>
  )
}

export function Badge({ tone, children }: { tone: 'verified' | 'waiting' | 'fault' | 'muted'; children: ReactNode }) {
  const c = { verified: 'text-verified', waiting: 'text-waiting', fault: 'text-fault', muted: 'text-muted' }[tone]
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${c}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  )
}
