'use client'
import { arcVRFCoordinatorAbi } from '@arc-vrf/sdk'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { keepPreviousData } from '@tanstack/react-query'
import { ContractFunctionRevertedError, parseEventLogs, type BaseError } from 'viem'
import { useAccount, useChains, useReadContracts } from 'wagmi'
import { Badge, Button, NeedsWallet, NotDeployed, PageHead, Panel, TxNote } from '@/components/ui'
import { ev } from '@/lib/events'
import { short, usdc } from '@/lib/format'
import { systemSub, useDeployment, useLogs, useTx } from '@/lib/hooks'

export default function SubscriptionsPage() {
  const { chainId, deployment: d } = useDeployment()
  const chain = useChains().find((c) => c.id === chainId)
  return (
    <>
      <PageHead title="Subscriptions">
        A subscription is an on-chain USDC balance plus the list of contracts allowed to spend it. Fund it once; each
        fulfilment is charged for gas used plus the premium.
      </PageHead>
      {!d ? <NotDeployed chainName={chain?.name} /> : <NeedsWallet><MySubscriptions /></NeedsWallet>}
    </>
  )
}

function MySubscriptions() {
  const { deployment: d } = useDeployment()
  const { address } = useAccount()
  const router = useRouter()
  const tx = useTx()
  // Candidates: subscriptions this wallet created or was transferred (owner is an indexed topic, so
  // the scan is cheap). Only these are read; current ownership is checked below.
  const created = useLogs(['created', address], { address: d!.coordinator, event: ev.subCreated, args: { owner: address }, fromBlock: d!.deployBlock })
  const transferred = useLogs(['transferred'], { address: d!.coordinator, event: ev.subTransferred, fromBlock: d!.deployBlock })
  const ids = [
    ...new Set([
      ...(created.data ?? []).map((l) => l.args.subId!),
      ...(transferred.data ?? []).filter((l) => l.args.to === address).map((l) => l.args.subId!),
    ]),
  ]
  const subs = useReadContracts({
    contracts: ids.map((id) => ({ address: d!.coordinator, abi: arcVRFCoordinatorAbi, functionName: 'getSubscription', args: [id] }) as const),
    query: { refetchInterval: 6000, placeholderData: keepPreviousData },
  })
  const rows = ids.map((id, i) => ({ id, r: subs.data?.[i] }))
  const mine = rows.filter((s) => s.r?.status === 'success' && (s.r.result as readonly unknown[])[3] === address)
  // A revert means the subscription is gone (cancelled); any other failure means we couldn't read it.
  const unreadable = rows.some(
    (s) => s.r?.status === 'failure' && !(s.r.error as BaseError).walk?.((e) => e instanceof ContractFunctionRevertedError),
  )

  async function create() {
    const r = await tx.send({ address: d!.coordinator, abi: arcVRFCoordinatorAbi, functionName: 'createSubscription' })
    const [log] = r ? parseEventLogs({ abi: arcVRFCoordinatorAbi, logs: r.logs, eventName: 'SubscriptionCreated' }) : []
    if (log) router.push(`/subscriptions/${log.args.subId}`)
  }

  const loading = created.isLoading || transferred.isLoading || subs.isLoading
  const failed = created.isError || transferred.isError || (subs.isError && !subs.data) || (unreadable && mine.length === 0)
  return (
    <div className="space-y-5">
      <div>
        <Button onClick={create} disabled={tx.status === 'signing' || tx.status === 'pending'}>
          Create subscription
        </Button>
        <TxNote tx={tx} done="Subscription created." />
      </div>
      <Panel title="Your subscriptions">
        {failed ? (
          <p className="alert" role="alert">Couldn’t reach the Arc RPC. Retrying…</p>
        ) : loading ? (
          <p className="text-muted">Reading subscriptions…</p>
        ) : mine.length === 0 ? (
          <p className="text-muted">You don’t own any subscriptions on this network. Create one to get a subscription ID for your contracts.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {mine.map(({ id, r }) => {
              const [, bal, reqs, , consumers] = r!.result as readonly [bigint, bigint, bigint, string, readonly string[]]
              return (
                <li key={id.toString()}>
                  <Link href={`/subscriptions/${id}`} className="group flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
                    <span className="hex underline-offset-4 group-hover:underline">{short(id, 10, 8)} <span aria-hidden="true">→</span></span>
                    <span className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                      <span className="tabular-nums">{usdc(bal)} USDC</span>
                      <span className="text-muted">{consumers.length} consumer{consumers.length === 1 ? '' : 's'}</span>
                      <span className="text-muted">{reqs.toString()} fulfilled</span>
                      {systemSub(d, id) === 'wrapper' && <Badge tone="verified">Direct-funding pool</Badge>}
                      {systemSub(d, id) === 'hilo' && <Badge tone="verified">Playground sample</Badge>}
                      {bal === 0n && <Badge tone="waiting">Needs funding</Badge>}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
        {mine.some(({ id }) => systemSub(d, id)) && (
          <p className="mt-4 text-sm text-muted">
            Marked subscriptions were created and funded by the deploy script, from this wallet (the deployer). The USDC
            in them came from this wallet when the contracts were deployed.
          </p>
        )}
      </Panel>
    </div>
  )
}

