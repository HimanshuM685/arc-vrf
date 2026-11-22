import { baseSepoliaRound as r } from '@/lib/fixture'

const steps = [
  {
    who: 'Coordinator',
    name: 'Request',
    text: 'Your contract asks for randomness. The coordinator derives a pre-seed from the key hash, your address, the subscription and a counter.',
    formula: 'preSeed = keccak256(keyHash, sender, subId, nonce)',
    values: [r.preSeed],
  },
  {
    who: 'Chain',
    name: 'Block',
    text: `The request lands in block ${r.blockNumber.toLocaleString('en')}. Nobody knew this hash before the block existed.`,
    formula: 'blockhash(requestBlock)',
    values: [r.blockHash],
  },
  {
    who: 'Node',
    name: 'Seed',
    text: 'The node mixes the two. Neither the node nor the caller could choose this value.',
    formula: 'seed = keccak256(preSeed ‖ blockHash)',
    values: [r.seed],
  },
  {
    who: 'Node',
    name: 'Prove',
    text: 'Only the node’s secret key maps the seed to this curve point γ. It sends γ with a proof, never a bare number.',
    formula: 'γ = sk · hashToCurve(pk, seed)',
    values: [r.gammaX, r.gammaY],
  },
  {
    who: 'Coordinator',
    name: 'Check',
    text: 'VRF.sol verifies the proof on-chain. Any other γ fails and the transaction reverts.',
    formula: 'randomness = keccak256(3, γ)',
    values: [r.randomness],
  },
  {
    who: 'Your contract',
    name: 'Deliver',
    text: 'One proof, as many words as you asked for, each expanded on-chain.',
    formula: 'words[i] = keccak256(randomness, i)',
    values: [r.word0],
  },
]

export function Derivation() {
  return (
    <figure className="min-w-0">
      <ol className="relative">
        {steps.map((s, i) => (
          <li
            key={s.name}
            className="derive-step relative grid grid-cols-[2rem_1fr] gap-x-4 pb-6 last:pb-0"
            style={{ animationDelay: `${i * 140}ms` }}
          >
            <span
              aria-hidden="true"
              className="relative z-10 mt-0.5 flex size-8 items-center justify-center rounded-full border border-rule bg-panel font-mono text-sm text-muted"
            >
              {i + 1}
            </span>
            {i < steps.length - 1 && (
              <span aria-hidden="true" className="absolute left-4 top-9 bottom-0 w-px bg-rule" />
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="font-semibold">{s.name}</h3>
                <span className="text-sm text-muted">{s.who}</span>
              </div>
              <p className="mt-1 text-[0.95rem] leading-relaxed text-muted">{s.text}</p>
              <p className="mt-2 font-mono text-[0.8rem] text-lane">{s.formula}</p>
              {s.values.map((v) => (
                <p key={v} className="hex mt-1 rounded bg-code px-2 py-1 text-ink">
                  {v}
                </p>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <figcaption className="mt-5 pl-12 text-sm text-muted">
        Real values from a Chainlink VRF v2.5 round on Base Sepolia (
        <a className="underline underline-offset-2 hover:text-ink" href={r.requestTx} target="_blank" rel="noreferrer">request</a>,{' '}
        <a className="underline underline-offset-2 hover:text-ink" href={r.fulfilTx} target="_blank" rel="noreferrer">fulfilment</a>
        ), re-verified by this repo’s prover. Arc VRF runs the same math.
      </figcaption>
    </figure>
  )
}
