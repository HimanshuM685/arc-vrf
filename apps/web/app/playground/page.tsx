'use client'
import { arcVRFWrapperAbi, diceDirectAbi, hiLoGameAbi, ARC_MIN_MAX_FEE_PER_GAS } from '@arc-vrf/sdk'
import Link from 'next/link'
import { useAccount, useChains, useGasPrice, useReadContract } from 'wagmi'
import { Badge, Button, NotDeployed, PageHead, Panel, TxNote } from '@/components/ui'
import { ev } from '@/lib/events'
import { short, usdc } from '@/lib/format'
import { useDeployment, useLogs, useTx } from '@/lib/hooks'

export default function PlaygroundPage() {
  const { chainId, deployment: d } = useDeployment()
  const chain = useChains().find((c) => c.id === chainId)
  return (
    <>
      <PageHead title="Playground">
        Two sample contracts, one for each way to pay. Send a request and watch the proof come back, usually within a
        couple of blocks.
      </PageHead>
      {!d ? (
        <NotDeployed chainName={chain?.name} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <HiLo />
          <Dice />
        </div>
      )}
    </>
  )
}

function HiLo() {
  const { deployment: d } = useDeployment()
  const { address, isConnected } = useAccount()
  const tx = useTx()
  const ball = useReadContract({ address: d!.hiLoGame, abi: hiLoGameAbi, functionName: 's_currentBall', query: { refetchInterval: 2000 } })
  const requested = useLogs(['hilo-req', address], { address: d!.hiLoGame, event: ev.roundRequested, args: { player: address }, fromBlock: d!.deployBlock }, { refetchMs: 2000, enabled: !!address })
  const settled = useLogs(['hilo-set', address], { address: d!.hiLoGame, event: ev.roundSettled, args: { player: address }, fromBlock: d!.deployBlock }, { refetchMs: 2000, enabled: !!address })
  const result = new Map((settled.data ?? []).map((l) => [l.args.requestId, l.args]))
  const rounds = [...(requested.data ?? [])].reverse().slice(0, 6)
  const play = (guess: 0 | 1) => tx.send({ address: d!.hiLoGame, abi: hiLoGameAbi, functionName: 'play', args: [guess] })
  const busy = tx.status === 'signing' || tx.status === 'pending'

  return (
    <Panel title="Hi-Lo" aside="Subscription method">
      <p className="text-muted">Will the next ball (1 to 20) be higher or lower? The game’s subscription pays for the randomness; you pay only gas.</p>
      <div className="mt-6 flex items-center gap-6">
        <div className="flex size-24 shrink-0 items-center justify-center rounded-full border-2 border-ink text-4xl font-semibold tabular-nums" aria-label="Current ball">
          {ball.data ?? '…'}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => play(1)} disabled={!isConnected || busy}>Higher</Button>
          <Button onClick={() => play(0)} disabled={!isConnected || busy} variant="quiet">Lower</Button>
        </div>
      </div>
      {!isConnected && <p className="mt-3 text-sm text-muted">Connect a wallet to play.</p>}
      <TxNote tx={tx} done="Requested. The node is proving…" />
      <Rounds
        rows={rounds.map((r) => {
          const s = result.get(r.args.requestId)
          return {
            id: r.args.requestId!,
            text: `${r.args.guess === 1 ? 'Higher' : 'Lower'} than ${r.args.previousBall}`,
            outcome: s ? `${s.newBall}` : undefined,
            won: s?.won,
          }
        })}
      />
    </Panel>
  )
}

function Dice() {
  const { deployment: d } = useDeployment()
  const { address, isConnected } = useAccount()
  const tx = useTx()
  const live = useGasPrice({ query: { refetchInterval: 10000 } })
  const gp = live.data && live.data > ARC_MIN_MAX_FEE_PER_GAS ? live.data : ARC_MIN_MAX_FEE_PER_GAS
  const quote = useReadContract({ address: d!.wrapper, abi: arcVRFWrapperAbi, functionName: 'estimateRequestPriceNative', args: [100_000, 1, gp] })
  const rolled = useLogs(['dice-req', address], { address: d!.diceDirect, event: ev.diceRolled, args: { player: address }, fromBlock: d!.deployBlock }, { refetchMs: 2000, enabled: !!address })
  const landed = useLogs(['dice-land', address], { address: d!.diceDirect, event: ev.diceLanded, args: { player: address }, fromBlock: d!.deployBlock }, { refetchMs: 2000, enabled: !!address })
  const result = new Map((landed.data ?? []).map((l) => [l.args.requestId, l.args.result]))
  const rows = [...(rolled.data ?? [])].reverse().slice(0, 6)
  const busy = tx.status === 'signing' || tx.status === 'pending'
  // Send 20% headroom; DiceDirect pays the exact price at the tx's gas price and refunds the rest.
  const value = quote.data !== undefined ? (quote.data * 12n) / 10n : undefined

  return (
    <Panel title="Dice" aside="Direct funding">
      <p className="text-muted">Pay per roll. The contract quotes the wrapper, pays it, and refunds your change. No subscription involved.</p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button onClick={() => value && tx.send({ address: d!.diceDirect, abi: diceDirectAbi, functionName: 'roll', value })} disabled={!isConnected || busy || !value}>
          Roll for about {usdc(quote.data)} USDC
        </Button>
      </div>
      {!isConnected && <p className="mt-3 text-sm text-muted">Connect a wallet to roll.</p>}
      <TxNote tx={tx} done="Rolled. The node is proving…" />
      <Rounds rows={rows.map((r) => ({ id: r.args.requestId!, text: `Paid ${usdc(r.args.paid)} USDC`, outcome: result.has(r.args.requestId) ? `${result.get(r.args.requestId)}` : undefined }))} />
    </Panel>
  )
}

function Rounds({ rows }: { rows: { id: bigint; text: string; outcome?: string; won?: boolean }[] }) {
  if (!rows.length) return null
  return (
    <ul className="mt-6 divide-y divide-rule border-t border-rule">
      {rows.map((r) => (
        <li key={r.id.toString()} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-[0.95rem]">
          <Link href={`/requests/${r.id}`} className="hex text-muted hover:text-lane">{short(r.id, 6, 4)}</Link>
          <span>{r.text}</span>
          {r.outcome === undefined ? (
            <Badge tone="waiting">Proving</Badge>
          ) : (
            <span className="flex items-center gap-3">
              <span className="text-xl font-semibold tabular-nums">{r.outcome}</span>
              {r.won !== undefined && <Badge tone={r.won ? 'verified' : 'muted'}>{r.won ? 'Won' : 'Lost'}</Badge>}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
