'use client'
// Dashboard building blocks. Only the product area uses these; the landing page uses components/primitives.tsx.
import { ConnectButton } from '@rainbow-me/rainbowkit'
import type { ReactNode } from 'react'
import { useAccount } from 'wagmi'
import type { TxState } from '@/lib/hooks'
import { explorerAddress, explorerTx, short } from '@/lib/format'

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-semibold break-words text-ink">{title}</h1>
      {children && <div className="mt-1.5 max-w-[70ch] text-sm leading-relaxed text-muted">{children}</div>}
    </div>
  )
}

export function Panel({ title, aside, children, className = '' }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-rule bg-panel p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] sm:p-6 ${className}`}>
      {(title || aside) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
          {aside && <div className="text-sm text-muted">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Fields({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="text-sm">
      {rows.map(([k, v], i) => (
        <div key={i} className="grid gap-x-6 gap-y-0.5 border-t border-rule py-3 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

type Variant = 'primary' | 'quiet' | 'danger'

/** Dashboard button look, also for links that act as buttons. */
export function appButtonClass(variant: Variant = 'primary') {
  const styles = {
    primary: 'bg-accent text-white not-disabled:hover:opacity-90',
    quiet: 'border border-rule bg-paper text-ink not-disabled:hover:bg-app',
    danger: 'border border-red-200 bg-paper text-fault not-disabled:hover:bg-red-50',
  }[variant]
  return `inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-medium transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50 ${styles}`
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
  variant?: Variant
  type?: 'button' | 'submit'
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={appButtonClass(variant)}>
      {children}
    </button>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const { label, hint, ...rest } = props
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        {...rest}
        className="h-10 min-w-0 rounded-md border border-rule bg-paper px-3 font-mono text-sm text-ink outline-none transition-shadow duration-100 focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
      {hint && <span className="text-xs text-muted">{hint}</span>}
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
  const isError = tx.status === 'error'
  const color = { signing: 'text-waiting', pending: 'text-waiting', done: 'text-verified', error: '' }[tx.status]
  return (
    <p className={`mt-3 text-sm ${isError ? 'alert' : color}`} role={isError ? 'alert' : 'status'}>
      {text}{' '}
      {link && (
        <a href={link} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
          View transaction ↗
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
    <a href={href} target="_blank" rel="noreferrer" className="text-accent underline-offset-4 hover:underline">
      {body}
    </a>
  ) : (
    body
  )
}

export function NotDeployed({ chainName }: { chainName?: string }) {
  return (
    <Panel>
      <p className="font-semibold">Arc VRF isn’t deployed on {chainName ?? 'this network'} yet.</p>
      <p className="mt-1.5 text-sm text-muted">
        Switch your wallet to Arc Testnet, or deploy your own with{' '}
        <code className="hex rounded bg-code px-1">pnpm --filter @arc-vrf/node deploy-contracts</code> and regenerate the SDK.
      </p>
    </Panel>
  )
}

export function NeedsWallet({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount()
  if (isConnected) return <>{children}</>
  return (
    <Panel>
      <p className="font-semibold">Connect a wallet to manage subscriptions.</p>
      <p className="mt-1.5 max-w-[60ch] text-sm text-muted">
        Subscriptions are on-chain accounts owned by your address. The dashboard only sends the transactions.
      </p>
      <div className="mt-5">
        <ConnectButton showBalance={false} />
      </div>
    </Panel>
  )
}

export function Badge({ tone, children }: { tone: 'verified' | 'waiting' | 'fault' | 'muted'; children: ReactNode }) {
  const c = {
    verified: 'bg-emerald-50 text-verified ring-emerald-600/15',
    waiting: 'bg-amber-50 text-waiting ring-amber-600/20',
    fault: 'bg-red-50 text-fault ring-red-600/15',
    muted: 'bg-gray-100 text-muted ring-gray-500/10',
  }[tone]
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${c}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  )
}

/** Shared table styling for request lists. */
export const table = {
  wrap: 'overflow-x-auto',
  table: 'w-full min-w-[34rem] text-sm',
  th: 'bg-app px-4 py-2.5 text-left text-xs font-medium text-muted first:rounded-l-md last:rounded-r-md',
  td: 'border-t border-rule px-4 py-3 align-middle',
  row: 'transition-colors duration-100 hover:bg-app/60',
}
