'use client'
import { arcVRFCoordinatorAbi } from '@arc-vrf/sdk'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { concatHex, decodeFunctionData, encodePacked, keccak256, numberToHex, type Hex } from 'viem'
import { useChains, usePublicClient } from 'wagmi'
import { Addr, Badge, Fields, NotDeployed, PageHead, Panel } from '@/components/ui'
import { ev } from '@/lib/events'
import { explorerTx, hex, short, usdc } from '@/lib/format'
import { useDeployment, useLogs } from '@/lib/hooks'

const b32 = (x: bigint) => numberToHex(x, { size: 32 })

export default function RequestPage() {
  const { requestId: raw } = useParams<{ requestId: string }>()
  const { chainId, deployment: d } = useDeployment()
  const chain = useChains().find((c) => c.id === chainId)
  const explorer = chain?.blockExplorers?.default.url
  const client = usePublicClient()
  let requestId: bigint | undefined
  try {
    requestId = BigInt(raw)
  } catch {}

  // requestId isn't indexed on RandomWordsRequested, so filter client-side.
  const requested = useLogs(['req-all'], { address: d?.coordinator, event: ev.requested, fromBlock: d?.deployBlock }, { refetchMs: 6000 })
  const fulfilled = useLogs(['ful', raw], { address: d?.coordinator, event: ev.fulfilled, args: { requestId }, fromBlock: d?.deployBlock }, { refetchMs: 3000 })
  const req = requested.data?.find((l) => l.args.requestId === requestId)
  const ful = fulfilled.data?.[0]

  const fulTx = useQuery({
    queryKey: ['tx', ful?.transactionHash],
    enabled: !!ful && !!client,
    queryFn: () => client!.getTransaction({ hash: ful!.transactionHash }),
  })

  if (!d) return <NotDeployed chainName={chain?.name} />
  if (requestId === undefined) return <PageHead title="Not a request ID" />
  if (requested.isLoading) return <PageHead title="Request">Reading the chain…</PageHead>
  if (!req) return <PageHead title="Request not found">No request with this ID on {chain?.name}.</PageHead>

  const seed = BigInt(keccak256(encodePacked(['uint256', 'bytes32'], [req.args.preSeed!, req.blockHash])))
  let proof: { gamma: readonly [bigint, bigint]; c: bigint; s: bigint; pk: readonly [bigint, bigint] } | undefined
  if (fulTx.data && fulTx.data.to?.toLowerCase() === d.coordinator.toLowerCase()) {
    try {
      const dec = decodeFunctionData({ abi: arcVRFCoordinatorAbi, data: fulTx.data.input })
      if (dec.functionName === 'fulfillRandomWords') proof = dec.args[0] as typeof proof
    } catch {}
  }
  const randomness = ful?.args.outputSeed
  const words =
    randomness !== undefined
      ? Array.from({ length: req.args.numWords! }, (_, i) => BigInt(keccak256(concatHex([b32(randomness), b32(BigInt(i))]))))
      : []
  const gammaOk = proof && randomness !== undefined && BigInt(keccak256(concatHex([b32(3n), b32(proof.gamma[0]), b32(proof.gamma[1])]))) === randomness
  const txLink = (h: Hex) => explorerTx(explorer, h)

  return (
    <>
      <PageHead title="Request">
        <span className="hex break-all text-base text-ink">{requestId.toString()}</span>
      </PageHead>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Asked" aside={<span>block {req.blockNumber.toLocaleString('en')}</span>}>
          <Fields
            rows={[
              ['Consumer', <Addr key="s" value={req.args.sender} explorer={explorer} />],
              ['Subscription', <Link key="sub" href={`/subscriptions/${req.args.subId}`} className="hex text-accent underline-offset-4 hover:underline">{short(req.args.subId, 8, 6)}</Link>],
              ['Words', String(req.args.numWords)],
              ['Callback gas', req.args.callbackGasLimit!.toLocaleString('en')],
              ['Confirmations', String(req.args.minimumRequestConfirmations)],
              ['Transaction', txLink(req.transactionHash) ? <a key="t" className="hex text-accent underline-offset-4 hover:underline" href={txLink(req.transactionHash)} target="_blank" rel="noreferrer">{short(req.transactionHash)}</a> : <span key="t" className="hex">{short(req.transactionHash)}</span>],
            ]}
          />
        </Panel>
        <Panel
          title="Answered"
          aside={!ful ? <Badge tone="waiting">Waiting for proof</Badge> : ful.args.success ? <Badge tone="verified">Delivered</Badge> : <Badge tone="fault">Callback reverted, still charged</Badge>}
        >
          {ful ? (
            <Fields
              rows={[
                ['Block', `${ful.blockNumber.toLocaleString('en')} (${(ful.blockNumber - req.blockNumber).toString()} after request)`],
                ['Charged', `${usdc(ful.args.payment)} USDC`],
                ['Transaction', txLink(ful.transactionHash) ? <a key="t" className="hex text-accent underline-offset-4 hover:underline" href={txLink(ful.transactionHash)} target="_blank" rel="noreferrer">{short(ful.transactionHash)}</a> : <span key="t" className="hex">{short(ful.transactionHash)}</span>],
              ]}
            />
          ) : (
            <p className="text-muted">The node answers as soon as the request block is final (Arc: on inclusion). This page updates by itself.</p>
          )}
        </Panel>
      </div>

      <Panel title="How this number was made" className="mt-5">
        <ol className="space-y-4">
          <Step n={1} label="preSeed (from the request)" value={hex(req.args.preSeed!)} />
          <Step n={2} label={`Hash of request block ${req.blockNumber.toLocaleString('en')}`} value={req.blockHash} />
          <Step n={3} label="seed = keccak256(preSeed ‖ blockHash)" value={hex(seed)} />
          {proof && <Step n={4} label="γ, the proven curve point" value={`${hex(proof.gamma[0])}\n${hex(proof.gamma[1])}`} />}
          {randomness !== undefined && (
            <Step n={proof ? 5 : 4} label="randomness = keccak256(3, γ), checked on-chain" value={hex(randomness)} extra={gammaOk ? <Badge tone="verified">Matches γ</Badge> : undefined} />
          )}
          {words.map((w, i) => (
            <Step key={i} n={(proof ? 6 : 5) + i} label={`words[${i}] = keccak256(randomness, ${i})`} value={hex(w)} />
          ))}
        </ol>
      </Panel>
    </>
  )
}

function Step({ n, label, value, extra }: { n: number; label: string; value: string; extra?: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.75rem_1fr] gap-x-3">
      <span className="font-mono text-sm font-medium">{String(n).padStart(2, '0')}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 text-[0.95rem]">
          <span className="font-medium">{label}</span>
          {extra}
        </div>
        <p className="hex mt-1.5 whitespace-pre-line rounded-md bg-code px-3 py-2">{value}</p>
      </div>
    </li>
  )
}
