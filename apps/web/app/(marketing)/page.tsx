import Link from 'next/link'
import { Derivation } from '@/components/derivation'
import { Rule, buttonClass } from '@/components/primitives'

const facts = [
  ['0', 'confirmations', 'Arc finalises a block on inclusion, so answers usually land within a couple of blocks.'],
  ['100', 'contracts per subscription', 'Fund one balance and let every consumer you add spend it.'],
  ['500', 'words per request', 'One proof, expanded on-chain into as many random words as you ask for.'],
  ['USDC', 'fees, no LINK', 'Pay in Arc’s native gas token. Nothing else to buy or hold.'],
] as const

const ways = [
  {
    href: '/subscriptions',
    n: '01',
    title: 'Subscription',
    text: 'Fund one balance, add the contracts allowed to spend it. Each fulfilment is charged for the gas it actually used plus a premium. Best for regular requests or several contracts.',
    base: 'ArcVRFConsumerBase',
    limit: 'Up to 100 consumers, 500 words per request',
    cta: 'Manage subscriptions',
  },
  {
    href: '/direct-funding',
    n: '02',
    title: 'Direct funding',
    text: 'Your contract pays the wrapper with each request, at a price quoted up front. Nothing to set up. Best for occasional requests or when end users pay.',
    base: 'ArcVRFWrapperConsumerBase',
    limit: 'Up to 10 words per request',
    cta: 'Open the fee calculator',
  },
]

/** Full-bleed band that escapes main's padding but keeps content on the page grid. */
function Band({ className = '', children, label, id }: { className?: string; children: React.ReactNode; label: string; id?: string }) {
  return (
    <section id={id} aria-label={label} className={`relative left-1/2 -ml-[50vw] w-screen ${className}`}>
      <div className="mx-auto max-w-6xl px-4 sm:px-8 lg:px-12">{children}</div>
    </section>
  )
}

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="pt-14 pb-16 sm:pt-20 lg:pt-28 lg:pb-24">
        <p className="label text-muted">Chainlink VRF v2.5, ported to Arc</p>
        <h1 className="mt-6 text-[3.25rem] leading-[0.92] font-bold tracking-tighter sm:text-8xl lg:text-9xl">
          Random numbers <em className="font-normal">anyone</em> can check.
        </h1>
        <Rule className="mt-10 lg:mt-14" />
        <div className="mt-10 grid gap-10 xl:grid-cols-[1.3fr_1fr] xl:items-end">
          <p className="max-w-[52ch] text-xl leading-relaxed">
            On Arc, <code className="bg-code px-1 font-mono text-[0.85em]">PREVRANDAO</code> always returns 0. Arc VRF gives
            your contracts random numbers that come with a proof, verified on-chain before your contract sees them. Fees
            are paid in USDC.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap xl:justify-end">
            <Link href="/dashboard" className={buttonClass('primary')}>
              Start building <span aria-hidden="true">→</span>
            </Link>
            <Link href="/docs" className={buttonClass('quiet')}>
              Read the docs
            </Link>
          </div>
        </div>
      </section>

      {/* Facts, inverted */}
      <Band label="At a glance" className="tex-vlines bg-ink text-paper">
        <dl className="grid divide-y divide-paper/20 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
          {facts.map(([value, unit, note], i) => (
            <div
              key={unit}
              className={`py-10 sm:px-6 sm:py-14 ${i % 2 ? 'sm:border-l sm:border-paper/20' : 'sm:pl-0'} ${i > 1 ? 'sm:border-t sm:border-paper/20 lg:border-t-0' : ''} ${i === 2 ? 'lg:border-l lg:pl-6' : ''}`}
            >
              <dt className="sr-only">{unit}</dt>
              <dd>
                <span className="block font-display text-6xl leading-none font-bold tracking-tighter lg:text-7xl">{value}</span>
                <span className="label mt-4 block">{unit}</span>
                <span className="mt-3 block text-sm leading-relaxed opacity-70">{note}</span>
              </dd>
            </div>
          ))}
        </dl>
      </Band>

      {/* How it works */}
      <Band id="how" label="How one number is made" className="tex-diag scroll-mt-4">
        <div className="grid gap-12 py-20 sm:py-28 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="label text-muted">How it works</p>
            <h2 className="mt-4 text-5xl leading-none font-bold sm:text-6xl">
              How one number is <em className="font-normal">made</em>.
            </h2>
            <p className="mt-6 max-w-[44ch] text-lg leading-relaxed text-muted">
              Every random number arrives with a cryptographic proof, and the coordinator verifies that proof on-chain
              before your contract sees it. These are the six steps, with real values.
            </p>
            <Link href="/docs#how" className="label mt-6 inline-flex min-h-11 items-center underline underline-offset-4 hover:decoration-2">
              Read the full explanation →
            </Link>
          </div>
          <Derivation />
        </div>
      </Band>

      {/* Two ways to pay */}
      <section id="pricing" className="scroll-mt-4 border-t-4 border-ink py-20 sm:py-28">
        <p className="label text-muted">Pricing model</p>
        <h2 className="mt-4 text-5xl leading-none font-bold sm:text-6xl">Two ways to pay</h2>
        <p className="mt-5 max-w-[60ch] text-lg text-muted">
          Both use the same coordinator, proof and callback. They differ in who holds the USDC.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {ways.map((w) => (
            <Link
              key={w.href}
              href={w.href}
              className="group flex flex-col border-2 border-ink p-6 transition-colors duration-100 hover:bg-ink hover:text-paper sm:p-10"
            >
              <span className="label text-muted group-hover:text-paper">{w.n}</span>
              <h3 className="mt-6 text-4xl font-bold">{w.title}</h3>
              <p className="mt-4 leading-relaxed text-muted group-hover:text-paper">{w.text}</p>
              <ul className="mt-6 space-y-2 border-t border-rule pt-5 text-[0.95rem] group-hover:border-paper/30">
                <li>
                  Inherit <code className="font-mono text-[0.85em]">{w.base}</code>
                </li>
                <li>{w.limit}</li>
              </ul>
              <span className="label mt-auto inline-flex items-center gap-2 pt-8 underline-offset-4 group-hover:underline">
                {w.cta} <span aria-hidden="true">→</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Pull quote */}
      <section className="border-t-4 border-ink py-20 sm:py-28">
        <figure className="mx-auto max-w-4xl">
          <span aria-hidden="true" className="block font-display text-[8rem] leading-[0.6] sm:text-[12rem]">“</span>
          <blockquote className="font-display text-4xl leading-tight italic sm:text-6xl">
            Nobody, including the operator, can choose the result.
          </blockquote>
          <figcaption className="mt-8 flex items-center gap-4">
            <span className="h-0.5 w-12 bg-ink" aria-hidden="true" />
            <span className="label text-muted">ECVRF on secp256k1, verified by VRF.sol</span>
          </figcaption>
        </figure>
      </section>

      {/* Final call to action, inverted */}
      <Band label="Get started" className="tex-vlines bg-ink text-paper">
        <div className="flex flex-col gap-10 py-20 sm:py-28 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="max-w-[14ch] text-5xl leading-none font-bold sm:text-7xl">Add randomness to your contract.</h2>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/dashboard" className={buttonClass('inverse')}>
              Get started <span aria-hidden="true">→</span>
            </Link>
            <Link href="/docs#subscription" className="label inline-flex min-h-11 items-center justify-center border-2 border-paper px-6 py-3 font-medium transition-colors duration-100 hover:bg-paper hover:text-ink focus-visible:outline-paper">
              Quick start
            </Link>
          </div>
        </div>
      </Band>
    </>
  )
}
