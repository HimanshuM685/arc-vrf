'use client'
import { arcVRFCoordinatorAbi } from '@arc-vrf/sdk'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useChains, useReadContracts } from 'wagmi'
import { useDeployment, useLogs } from '@/lib/hooks'
import { ev } from '@/lib/events'
import { short, usdc } from '@/lib/format'
import { Addr, Badge, Fields, NotDeployed, Panel, table } from './ui'

export function NetworkStatus() {
  const { chainId, deployment: d } = useDeployment()
  const chain = useChains().find((c) => c.id === chainId)
  const explorer = chain?.blockExplorers?.default.url
  const coord = { address: d?.coordinator, abi: arcVRFCoordinatorAbi } as const
  const reads = useReadContracts({
    contracts: [
      { ...coord, functionName: 's_config' },
      { ...coord, functionName: 'getProvingKeyHashes' },
      { ...coord, functionName: 's_currentSubNonce' },
      { ...coord, functionName: 'withdrawableNative' },
    ],
    query: { enabled: !!d, refetchInterval: 8000 },
  })

  if (!d) return <NotDeployed chainName={chain?.name} />
  const [config, keys, nonce] = reads.data?.map((r) => r.result) ?? []
  const cfg = config as readonly [number, number, boolean, number, number, number] | undefined
  const failed = reads.isError || reads.data?.some((r) => r.status === 'failure')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">Network</h2>
        <span className="text-sm text-muted">{chain?.name}</span>
        {failed ? <Badge tone="fault">RPC unreachable</Badge> : reads.data ? <Badge tone="verified">Live</Badge> : <Badge tone="muted">Connecting</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat label="Premium" value={cfg ? `${cfg[5]}%` : undefined} note="of gas used" />
        <Stat label="Flat fee" value={cfg ? usdc(BigInt(cfg[4]) * 10n ** 12n) : undefined} note="USDC per request" />
        <Stat label="Max callback gas" value={cfg ? cfg[1].toLocaleString('en') : undefined} note="per request" />
        <Stat label="Subscriptions" value={nonce !== undefined ? String(nonce) : undefined} note="created so far" />
      </div>

      <Panel title="Contracts">
        <Fields
          rows={[
            ['Coordinator', <Addr key="c" value={d.coordinator} explorer={explorer} />],
            ['Wrapper', <Addr key="w" value={d.wrapper} explorer={explorer} />],
            ['Gas lanes', (keys as readonly string[] | undefined)?.map((k) => <div key={k} className="hex">{short(k, 10, 8)}</div>) ?? '…'],
            ['Confirmations', cfg ? `${cfg[0]} (Arc finalises on inclusion)` : '…'],
          ]}
        />
      </Panel>
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value?: ReactNode; note: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-rule bg-panel px-4 py-3.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] sm:px-5 sm:py-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tabular-nums text-ink sm:text-2xl">{value ?? <span className="text-muted">…</span>}</p>
      <p className="mt-0.5 text-xs text-muted">{note}</p>
    </div>
  )
}

/** Latest answered requests across the coordinator, as a table. Shares its log query with any other instance. */
export function RecentFulfilments({ limit = 8 }: { limit?: number }) {
  const { deployment: d } = useDeployment()
  const fulfilled = useLogs(['fulfilled-all'], { address: d?.coordinator, event: ev.fulfilled, fromBlock: d?.deployBlock })
  const recent = [...(fulfilled.data ?? [])].reverse().slice(0, limit)
  if (!d) return null
  return (
    <Panel title="Recent fulfilments" aside={fulfilled.data ? `${fulfilled.data.length} total` : undefined}>
      {recent.length === 0 ? (
        <p className="rounded-lg bg-app px-4 py-6 text-center text-sm text-muted">
          {fulfilled.isError ? 'Couldn’t reach the Arc RPC. Retrying…' : fulfilled.isLoading ? 'Reading the chain…' : (
            <>
              No fulfilments yet. Follow the{' '}
              <Link href="/docs#subscription" className="font-medium text-accent hover:underline">
                quick start
              </Link>{' '}
              to make the first request.
            </>
          )}
        </p>
      ) : (
        <div className={`${table.wrap} -mx-1`}>
          <table className={table.table}>
            <thead>
              <tr>
                <th className={table.th}>Request</th>
                <th className={table.th}>Block</th>
                <th className={table.th}>Charged</th>
                <th className={table.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((l) => (
                <tr key={l.transactionHash} className={table.row}>
                  <td className={table.td}>
                    <Link href={`/requests/${l.args.requestId}`} className="hex text-accent hover:underline">
                      {short(l.args.requestId, 8, 6)}
                    </Link>
                  </td>
                  <td className={`${table.td} tabular-nums text-muted`}>{l.blockNumber.toLocaleString('en')}</td>
                  <td className={`${table.td} tabular-nums`}>{usdc(l.args.payment)} USDC</td>
                  <td className={table.td}>{l.args.success ? <Badge tone="verified">Delivered</Badge> : <Badge tone="fault">Callback reverted</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
