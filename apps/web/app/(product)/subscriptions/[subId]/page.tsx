'use client'
import { arcVRFCoordinatorAbi, subscriptionMaxCost } from '@arc-vrf/sdk'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import { BaseError, ContractFunctionRevertedError, isAddress, parseEther, type Address } from 'viem'
import { useAccount, useChains, useReadContracts } from 'wagmi'
import { Addr, Badge, Button, Fields, Input, NotDeployed, PageHead, Panel, TxNote, table } from '@/components/ui'
import { ev } from '@/lib/events'
import { short, usdc } from '@/lib/format'
import { systemSub, useDeployment, useLogs, useTx } from '@/lib/hooks'

export default function SubscriptionPage() {
  const params = useParams<{ subId: string }>()
  const { chainId, deployment: d } = useDeployment()
  const chain = useChains().find((c) => c.id === chainId)
  const explorer = chain?.blockExplorers?.default.url
  const { address } = useAccount()
  let subId: bigint | undefined
  try {
    subId = BigInt(params.subId)
  } catch {}

  const coord = { address: d?.coordinator, abi: arcVRFCoordinatorAbi } as const
  const reads = useReadContracts({
    contracts: [
      { ...coord, functionName: 'getSubscription', args: [subId ?? 0n] },
      { ...coord, functionName: 'pendingRequestExists', args: [subId ?? 0n] },
      { ...coord, functionName: 'getRequestedOwner', args: [subId ?? 0n] },
      { ...coord, functionName: 's_config' },
      { ...coord, functionName: 's_provingKeys', args: [d?.keyHash ?? '0x'] },
      { ...coord, functionName: 's_pendingRefunds', args: [address ?? '0x0000000000000000000000000000000000000000'] },
    ],
    query: { enabled: !!d && subId !== undefined, refetchInterval: 5000 },
  })

  if (!d) return <NotDeployed chainName={chain?.name} />
  if (subId === undefined) return <PageHead title="Not a subscription ID" />

  const [subR, pendingR, reqOwnerR, cfgR, laneR, refundR] = reads.data ?? []
  const refund = refundR?.result as bigint | undefined
  if (subR?.status === 'failure' && !isInvalidSubscription(subR.error)) {
    return (
      <>
        <PageHead title="Couldn’t read this subscription">
          The network didn’t answer: {(subR.error as { shortMessage?: string }).shortMessage ?? 'RPC error'}. This page retries
          automatically.
        </PageHead>
      </>
    )
  }
  if (subR?.status === 'failure') {
    return (
      <>
        <PageHead title="Subscription not found">
          It doesn’t exist on {chain?.name}, or it was cancelled.
        </PageHead>
        {refund ? <RefundPanel amount={refund} /> : null}
        <Link href="/subscriptions" className="inline-flex min-h-10 items-center text-sm font-medium text-accent hover:underline">← Back to your subscriptions</Link>
      </>
    )
  }
  const sub = subR?.result as readonly [bigint, bigint, bigint, Address, readonly Address[]] | undefined
  const isOwner = !!sub && sub[3] === address
  const pending = pendingR?.result as boolean | undefined
  const cfg = cfgR?.result as readonly [number, number, boolean, number, number, number] | undefined
  const lane = laneR?.result as readonly [boolean, bigint] | undefined

  return (
    <>
      <PageHead title="Subscription">
        <span className="hex break-all text-base text-ink">{subId.toString()}</span>
      </PageHead>

      {systemSub(d, subId) === 'wrapper' && (
        <p className="alert mb-6 max-w-[70ch]">
          This is the direct-funding pool. It pays for every request made through the wrapper.
          The deploy script created it and funded it with USDC from the deployer wallet. Cancelling it would stop direct
          funding for everyone, so cancelling is turned off here. Top it up when it runs low.
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Balance" aside={pending ? <Badge tone="waiting">Requests pending</Badge> : <Badge tone="muted">No pending requests</Badge>}>
          <p className="text-3xl font-semibold tabular-nums break-all">
            {usdc(sub?.[1])} <span className="text-base font-normal text-muted">USDC</span>
          </p>
          <div className="mt-5">
            <Fields
              rows={[
                ['Owner', <Addr key="o" value={sub?.[3]} explorer={explorer} />],
                ['Fulfilled', sub ? sub[2].toString() : '…'],
                ['Pending owner', reqOwnerR?.result && reqOwnerR.result !== '0x0000000000000000000000000000000000000000' ? <Addr key="p" value={reqOwnerR.result as string} explorer={explorer} /> : 'None'],
              ]}
            />
          </div>
          <Fund subId={subId} />
        </Panel>

        <Consumers subId={subId} consumers={sub?.[4]} isOwner={isOwner} pending={!!pending} explorer={explorer} />

        <CostEstimate balance={sub?.[1]} cfg={cfg} laneMaxGas={lane?.[1]} />

        <Ownership subId={subId} isOwner={isOwner} requestedOwner={reqOwnerR?.result as Address | undefined} pending={!!pending} />
        {refund ? <RefundPanel amount={refund} /> : null}
      </div>

      <History subId={subId} />
    </>
  )
}

function Fund({ subId }: { subId: bigint }) {
  const { deployment: d } = useDeployment()
  const [amount, setAmount] = useState('1')
  const tx = useTx()
  let value: bigint | undefined
  try {
    value = parseEther(amount)
  } catch {}
  return (
    <form
      className="mt-6 flex flex-wrap items-end gap-3 border-t border-rule pt-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (value) tx.send({ address: d!.coordinator, abi: arcVRFCoordinatorAbi, functionName: 'fundSubscriptionWithNative', args: [subId], value })
      }}
    >
      <div className="w-40">
        <Input label="Add USDC" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <Button type="submit" disabled={!value || tx.status === 'signing' || tx.status === 'pending'}>Fund subscription</Button>
      <div className="w-full"><TxNote tx={tx} done="Funded." /></div>
      <p className="w-full text-sm text-muted">Anyone can fund a subscription. Uses native USDC (18 decimals), not the ERC-20 interface.</p>
    </form>
  )
}

function Consumers({ subId, consumers, isOwner, pending, explorer }: { subId: bigint; consumers?: readonly Address[]; isOwner: boolean; pending: boolean; explorer?: string }) {
  const { deployment: d } = useDeployment()
  const [next, setNext] = useState('')
  const tx = useTx()
  const call = (functionName: 'addConsumer' | 'removeConsumer', consumer: Address) =>
    tx.send({ address: d!.coordinator, abi: arcVRFCoordinatorAbi, functionName, args: [subId, consumer] })
  return (
    <Panel title="Consumers" aside={consumers ? `${consumers.length} of 100` : undefined}>
      {consumers?.length ? (
        <ul className="divide-y divide-rule">
          {consumers.map((c) => (
            <li key={c} className="flex items-center justify-between gap-3 py-2">
              <Addr value={c} explorer={explorer} />
              {isOwner && (
                <Button variant="quiet" disabled={pending || tx.status === 'pending'} onClick={() => call('removeConsumer', c)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">No consumers yet. Add the contract that calls <code className="hex">requestRandomWords</code>.</p>
      )}
      {isOwner && (
        <form
          className="mt-5 flex flex-wrap items-end gap-3 border-t border-rule pt-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (isAddress(next)) call('addConsumer', next).then((r) => r && setNext(''))
          }}
        >
          <div className="min-w-0 flex-1 basis-64">
            <Input label="Consumer contract" placeholder="0x…" value={next} onChange={(e) => setNext(e.target.value.trim())} />
          </div>
          <Button type="submit" disabled={!isAddress(next)}>Add consumer</Button>
        </form>
      )}
      {pending && isOwner && <p className="mt-2 text-sm text-muted">Consumers can’t be removed while requests are pending.</p>}
      <TxNote tx={tx} />
    </Panel>
  )
}

function CostEstimate({ balance, cfg, laneMaxGas }: { balance?: bigint; cfg?: readonly [number, number, boolean, number, number, number]; laneMaxGas?: bigint }) {
  const [gas, setGas] = useState('200000')
  const cb = /^\d+$/.test(gas) ? BigInt(gas) : undefined
  const max = cfg && laneMaxGas && cb !== undefined ? subscriptionMaxCost(laneMaxGas, cb, cfg[5], cfg[4]) : undefined
  return (
    <Panel title="How far the balance goes">
      <div className="w-48">
        <Input label="Callback gas limit" inputMode="numeric" value={gas} onChange={(e) => setGas(e.target.value)} />
      </div>
      <div className="mt-5">
        <Fields
          rows={[
            ['Worst case per request', max !== undefined ? `${usdc(max)} USDC` : '…'],
            ['Requests covered', max && balance !== undefined ? `at least ${(balance / max).toString()}` : '…'],
          ]}
        />
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Worst case = lane max gas price × (200,000 + callback gas) × (100 + premium)%. You’re charged for gas actually
        used, at Arc’s base fee, so real charges are usually much lower.
      </p>
    </Panel>
  )
}

function Ownership({ subId, isOwner, requestedOwner, pending }: { subId: bigint; isOwner: boolean; requestedOwner?: Address; pending: boolean }) {
  const { deployment: d } = useDeployment()
  const { address } = useAccount()
  const router = useRouter()
  const [to, setTo] = useState('')
  const [refundTo, setRefundTo] = useState('')
  const tx = useTx()
  const coord = { address: d!.coordinator, abi: arcVRFCoordinatorAbi }
  if (requestedOwner === address && !isOwner) {
    return (
      <Panel title="Ownership">
        <p>You’ve been offered ownership of this subscription.</p>
        <div className="mt-4"><Button onClick={() => tx.send({ ...coord, functionName: 'acceptSubscriptionOwnerTransfer', args: [subId] })}>Accept ownership</Button></div>
        <TxNote tx={tx} done="You now own this subscription." />
      </Panel>
    )
  }
  if (!isOwner) return null
  const refundAddr = (refundTo || address) as Address
  return (
    <Panel title="Ownership">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (isAddress(to)) tx.send({ ...coord, functionName: 'requestSubscriptionOwnerTransfer', args: [subId, to] })
        }}
      >
        <div className="min-w-0 flex-1 basis-64">
          <Input label="Transfer to" placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value.trim())} hint="The new owner must accept." />
        </div>
        <Button type="submit" variant="quiet" disabled={!isAddress(to)}>Offer ownership</Button>
      </form>
      {systemSub(d, subId) === 'wrapper' ? (
        <p className="mt-6 border-t border-rule pt-5 text-sm text-muted">
          Cancelling is turned off for the direct-funding pool: it would stop every direct-funding request.
        </p>
      ) : (
      <form
        className="mt-6 flex flex-wrap items-end gap-3 border-t border-rule pt-5"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!isAddress(refundAddr)) return
          if (!window.confirm('Cancel this subscription? Its consumers lose access and the balance is refunded. This cannot be undone.')) return
          const r = await tx.send({ ...coord, functionName: 'cancelSubscription', args: [subId, refundAddr] })
          if (r) router.push('/subscriptions')
        }}
      >
        <div className="min-w-0 flex-1 basis-64">
          <Input label="Refund to" placeholder={address} value={refundTo} onChange={(e) => setRefundTo(e.target.value.trim())} />
        </div>
        <Button type="submit" variant="danger" disabled={pending}>Cancel subscription</Button>
        {pending && <p className="w-full text-sm text-muted">Wait for pending requests to be fulfilled before cancelling.</p>}
      </form>
      )}
      <TxNote tx={tx} />
    </Panel>
  )
}

function RefundPanel({ amount }: { amount: bigint }) {
  const { deployment: d } = useDeployment()
  const { address } = useAccount()
  const tx = useTx()
  return (
    <Panel title="Refund waiting">
      <p>A cancellation refund of {usdc(amount)} USDC couldn’t be sent to your address automatically, so it’s held for you.</p>
      <div className="mt-4">
        <Button onClick={() => tx.send({ address: d!.coordinator, abi: arcVRFCoordinatorAbi, functionName: 'withdrawRefund', args: [address] })}>Withdraw to my address</Button>
      </div>
      <TxNote tx={tx} done="Refund withdrawn." />
    </Panel>
  )
}

function History({ subId }: { subId: bigint }) {
  const { deployment: d } = useDeployment()
  const requested = useLogs(['req', subId.toString()], { address: d!.coordinator, event: ev.requested, args: { subId }, fromBlock: d!.deployBlock })
  const fulfilled = useLogs(['ful', subId.toString()], { address: d!.coordinator, event: ev.fulfilled, args: { subId }, fromBlock: d!.deployBlock })
  const byId = new Map((fulfilled.data ?? []).map((l) => [l.args.requestId, l]))
  const rows = [...(requested.data ?? [])].reverse().slice(0, 50)
  return (
    <section className="mt-10 rounded-xl border border-rule bg-panel p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] sm:p-6">
      <h2 className="mb-4 text-base font-semibold">Requests</h2>
      {rows.length > 0 && fulfilled.isError && (
        <p className="alert mb-4" role="alert">Couldn’t read fulfilments from the Arc RPC, so some answers may show as missing. Retrying…</p>
      )}
      {rows.length === 0 ? (
        <p className={requested.isError ? 'alert' : 'text-muted'} role={requested.isError ? 'alert' : undefined}>
          {requested.isError ? 'Couldn’t reach the Arc RPC. Retrying…' : requested.isLoading ? 'Reading requests…' : 'No requests yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className={`${table.table} min-w-[40rem]`}>
            <thead>
              <tr>
                <th className={table.th}>Request</th>
                <th className={table.th}>Consumer</th>
                <th className={table.th}>Words</th>
                <th className={table.th}>Charged</th>
                <th className={table.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const f = byId.get(r.args.requestId)
                return (
                  <tr key={r.transactionHash + r.logIndex} className={table.row}>
                    <td className={table.td}>
                      <Link href={`/requests/${r.args.requestId}`} className="hex text-accent underline-offset-4 hover:underline">{short(r.args.requestId, 8, 6)}</Link>
                    </td>
                    <td className={`${table.td} hex`}>{short(r.args.sender)}</td>
                    <td className={table.td}>{r.args.numWords}</td>
                    <td className={table.td}>{f ? `${usdc(f.args.payment)} USDC` : '—'}</td>
                    <td className={table.td}>
                      {!f ? <Badge tone="waiting">Waiting for proof</Badge> : f.args.success ? <Badge tone="verified">Delivered</Badge> : <Badge tone="fault">Callback reverted</Badge>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** True only when the coordinator itself said the subscription doesn't exist (not an RPC failure). */
function isInvalidSubscription(e: unknown): boolean {
  const reverted =
    e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : undefined
  return reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName === 'InvalidSubscription'
}
