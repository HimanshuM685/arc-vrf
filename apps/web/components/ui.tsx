'use client'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import type { ReactNode } from 'react'
import { useAccount } from 'wagmi'
import type { TxState } from '@/lib/hooks'
import { explorerAddress, explorerTx, short } from '@/lib/format'
import { Rule, buttonClass, type Variant } from './primitives'

export { Rule, buttonClass }

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 border-b border-rule pb-5">
      <h1 className="text-3xl leading-tight font-bold tracking-tight break-words sm:text-4xl">{title}</h1>
      {children && <div className="mt-2 max-w-[70ch] leading-relaxed text-muted">{children}</div>}
    </div>
  )
}

export function Panel({ title, aside, children, className = '' }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 border border-ink bg-panel p-5 ${className}`}>
      {(title || aside) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule pb-3">
          {title && <h2 className="text-xl font-bold">{title}</h2>}
          {aside && <div className="label text-muted">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Fields({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-[minmax(9rem,auto)_1fr]">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="label pt-2.5 text-muted sm:pb-2.5 sm:pt-[0.8rem]">{k}</dt>
          <dd className="min-w-0 border-b border-rule pb-2.5 pt-1 sm:pt-2.5">{v}</dd>
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
  variant?: Exclude<Variant, 'inverse'>
  type?: 'button' | 'submit'
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={buttonClass(variant)}>
      {children}
    </button>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const { label, hint, ...rest } = props
  return (
    <label className="flex min-w-0 flex-col gap-2">
      <span className="label">{label}</span>
      <input
        {...rest}
        className="min-h-11 min-w-0 border-0 border-b-2 border-ink bg-transparent px-0 py-2 font-mono text-[0.95rem] outline-none focus:shadow-[inset_0_-2px_0_var(--ink)]"
      />
      {hint && <span className="text-sm italic text-muted">{hint}</span>}
    </label>
  )
}

export function TxNote({ tx, explorer, done = 'Confirmed.' }: { tx: TxState; explorer?: string; done?: string }) {
  if (tx.status === 'idle') return null
  const link = tx.hash ? explorerTx(explorer, tx.hash) : undefined
  const text = {
    signing: 'Confirm in your wallet…',
    pending: 'Waiting for the block…',
    done: `✓ ${done}`,
    error: tx.error,
  }[tx.status]
  const isError = tx.status === 'error'
  return (
    <p className={`mt-3 text-sm ${isError ? 'alert' : 'text-ink'}`} role={isError ? 'alert' : 'status'}>
      {text}{' '}
      {link && (
        <a href={link} target="_blank" rel="noreferrer" className="underline underline-offset-4">
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
    <a href={href} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
      {body}
    </a>
  ) : (
    body
  )
}

export function NotDeployed({ chainName }: { chainName?: string }) {
  return (
    <Panel>
      <p className="font-display text-xl font-bold">Arc VRF isn’t deployed on {chainName ?? 'this network'} yet.</p>
      <p className="mt-3 text-muted">
        Switch your wallet to Arc Testnet, or deploy your own with{' '}
        <code className="hex bg-code px-1">pnpm --filter @arc-vrf/node deploy-contracts</code> and regenerate the SDK.
      </p>
    </Panel>
  )
}

export function NeedsWallet({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount()
  if (isConnected) return <>{children}</>
  return (
    <Panel>
      <p className="font-display text-xl font-bold">Connect a wallet to manage subscriptions.</p>
      <p className="mt-3 max-w-[60ch] text-muted">
        Subscriptions are on-chain accounts owned by your address. The dashboard only sends the transactions.
      </p>
      <div className="mt-6">
        <ConnectButton showBalance={false} />
      </div>
    </Panel>
  )
}

/** No colors: state reads from the frame and the glyph. Problems are inverted, the loudest thing on the page. */
export function Badge({ tone, children }: { tone: 'verified' | 'waiting' | 'fault' | 'muted'; children: ReactNode }) {
  const s = {
    verified: ['border border-ink', '✓'],
    waiting: ['border border-dashed border-ink', '○'],
    fault: ['border border-ink bg-ink text-paper', '✕'],
    muted: ['text-muted', '–'],
  }[tone]
  return (
    <span className={`label inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-1 ${s[0]}`}>
      <span aria-hidden="true">{s[1]}</span>
      {children}
    </span>
  )
}
