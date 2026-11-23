'use client'
import { arcVRFCoordinatorAbi } from '@arc-vrf/sdk'
import Link from 'next/link'
import { useReadContracts } from 'wagmi'
import { useDeployment, useLogs } from '@/lib/hooks'
import { ev } from '@/lib/events'
import { short, usdc } from '@/lib/format'
import { Addr, Badge, Fields, NotDeployed, Panel } from './ui'
import { useChains } from 'wagmi'

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
  const fulfilled = useLogs(['fulfilled-all'], { address: d?.coordinator, event: ev.fulfilled, fromBlock: d?.deployBlock })

  if (!d) return <NotDeployed chainName={chain?.name} />
  const [config, keys, nonce] = reads.data?.map((r) => r.result) ?? []
  const cfg = config as readonly [number, number, boolean, number, number, number] | undefined
  const recent = [...(fulfilled.data ?? [])].reverse().slice(0, 8)

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
      <Panel title={`Live on ${chain?.name}`} aside={reads.isError || reads.data?.some((r) => r.status === 'failure') ? <Badge tone="fault">RPC unreachable</Badge> : reads.data ? <Badge tone="verified">Reading live</Badge> : <Badge tone="muted">Connecting</Badge>}>
        <Fields
          rows={[
            ['Coordinator', <Addr key="c" value={d.coordinator} explorer={explorer} />],
            ['Wrapper', <Addr key="w" value={d.wrapper} explorer={explorer} />],
            ['Gas lanes', (keys as readonly string[] | undefined)?.map((k) => <div key={k} className="hex">{short(k, 10, 8)}</div>) ?? '…'],
            ['Premium', cfg ? `${cfg[5]}% of gas` : '…'],
            ['Flat fee', cfg ? `${usdc(BigInt(cfg[4]) * 10n ** 12n)} USDC` : '…'],
            ['Max callback gas', cfg ? cfg[1].toLocaleString('en') : '…'],
            ['Min confirmations', cfg ? `${cfg[0]} (Arc finalises on inclusion)` : '…'],
            ['Subscriptions created', nonce !== undefined ? String(nonce) : '…'],
          ]}
        />
      </Panel>
      <Panel title="Recent fulfilments" aside={fulfilled.data ? `${fulfilled.data.length} total` : undefined}>
        {recent.length === 0 ? (
          <p className="text-muted">No fulfilments yet. Follow the <Link href="/docs#subscription" className="underline underline-offset-4">quick start</Link> to make the first request.</p>
        ) : (
          <ul className="divide-y divide-rule border-t border-rule">
            {recent.map((l) => (
              <li key={l.transactionHash} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
                <Link href={`/requests/${l.args.requestId}`} className="hex underline-offset-4 hover:underline">
                  {short(l.args.requestId, 8, 6)}
                </Link>
                <span className="flex items-center gap-4 text-sm">
                  <span className="text-muted">block {l.blockNumber.toLocaleString('en')}</span>
                  <span className="tabular-nums">{usdc(l.args.payment)} USDC</span>
                  {l.args.success ? <Badge tone="verified">Delivered</Badge> : <Badge tone="fault">Callback reverted</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
