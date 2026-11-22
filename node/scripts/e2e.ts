// Local end-to-end: anvil -> deploy -> node -> HiLoGame (subscription) + DiceDirect (direct funding).
// Usage: pnpm e2e   (needs `forge build` first; ANVIL=/path/to/anvil to override the binary)
// Leave the chain running for the dashboard with KEEP=1.
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { arcVRFCoordinatorAbi, arcVRFWrapperAbi, diceDirectAbi, hiLoGameAbi } from '@arc-vrf/sdk'
import { createPublicClient, formatUnits, http, parseEventLogs } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { arcFees, connect, log } from '../src/chain.ts'
import { deploy } from '../src/deploy.ts'
import { runOracle } from '../src/oracle.ts'
import { publicKey } from '../src/proof.ts'

const RPC = 'http://127.0.0.1:8545'
// anvil's default dev mnemonic (test-only accounts)
const MNEMONIC = 'test test test test test test test test test test test junk'
const acct = (i: number) => mnemonicToAccount(MNEMONIC, { addressIndex: i })
const VRF_SK = 0x1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1dn // test-only proving key

const anvil = spawn(process.env.ANVIL ?? `${homedir()}/.foundry/bin/anvil`, ['--block-time', '1', '--silent'], {
  stdio: 'inherit',
})
const stop = new AbortController()
const done = (code: number) => {
  stop.abort()
  if (!process.env.KEEP) anvil.kill()
  process.exit(code)
}
const timeout = setTimeout(() => {
  log('E2E TIMEOUT')
  done(1)
}, 90_000)

async function waitForRpc() {
  const c = createPublicClient({ transport: http(RPC) })
  for (let i = 0; i < 50; i++) {
    try {
      return await c.getChainId()
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  throw new Error('anvil did not start')
}

try {
  await waitForRpc()
  const deployer = acct(0)
  const d = await deploy({ rpcUrl: RPC, deployer, provingKey: publicKey(VRF_SK) })
  await import('../../packages/sdk/scripts/gen.ts')

  void runOracle({
    rpcUrl: RPC,
    coordinator: d.coordinator,
    provingKey: VRF_SK,
    txAccount: acct(1),
    startBlock: BigInt(d.deployBlock),
    signal: stop.signal,
  })

  const player = acct(2)
  const { chain, publicClient, walletClient } = await connect(RPC, player)
  const subBefore = (await publicClient.readContract({ address: d.coordinator, abi: arcVRFCoordinatorAbi, functionName: 'getSubscription', args: [BigInt(d.hiLoSubId)] }))[1]
  const wSubBefore = (await publicClient.readContract({ address: d.coordinator, abi: arcVRFCoordinatorAbi, functionName: 'getSubscription', args: [BigInt(d.wrapperSubId)] }))[1]

  // 1. Subscription method
  const fromBlock = await publicClient.getBlockNumber()
  await walletClient.writeContract({ address: d.hiLoGame, abi: hiLoGameAbi, functionName: 'play', args: [1], chain, account: player, ...(await arcFees(publicClient)) })
  // 2. Direct funding: pay ~10% over the quote; DiceDirect refunds the change
  const quote = await publicClient.readContract({ address: d.wrapper, abi: arcVRFWrapperAbi, functionName: 'estimateRequestPriceNative', args: [100_000, 1, 20_000_000_000n] })
  await walletClient.writeContract({ address: d.diceDirect, abi: diceDirectAbi, functionName: 'roll', value: (quote * 11n) / 10n, chain, account: player, ...(await arcFees(publicClient)) })
  log(`dice quote at 20 gwei: ${formatUnits(quote, 18)} USDC`)

  let settled: unknown, landed: unknown
  while (!settled || !landed) {
    await new Promise((r) => setTimeout(r, 500))
    const logs = await publicClient.getLogs({ fromBlock, address: [d.hiLoGame, d.diceDirect] })
    settled ??= parseEventLogs({ abi: hiLoGameAbi, logs, eventName: 'RoundSettled' })[0]?.args
    landed ??= parseEventLogs({ abi: diceDirectAbi, logs, eventName: 'DiceLanded' })[0]?.args
  }
  log('HiLoGame RoundSettled', settled)
  log('DiceDirect DiceLanded', landed)

  const subAfter = (await publicClient.readContract({ address: d.coordinator, abi: arcVRFCoordinatorAbi, functionName: 'getSubscription', args: [BigInt(d.hiLoSubId)] }))[1]
  const wSubAfter = (await publicClient.readContract({ address: d.coordinator, abi: arcVRFCoordinatorAbi, functionName: 'getSubscription', args: [BigInt(d.wrapperSubId)] }))[1]
  if (!(subAfter < subBefore)) throw new Error('HiLo subscription was not charged')
  if (!(wSubAfter < wSubBefore)) throw new Error('wrapper subscription was not charged')
  log(`HiLo subscription charged ${formatUnits(subBefore - subAfter, 18)} USDC`)
  log(`wrapper subscription charged ${formatUnits(wSubBefore - wSubAfter, 18)} USDC`)
  log('E2E PASS')
  clearTimeout(timeout)
  if (process.env.KEEP) {
    log(`KEEP=1: anvil + node still running at ${RPC}. Ctrl-C to stop.`)
  } else done(0)
} catch (e) {
  console.error(e)
  done(1)
}

