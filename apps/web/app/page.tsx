import Link from 'next/link'
import { Derivation } from '@/components/derivation'
import { NetworkStatus } from '@/components/network-status'

export default function Home() {
  return (
    <>
      <section className="grid gap-12 pt-12 pb-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:pt-20">
        <div className="lg:sticky lg:top-10 lg:self-start">
          <h1 className="text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-6xl">
            Random numbers anyone can check.
          </h1>
          <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-muted">
            On Arc, <code className="font-mono text-[0.9em]">PREVRANDAO</code> always returns 0. Arc VRF gives your contracts
            random numbers that come with a proof, verified on-chain before your contract sees them. Fees are paid in
            USDC.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/subscriptions" className="rounded bg-lane px-4 py-2.5 font-medium text-lane-ink hover:brightness-110">
              Create a subscription
            </Link>
            <Link href="/docs" className="rounded border border-rule px-4 py-2.5 font-medium hover:border-ink">
              Read the quick start
            </Link>
          </div>
        </div>
        <Derivation />
      </section>

      <section className="border-t border-rule pt-12">
        <h2 className="mb-6 text-2xl font-semibold tracking-tight">Network</h2>
        <NetworkStatus />
      </section>

      <section className="border-t border-rule pt-12 mt-14">
        <h2 className="text-2xl font-semibold tracking-tight">Two ways to pay</h2>
        <p className="mt-2 max-w-[66ch] text-muted">Both use the same coordinator, proof and callback. They differ in who holds the USDC.</p>
        <div className="mt-6 grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="text-lg font-semibold">Subscription</h3>
            <p className="mt-2 text-muted leading-relaxed">
              Fund one balance, add the contracts allowed to spend it. Each fulfilment is charged for the gas it actually
              used plus a premium. Best for regular requests or several contracts.
            </p>
            <ul className="mt-3 space-y-1 text-[0.95rem]">
              <li>Inherit <code className="font-mono text-[0.85em]">ArcVRFConsumerBase</code></li>
              <li>Up to 100 consumers, 500 words per request</li>
            </ul>
            <Link href="/subscriptions" className="mt-4 inline-block text-lane underline underline-offset-2">Manage subscriptions</Link>
          </div>
          <div>
            <h3 className="text-lg font-semibold">Direct funding</h3>
            <p className="mt-2 text-muted leading-relaxed">
              Your contract pays the wrapper with each request, at a price quoted up front. Nothing to set up. Best for
              occasional requests or when end users pay.
            </p>
            <ul className="mt-3 space-y-1 text-[0.95rem]">
              <li>Inherit <code className="font-mono text-[0.85em]">ArcVRFWrapperConsumerBase</code></li>
              <li>Up to 10 words per request</li>
            </ul>
            <Link href="/direct-funding" className="mt-4 inline-block text-lane underline underline-offset-2">Open the fee calculator</Link>
          </div>
        </div>
      </section>
    </>
  )
}
