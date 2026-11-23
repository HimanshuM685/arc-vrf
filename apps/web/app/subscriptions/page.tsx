'use client'
import { arcVRFCoordinatorAbi } from '@arc-vrf/sdk'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { parseEventLogs, type Address, type PublicClient } from 'viem'
import { useAccount, useChains, usePublicClient, useReadContracts } from 'wagmi'
import { Badge, Button, NeedsWallet, NotDeployed, PageHead, Panel, TxNote } from '@/components/ui'
import { short, usdc } from '@/lib/format'
import { useDeployment, useTx } from '@/lib/hooks'

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
  const client = usePublicClient()
  // Every live subscription id, read from the coordinator itself (no log scan, so no RPC block-range
  // limits); ownership is checked below. Includes subscriptions transferred to this wallet.
  const all = useQuery({
    queryKey: ['sub-ids', client?.chain.id, d!.coordinator],
    enabled: !!client,
    refetchInterval: 6000,
    queryFn: () => activeSubIds(client as PublicClient, d!.coordinator),
  })
  const ids = all.data ?? []
  const subs = useReadContracts({
    contracts: ids.map((id) => ({ address: d!.coordinator, abi: arcVRFCoordinatorAbi, functionName: 'getSubscription', args: [id] }) as const),
    query: { refetchInterval: 6000 },
  })
  const mine = ids
    .map((id, i) => ({ id, r: subs.data?.[i] }))
    .filter((s) => s.r?.status === 'success' && (s.r.result as readonly unknown[])[3] === address)

  async function create() {
    const r = await tx.send({ address: d!.coordinator, abi: arcVRFCoordinatorAbi, functionName: 'createSubscription' })
    const [log] = r ? parseEventLogs({ abi: arcVRFCoordinatorAbi, logs: r.logs, eventName: 'SubscriptionCreated' }) : []
    if (log) router.push(`/subscriptions/${log.args.subId}`)
  }

  const loading = all.isLoading || subs.isLoading
  const failed = (all.isError && !all.data) || (subs.isError && !subs.data)
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
          <p className="text-fault">Couldn’t reach the Arc RPC. Retrying…</p>
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
                  <Link href={`/subscriptions/${id}`} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3 hover:text-lane">
                    <span className="hex">{short(id, 10, 8)}</span>
                    <span className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                      <span>{usdc(bal)} USDC</span>
                      <span className="text-muted">{consumers.length} consumer{consumers.length === 1 ? '' : 's'}</span>
                      <span className="text-muted">{reqs.toString()} fulfilled</span>
                      {bal === 0n && <Badge tone="waiting">Needs funding</Badge>}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>
  )
}

/** All active subscription ids on the coordinator, 500 per call.
 * ponytail: reads every subscription; fine for testnet, add an indexer when there are many thousands. */
async function activeSubIds(client: PublicClient, coordinator: Address): Promise<bigint[]> {
  const ids: bigint[] = []
  for (;;) {
    let page: readonly bigint[]
    try {
      page = await client.readContract({ address: coordinator, abi: arcVRFCoordinatorAbi, functionName: 'getActiveSubscriptionIds', args: [BigInt(ids.length), 500n] })
    } catch (e) {
      // Reverts with IndexOutOfRange when the start index is past the end: no (more) subscriptions.
      if (/IndexOutOfRange/.test(String(e))) return ids
      throw e
    }
    ids.push(...page)
    if (page.length < 500) return ids
  }
}
