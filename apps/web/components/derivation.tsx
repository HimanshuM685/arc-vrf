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
      <ol>
        {steps.map((s, i) => (
          <li key={s.name} className="relative grid grid-cols-[2.5rem_1fr] gap-x-4 pb-8 last:pb-0">
            <span
              aria-hidden="true"
              className="relative z-10 flex size-10 items-center justify-center border-2 border-ink bg-paper font-mono text-sm font-medium"
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            {i < steps.length - 1 && <span aria-hidden="true" className="absolute top-10 bottom-0 left-5 w-0.5 -translate-x-1/2 bg-ink" />}
            <div className="min-w-0 pt-1">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="text-2xl font-bold">{s.name}</h3>
                <span className="label text-muted">{s.who}</span>
              </div>
              <p className="mt-2 leading-relaxed text-muted">{s.text}</p>
              <p className="mt-3 font-mono text-[0.8rem] font-medium">{s.formula}</p>
              {s.values.map((v) => (
                <p key={v} className="hex mt-1.5 border-l-2 border-ink bg-code px-3 py-1.5">
                  {v}
                </p>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <figcaption className="mt-8 border-t border-rule pt-4 text-sm leading-relaxed text-muted sm:pl-14">
        Real values from a Chainlink VRF v2.5 round on Base Sepolia (
        <a className="underline underline-offset-4 hover:text-ink" href={r.requestTx} target="_blank" rel="noreferrer">request</a>,{' '}
        <a className="underline underline-offset-4 hover:text-ink" href={r.fulfilTx} target="_blank" rel="noreferrer">fulfilment</a>
        ), re-verified by this repo’s prover. Arc VRF runs the same math.
      </figcaption>
    </figure>
  )
}
