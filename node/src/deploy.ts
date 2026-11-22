// Deploys the full Arc VRF stack and writes contracts/deployments/<chainId>.json.
// Done in TypeScript rather than a forge script because subscription IDs depend on the
// previous block hash, so IDs from a forge simulation don't match what lands on-chain.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import {
  arcVRFCoordinatorAbi,
  arcVRFWrapperAbi,
  type Deployment,
} from '@arc-vrf/sdk'
import { parseEventLogs, type Abi, type Account, type Address, type Hex } from 'viem'
import { arcFees, connect, log } from './chain.js'
import { keyHashOf } from './proof.js'

const contractsDir = new URL('../../contracts/', import.meta.url).pathname

function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const a = JSON.parse(readFileSync(`${contractsDir}out/${name}.sol/${name}.json`, 'utf8'))
  return { abi: a.abi, bytecode: a.bytecode.object }
}

export type DeployOptions = {
  rpcUrl: string
  deployer: Account
  provingKey: readonly [bigint, bigint]
  maxGasPriceGwei?: number // gas lane cap for fulfilments
  premiumPercentage?: number // subscription premium
  flatFeeNativePPM?: number
  wrapperPremiumPercentage?: number
  wrapperFunding?: bigint // USDC wei funded into the wrapper's subscription
  exampleFunding?: bigint // USDC wei funded into the HiLoGame subscription
}

export async function deploy(o: DeployOptions): Promise<Deployment & { chainId: number }> {
  const { chain, publicClient, walletClient } = await connect(o.rpcUrl, o.deployer)
  const fees = await arcFees(publicClient)
  log(`deploying to ${chain.name} (${chain.id}) from ${o.deployer.address}`)

  const send = async (hash: Hex) => {
    const r = await publicClient.waitForTransactionReceipt({ hash })
    if (r.status !== 'success') throw new Error(`tx ${hash} reverted`)
    return r
  }
  const deployContract = async (name: string, args: unknown[] = []): Promise<Address> => {
    const { abi, bytecode } = artifact(name)
    const hash = await walletClient.deployContract({ abi, bytecode, args, chain, account: o.deployer, ...fees })
    const r = await send(hash)
    log(`  ${name} ${r.contractAddress}`)
    return r.contractAddress!
  }
  const write = async (address: Address, abi: Abi, functionName: string, args: unknown[] = [], value?: bigint) =>
    send(await walletClient.writeContract({ address, abi, functionName, args, value, chain, account: o.deployer, ...fees }))
  const createSub = async (coordinator: Address) => {
    const r = await write(coordinator, arcVRFCoordinatorAbi, 'createSubscription')
    const [ev] = parseEventLogs({ abi: arcVRFCoordinatorAbi, logs: r.logs, eventName: 'SubscriptionCreated' })
    return ev!.args.subId
  }

  const deployBlock = Number(await publicClient.getBlockNumber())
  const blockhashStore = await deployContract('BlockhashStore')
  const coordinator = await deployContract('ArcVRFCoordinator', [blockhashStore])
  // minConfirmations 0 (Arc finalises on inclusion), maxGasLimit 2.5M, gasAfterPaymentCalculation per Chainlink.
  await write(coordinator, arcVRFCoordinatorAbi, 'setConfig', [0, 2_500_000, 33_285, o.flatFeeNativePPM ?? 0, o.premiumPercentage ?? 50])
  await write(coordinator, arcVRFCoordinatorAbi, 'registerProvingKey', [
    o.provingKey,
    BigInt(o.maxGasPriceGwei ?? 500) * 10n ** 9n,
  ])
  const keyHash = keyHashOf(o.provingKey)
  const batchCoordinator = await deployContract('BatchArcVRFCoordinator', [coordinator])

  // Direct funding: the wrapper owns a subscription, funded and managed by the operator.
  const wrapperSubId = await createSub(coordinator)
  await write(coordinator, arcVRFCoordinatorAbi, 'fundSubscriptionWithNative', [wrapperSubId], o.wrapperFunding ?? 10n ** 18n)
  const wrapper = await deployContract('ArcVRFWrapper', [coordinator, wrapperSubId])
  await write(coordinator, arcVRFCoordinatorAbi, 'addConsumer', [wrapperSubId, wrapper])
  // Starting overheads from Chainlink's Base Sepolia wrapper; re-measure on Arc (milestone M2).
  await write(wrapper, arcVRFWrapperAbi, 'setConfig', [13_400, 128_500, 435, o.wrapperPremiumPercentage ?? 60, keyHash, 10, o.flatFeeNativePPM ?? 0])

  // Samples: HiLoGame (subscription) and DiceDirect (direct funding).
  const hiLoSubId = await createSub(coordinator)
  await write(coordinator, arcVRFCoordinatorAbi, 'fundSubscriptionWithNative', [hiLoSubId], o.exampleFunding ?? 5n * 10n ** 17n)
  const hiLoGame = await deployContract('HiLoGame', [coordinator, keyHash, hiLoSubId])
  await write(coordinator, arcVRFCoordinatorAbi, 'addConsumer', [hiLoSubId, hiLoGame])
  const diceDirect = await deployContract('DiceDirect', [wrapper])

  const d = {
    chainId: chain.id,
    blockhashStore,
    coordinator,
    batchCoordinator,
    wrapper,
    wrapperSubId: wrapperSubId.toString(),
    keyHash,
    hiLoGame,
    hiLoSubId: hiLoSubId.toString(),
    diceDirect,
    deployBlock,
  }
  mkdirSync(`${contractsDir}deployments`, { recursive: true })
  writeFileSync(`${contractsDir}deployments/${chain.id}.json`, JSON.stringify(d, null, 2) + '\n')
  log(`wrote contracts/deployments/${chain.id}.json`)
  return d
}
