// Arc VRF node: watches RandomWordsRequested for its key, proves, and fulfils.
// Stateless idempotency: a request is pending iff s_requestCommitments(requestId) != 0,
// so restarts (with a backfill START_BLOCK) never double-fulfil.
import { arcVRFCoordinatorAbi } from '@arc-vrf/sdk'
import { formatUnits, type Account, type Address, type Hex } from 'viem'
import { arcFees, connect, log } from './chain.js'
import { finalSeed, generateProof, keyHashOf, publicKey } from './proof.js'

export type OracleOptions = {
  rpcUrl: string
  coordinator: Address
  provingKey: bigint // VRF secret key: proves only, never signs transactions
  txAccount: Account // pays gas for fulfilments
  startBlock?: bigint
  pollMs?: number
  maxBlockRange?: bigint
  minBalanceWei?: bigint
  signal?: AbortSignal
}

type Pending = {
  requestId: bigint
  preSeed: bigint
  subId: bigint
  confirmations: number
  callbackGasLimit: number
  numWords: number
  extraArgs: Hex
  sender: Address
  blockNumber: bigint
  blockHash: Hex
  attempts: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MAX_ATTEMPTS = 5

export async function runOracle(o: OracleOptions) {
  const { chain, publicClient, walletClient } = await connect(o.rpcUrl, o.txAccount)
  const keyHash = keyHashOf(publicKey(o.provingKey))
  const [exists] = await publicClient.readContract({
    address: o.coordinator,
    abi: arcVRFCoordinatorAbi,
    functionName: 's_provingKeys',
    args: [keyHash],
  })
  if (!exists) throw new Error(`keyHash ${keyHash} is not registered on ${o.coordinator}`)
  log(`node up on ${chain.name}: coordinator ${o.coordinator}, keyHash ${keyHash}, sender ${o.txAccount.address}`)

  const pollMs = o.pollMs ?? 500
  const range = o.maxBlockRange ?? 2_000n
  let from = o.startBlock ?? (await publicClient.getBlockNumber())
  const pending = new Map<bigint, Pending>()
  let ticks = 0

  while (!o.signal?.aborted) {
    try {
      const head = await publicClient.getBlockNumber()
      while (from <= head) {
        const to = from + range - 1n < head ? from + range - 1n : head
        const logs = await publicClient.getContractEvents({
          address: o.coordinator,
          abi: arcVRFCoordinatorAbi,
          eventName: 'RandomWordsRequested',
          args: { keyHash },
          fromBlock: from,
          toBlock: to,
        })
        for (const l of logs) {
          const a = l.args
          pending.set(a.requestId!, {
            requestId: a.requestId!,
            preSeed: a.preSeed!,
            subId: a.subId!,
            confirmations: a.minimumRequestConfirmations!,
            callbackGasLimit: a.callbackGasLimit!,
            numWords: a.numWords!,
            extraArgs: a.extraArgs!,
            sender: a.sender!,
            blockNumber: l.blockNumber,
            blockHash: l.blockHash,
            attempts: 0,
          })
          log(`request ${short(a.requestId!)} from ${a.sender} (sub ${short(a.subId!)}, ${a.numWords} words)`)
        }
        from = to + 1n
      }

      for (const r of [...pending.values()]) {
        if (head < r.blockNumber + BigInt(r.confirmations)) continue
        await fulfil(r).catch((e) => {
          r.attempts++
          log(`fulfil ${short(r.requestId)} failed (attempt ${r.attempts}): ${(e as Error).message.split('\n')[0]}`)
          if (r.attempts >= MAX_ATTEMPTS) pending.delete(r.requestId)
        })
      }

      if (ticks++ % 120 === 0 && o.minBalanceWei) {
        const bal = await publicClient.getBalance({ address: o.txAccount.address })
        if (bal < o.minBalanceWei) log(`WARNING: node balance ${formatUnits(bal, 18)} USDC is below the alert threshold`)
      }
    } catch (e) {
      log(`poll error: ${(e as Error).message.split('\n')[0]}`)
    }
    await sleep(pollMs)
  }

  async function fulfil(r: Pending) {
    const commitment = await publicClient.readContract({
      address: o.coordinator,
      abi: arcVRFCoordinatorAbi,
      functionName: 's_requestCommitments',
      args: [r.requestId],
    })
    if (BigInt(commitment) === 0n) {
      pending.delete(r.requestId) // already fulfilled (or never existed)
      return
    }
    // Seed = keccak256(preSeed, hash of the block the request landed in).
    const proof = generateProof(o.provingKey, finalSeed(r.preSeed, r.blockHash), r.preSeed)
    const rc = {
      blockNum: r.blockNumber,
      subId: r.subId,
      callbackGasLimit: r.callbackGasLimit,
      numWords: r.numWords,
      sender: r.sender,
      extraArgs: r.extraArgs,
    }
    const hash = await walletClient.writeContract({
      address: o.coordinator,
      abi: arcVRFCoordinatorAbi,
      functionName: 'fulfillRandomWords',
      args: [proof, rc, false],
      chain,
      account: o.txAccount,
      ...(await arcFees(publicClient)),
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`fulfil tx ${hash} reverted`)
    pending.delete(r.requestId)
    log(`fulfilled ${short(r.requestId)} in block ${receipt.blockNumber} (gas ${receipt.gasUsed}) tx ${hash}`)
  }
}

const short = (n: bigint) => {
  const h = n.toString(16)
  return h.length > 12 ? `0x${h.slice(0, 6)}…${h.slice(-4)}` : `0x${h}`
}
