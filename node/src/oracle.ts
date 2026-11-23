// Arc VRF node: watches RandomWordsRequested for its key, proves, and fulfils.
// Stateless idempotency: a request is pending iff s_requestCommitments(requestId) != 0,
// so restarts (with a backfill START_BLOCK) never double-fulfil.
import { arcVRFCoordinatorAbi } from '@arc-vrf/sdk'
import { formatUnits, type Account, type Address, type Hex } from 'viem'
import { alert, resetAlert } from './alert.ts'
import { arcFees, connect, log } from './chain.ts'
import { finalSeed, generateProof, keyHashOf, publicKey } from './proof.ts'

export type OracleOptions = {
  rpcUrl: string
  chainId?: number // skips the chain-id probe when the caller already has it
  coordinator: Address
  provingKey: bigint // VRF secret key: proves only, never signs transactions
  txAccount: Account // pays gas for fulfilments
  startBlock?: bigint
  pollMs?: number
  maxBlockRange?: bigint
  minBalanceWei?: bigint
  signal?: AbortSignal
  status?: NodeStatus // updated in place every poll, for health checks
}

/** Live node state for /api/health. Contains no secrets. */
export type NodeStatus = {
  lastPollAt?: number
  head?: bigint
  pending: number
  lastFulfilAt?: number
  balanceWei?: bigint
  lastError?: string
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
  nextTryAt: number // ms timestamp; failed requests back off instead of being dropped
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// A request is only ever dropped once its on-chain commitment is gone (fulfilled). Until then,
// failures (RPC outage, underfunded subscription, gas above the lane cap) retry with backoff.
const OUTAGE_MS = 60_000
const backoffMs = (attempts: number) => Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6))

export async function runOracle(o: OracleOptions) {
  const { chain, publicClient, walletClient } = await connect(o.rpcUrl, o.txAccount, o.chainId)
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

  const status = o.status
  let lastOkPoll = Date.now()
  let outage = false
  // Watchdog on its own timer: catches RPC calls that hang (no error ever reaches the loop)
  // as well as ones that fail. Alert cooldown dedups; failed deliveries are retried next tick.
  const watchdog = setInterval(() => {
    const quietMs = Date.now() - lastOkPoll
    if (quietMs <= OUTAGE_MS) return
    if (!outage) resetAlert('rpc-recovered')
    outage = true
    void alert('rpc-outage', `no successful poll for ${Math.round(quietMs / 1000)}s, requests are not being answered${status?.lastError ? `: ${status.lastError}` : ''}`)
  }, 10_000)
  watchdog.unref()
  o.signal?.addEventListener('abort', () => clearInterval(watchdog))

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
            nextTryAt: 0,
          })
          log(`request ${short(a.requestId!)} from ${a.sender} (sub ${short(a.subId!)}, ${a.numWords} words)`)
        }
        from = to + 1n
      }

      // Stamp the poll before fulfilments: a slow fulfil batch must not look like an outage.
      lastOkPoll = Date.now()
      if (status) {
        status.lastPollAt = lastOkPoll
        status.head = head
        status.lastError = undefined
      }
      if (outage) {
        outage = false
        resetAlert('rpc-outage')
        void alert('rpc-recovered', `polling recovered at block ${head}`)
      }

      for (const r of [...pending.values()]) {
        if (head < r.blockNumber + BigInt(r.confirmations) || Date.now() < r.nextTryAt) continue
        await fulfil(r).catch((e) => {
          r.attempts++
          r.nextTryAt = Date.now() + backoffMs(r.attempts)
          const msg = (e as Error).message.split('\n')[0]
          log(`fulfil ${short(r.requestId)} failed (attempt ${r.attempts}, retrying in ${backoffMs(r.attempts) / 1000}s): ${msg}`)
          if (r.attempts === 5) void alert(`request-${r.requestId}`, `request ${r.requestId} still failing after 5 attempts (still retrying): ${msg}`)
        })
      }
      if (status) status.pending = pending.size

      // Balance is advisory: a failed read is logged, never counted as a failed poll.
      if (ticks++ % 120 === 0) {
        try {
          const bal = await publicClient.getBalance({ address: o.txAccount.address })
          if (status) status.balanceWei = bal
          if (o.minBalanceWei && bal < o.minBalanceWei) {
            const msg = `gas balance ${formatUnits(bal, 18)} USDC is below ${formatUnits(o.minBalanceWei, 18)} USDC. Top up ${o.txAccount.address}`
            log(`WARNING: ${msg}`)
            void alert('low-balance', msg)
          }
        } catch (e) {
          log(`balance check failed: ${(e as Error).message.split('\n')[0]}`)
        }
      }
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0]
      if (status) status.lastError = msg
      log(`poll error: ${msg}`)
    }
    await sleep(pollMs)
  }
  clearInterval(watchdog)

  async function fulfil(r: Pending) {
    const commitment = await publicClient.readContract({
      address: o.coordinator,
      abi: arcVRFCoordinatorAbi,
      functionName: 's_requestCommitments',
      args: [r.requestId],
    })
    if (BigInt(commitment) === 0n) {
      forget(r.requestId) // already fulfilled (or never existed)
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
    forget(r.requestId)
    if (status) status.lastFulfilAt = Date.now()
    log(`fulfilled ${short(r.requestId)} in block ${receipt.blockNumber} (gas ${receipt.gasUsed}) tx ${hash}`)
  }

  // Done with a request: drop it and its per-request alert cooldown, so alert state doesn't grow forever.
  function forget(id: bigint) {
    pending.delete(id)
    resetAlert(`request-${id}`)
  }
}

const short = (n: bigint) => {
  const h = n.toString(16)
  return h.length > 12 ? `0x${h.slice(0, 6)}…${h.slice(-4)}` : `0x${h}`
}
