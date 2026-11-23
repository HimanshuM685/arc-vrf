'use client'
import { arcVRFCoordinatorAbi, arcVRFWrapperAbi, wrapperPrice, ARC_MIN_MAX_FEE_PER_GAS } from '@arc-vrf/sdk'
import Link from 'next/link'
import { useState } from 'react'
import { parseGwei, type Address } from 'viem'
import { useAccount, useBalance, useChains, useGasPrice, useReadContract, useReadContracts } from 'wagmi'
import { Addr, Badge, Button, Fields, Input, NotDeployed, PageHead, Panel, TxNote, buttonClass } from '@/components/ui'
import { ev } from '@/lib/events'
import { gwei, short, usdc } from '@/lib/format'
import { useDeployment, useLogs, useTx } from '@/lib/hooks'

type WrapperCfg = readonly [number, number, number, number, number, `0x${string}`, number]

export default function DirectFundingPage() {
  const { chainId, deployment: d } = useDeployment()
  const chain = useChains().find((c) => c.id === chainId)
  return (
    <>
      <PageHead title="Direct funding">
        Your contract pays the wrapper in USDC with each request. The price is fixed when you request, at that
        transaction’s gas price. No subscription to manage.
      </PageHead>
      {!d ? <NotDeployed chainName={chain?.name} /> : <Wrapper explorer={chain?.blockExplorers?.default.url} />}
    </>
  )
}

function Wrapper({ explorer }: { explorer?: string }) {
  const { deployment: d } = useDeployment()
  const w = { address: d!.wrapper, abi: arcVRFWrapperAbi } as const
  const reads = useReadContracts({
    contracts: [
      { ...w, functionName: 'getConfig' },
      { ...w, functionName: 'owner' },
      { ...w, functionName: 's_disabled' },
      { address: d!.coordinator, abi: arcVRFCoordinatorAbi, functionName: 'getSubscription', args: [BigInt(d!.wrapperSubId)] },
    ],
    query: { refetchInterval: 6000 },
  })
  const fees = useBalance({ address: d!.wrapper, query: { refetchInterval: 6000 } })
  const [cfgR, ownerR, disabledR, subR] = reads.data ?? []
  const cfg = cfgR?.result as WrapperCfg | undefined
  const sub = subR?.result as readonly [bigint, bigint, bigint, Address, readonly Address[]] | undefined

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <Calculator cfg={cfg} />
        <Panel title="Wrapper" aside={disabledR?.status !== 'success' ? <Badge tone="muted">Reading…</Badge> : disabledR.result ? <Badge tone="fault">Disabled</Badge> : <Badge tone="verified">Accepting requests</Badge>}>
          <Fields
            rows={[
              ['Address', <Addr key="a" value={d!.wrapper} explorer={explorer} />],
              ['Max words', cfg ? String(cfg[6]) : '…'],
              ['Premium', cfg ? `${cfg[4]}%` : '…'],
              ['Flat fee', cfg ? `${usdc(BigInt(cfg[0]) * 10n ** 12n)} USDC` : '…'],
              ['Wrapper overhead', cfg ? `${cfg[1].toLocaleString('en')} gas` : '…'],
              ['Coordinator overhead', cfg ? `${cfg[2].toLocaleString('en')} gas + ${cfg[3]} per word` : '…'],
              ['Gas lane', cfg ? <span key="k" className="hex">{short(cfg[5], 10, 8)}</span> : '…'],
            ]}
          />
          <div className="mt-6 border-t border-rule pt-5">
            <Fields
              rows={[
                ['Subscription balance', sub ? `${usdc(sub[1])} USDC` : '…'],
                ['Fees collected', `${usdc(fees.data?.value)} USDC`],
              ]}
            />
            {sub && sub[1] < 10n ** 17n && (
              <p className="alert mt-4 text-sm">The wrapper’s subscription is running low. The operator should top it up.</p>
            )}
          </div>
          <OperatorControls owner={ownerR?.result as Address | undefined} />
        </Panel>
      </div>
      <RecentWrapperRequests />
    </div>
  )
}

function Calculator({ cfg }: { cfg?: WrapperCfg }) {
  const { deployment: d } = useDeployment()
  const live = useGasPrice({ query: { refetchInterval: 10000 } })
  const [gas, setGas] = useState('100000')
  const [words, setWords] = useState('1')
  const [price, setPrice] = useState('')
  const liveGwei = live.data ? gwei(live.data > ARC_MIN_MAX_FEE_PER_GAS ? live.data : ARC_MIN_MAX_FEE_PER_GAS) : '20'
  const gasPriceStr = price || liveGwei
  let gp: bigint | undefined
  try {
    gp = parseGwei(gasPriceStr)
  } catch {}
  const cb = /^\d+$/.test(gas) ? Number(gas) : undefined
  const n = /^\d+$/.test(words) ? Number(words) : undefined
  const tooMany = !!cfg && n !== undefined && n > cfg[6]
  const onchain = useReadContract({
    address: d!.wrapper,
    abi: arcVRFWrapperAbi,
    functionName: 'estimateRequestPriceNative',
    args: [cb ?? 0, n ?? 0, gp ?? 0n],
    query: { enabled: cb !== undefined && n !== undefined && gp !== undefined },
  })
  const parts =
    cfg && cb !== undefined && n !== undefined && gp !== undefined
      ? {
          wrapper: gp * BigInt(cfg[1]),
          coordinator: gp * (BigInt(cb) + BigInt(cfg[2]) + BigInt(n) * BigInt(cfg[3])),
          total: wrapperPrice(
            { wrapperGasOverhead: cfg[1], coordinatorGasOverheadNative: cfg[2], coordinatorGasOverheadPerWord: cfg[3], premiumPercentage: cfg[4], flatFeeNativePPM: cfg[0] },
            BigInt(cb),
            BigInt(n),
            gp,
          ),
        }
      : undefined

  return (
    <Panel title="Fee calculator">
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Callback gas limit" inputMode="numeric" value={gas} onChange={(e) => setGas(e.target.value)} />
        <Input label="Random words" inputMode="numeric" value={words} onChange={(e) => setWords(e.target.value)} />
        <Input label="Gas price (gwei)" inputMode="decimal" value={gasPriceStr} onChange={(e) => setPrice(e.target.value)} hint={price ? undefined : 'Live, floored at 20'} />
      </div>
      <div className="mt-10 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <p className="font-display text-5xl font-bold tracking-tighter lining-nums tabular-nums break-all sm:text-6xl">{onchain.data !== undefined ? usdc(onchain.data, 8) : parts ? usdc(parts.total, 8) : '…'}</p>
        <span className="label text-muted">USDC per request</span>
      </div>
      {tooMany && <p className="alert mt-3 text-sm" role="alert">The wrapper accepts at most {cfg![6]} words per request.</p>}
      {parts && (
        <div className="mt-5">
          <Fields
            rows={[
              ['Wrapper gas', `${usdc(parts.wrapper, 8)} USDC`],
              ['Callback + coordinator gas', `${usdc(parts.coordinator, 8)} USDC`],
              ['Premium and flat fee', `${usdc(parts.total - parts.wrapper - parts.coordinator, 8)} USDC`],
            ]}
          />
        </div>
      )}
      <p className="mt-5 text-sm leading-relaxed text-muted">
        From the wrapper’s own <code className="hex">estimateRequestPriceNative</code>. In your contract,{' '}
        <code className="hex">requestRandomnessPayInNative</code> quotes and pays in one call.
      </p>
    </Panel>
  )
}

function OperatorControls({ owner }: { owner?: Address }) {
  const { address } = useAccount()
  const { deployment: d } = useDeployment()
  const tx = useTx()
  if (!owner || owner !== address) return null
  return (
    <div className="mt-6 border-t border-rule pt-5">
      <p className="text-sm text-muted">You operate this wrapper.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button variant="quiet" onClick={() => tx.send({ address: d!.wrapper, abi: arcVRFWrapperAbi, functionName: 'withdrawNative', args: [address] })}>
          Withdraw fees
        </Button>
        <Link href={`/subscriptions/${d!.wrapperSubId}`} className={buttonClass('quiet')}>
          Top up its subscription
        </Link>
      </div>
      <TxNote tx={tx} done="Fees withdrawn." />
    </div>
  )
}

function RecentWrapperRequests() {
  const { deployment: d } = useDeployment()
  const made = useLogs(['wreq'], { address: d!.wrapper, event: ev.wrapperRequest, fromBlock: d!.deployBlock })
  const failed = useLogs(['wfail'], { address: d!.wrapper, event: ev.wrapperFailed, fromBlock: d!.deployBlock })
  const fulfilled = useLogs(['ful', d!.wrapperSubId], { address: d!.coordinator, event: ev.fulfilled, args: { subId: BigInt(d!.wrapperSubId) }, fromBlock: d!.deployBlock })
  const done = new Set((fulfilled.data ?? []).map((l) => l.args.requestId))
  const bad = new Set((failed.data ?? []).map((l) => l.args.requestId))
  const rows = [...(made.data ?? [])].reverse().slice(0, 25)
  return (
    <Panel title="Recent direct-funding requests">
      {rows.length === 0 ? (
        <p className="text-muted">{made.isLoading ? 'Reading requests…' : 'No direct-funding requests yet.'}</p>
      ) : (
        <ul className="divide-y divide-rule">
          {rows.map((l) => (
            <li key={l.transactionHash + l.logIndex} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
              <Link href={`/requests/${l.args.requestId}`} className="hex underline-offset-4 hover:underline">{short(l.args.requestId, 8, 6)}</Link>
              <span className="flex flex-wrap items-center gap-x-4 text-sm">
                <span className="hex text-muted">{short(l.args.consumer)}</span>
                <span>paid {usdc(l.args.paid)} USDC</span>
                {bad.has(l.args.requestId) ? (
                  <Badge tone="fault">Callback reverted</Badge>
                ) : done.has(l.args.requestId) ? (
                  <Badge tone="verified">Delivered</Badge>
                ) : (
                  <Badge tone="waiting">Waiting for proof</Badge>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
