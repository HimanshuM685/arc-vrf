// Arc VRF node: watches RandomWordsRequested for its key, proves, and fulfils.
// Requests arrive over a WebSocket subscription (push, ~0 cost while idle); a slow polling scan
// from the last scanned block is the safety net for anything the socket misses.
// Stateless idempotency: a request is pending iff s_requestCommitments(requestId) != 0,
// so restarts (with a backfill START_BLOCK) never double-fulfil.
import { arcVRFCoordinatorAbi } from '@arc-vrf/sdk'
import { createPublicClient, formatUnits, type Account, type Address, type Hex, type PublicClient } from 'viem'
import { alert, resetAlert } from './alert.ts'
import { arcFees, blockRangeLimit, connect, rpcTransport, defaultWsUrl, errMsg, isRateLimited, log, wsClient } from './chain.ts'
import { finalSeed, generateProof, keyHashOf, publicKey } from './proof.ts'

export type OracleOptions = {
  rpcUrl: string
  wsUrl?: string // eth_subscribe endpoint; default: the chain's WebSocket list, else rpcUrl with http(s) -> ws(s)
  chainId?: number // skips the chain-id probe when the caller already has it
  coordinator: Address
  provingKey: bigint // VRF secret key: proves only, never signs transactions
  txAccount: Account // pays gas for fulfilments
  startBlock?: bigint
  pollMs?: number // safety scan interval; WS events wake the loop immediately
  /** Full-history RPC(s) for log ranges older than `historyBlocks` below head, which the main RPCs prune. */
  archiveRpcUrl?: string
  historyBlocks?: bigint
  maxBlockRange?: bigint // eth_getLogs blocks per call (default 10,000: every listed Arc RPC but dRPC)
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

// A request is only ever dropped once its on-chain commitment is gone (fulfilled). Until then,
// failures (RPC outage, underfunded subscription, gas above the lane cap) retry with backoff.
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
  const fullRange = o.maxBlockRange ?? 10_000n
  // Shrinks when an RPC says it allows less, for RANGE_RETRY_MS only: with failover, the error seen is the
  // last RPC's (dRPC: 100 blocks), even if the others failed for an unrelated reason.
  let range = fullRange
  let rangeResetAt = 0
  const RANGE_RETRY_MS = 10 * 60_000
  // No history clamp: old ranges the first RPCs pruned ("pruned history unavailable") fail over to
  // Circle and QuickNode, which keep full history.
  let from = o.startBlock ?? (await publicClient.getBlockNumber())
  // Old ranges skip the pruned RPCs: each would answer "pruned history unavailable" before failing over.
  const archive = o.archiveRpcUrl ? createPublicClient({ chain, transport: rpcTransport(o.archiveRpcUrl) }) : undefined
  const pending = new Map<bigint, Pending>()
  const OUTAGE_MS = Math.max(60_000, 3 * pollMs)
  const BALANCE_EVERY_MS = 10 * 60_000
  let lastBalanceAt = 0

  // Fee estimate shared by fulfilments for 10 s: a burst of requests needs one eth_feeHistory, not one each.
  let fees: { at: number; v: ReturnType<typeof arcFees> } | undefined
  const cachedFees = () => {
    if (!fees || Date.now() - fees.at > 10_000) fees = { at: Date.now(), v: arcFees(publicClient) }
    const v = fees.v
    v.catch(() => fees?.v === v && (fees = undefined)) // a failed estimate is not cached
    return v
  }

  // The loop naps between scans; a WS event (or abort) cuts the nap short.
  let wake = () => {}
  const nap = (ms: number) =>
    new Promise<void>((r) => {
      const t = setTimeout(r, ms)
      wake = () => {
        clearTimeout(t)
        r()
      }
    })

  const status = o.status
  let lastOkPoll = Date.now() // last scan progress (a finished scan or one chunk of a backfill)
  let step = 'starting' // what the scan is doing, for the watchdog when a call hangs
  let outage = false
  // Watchdog on its own timer: catches RPC calls that hang (no error ever reaches the loop)
  // as well as ones that fail. Alert cooldown dedups; failed deliveries are retried next tick.
  const watchdog = setInterval(() => {
    const quietMs = Date.now() - lastOkPoll
    if (quietMs <= OUTAGE_MS) return
    if (!outage) resetAlert('rpc-recovered')
    outage = true
    // No error recorded means a call hasn't returned at all: name the step it is stuck in.
    const why = status?.lastError ?? `no progress, stuck in ${step} (an RPC call may be hanging)`
    void alert('rpc-outage', `safety scan failing for ${Math.round(quietMs / 1000)}s (requests still arrive over WebSocket while it is connected): ${why}`)
  }, 10_000)
  watchdog.unref()

  // Push: eth_subscribe to our requests. Errors are never fatal: the scan below covers any gap,
  // and the watch is re-established with backoff on the next URL in the list (viem does not
  // resubscribe after a drop), so a provider that keeps dropping the socket is rotated out.
  const wsUrls = o.wsUrl ? [o.wsUrl] : chain.rpcUrls.default.webSocket?.length ? [...chain.rpcUrls.default.webSocket] : [defaultWsUrl(o.rpcUrl)]
  let wsIdx = 0
  let ws = wsClient(wsUrls[0]!)
  const closeWs = (c: typeof ws) => c.transport.getRpcClient().then((x) => x.close(), () => {})
  let unwatch = () => {}
  let rewatch: ReturnType<typeof setTimeout> | undefined
  let wsFails = 0
  const watch = () => {
    const since = Date.now()
    unwatch = ws.watchContractEvent({
      address: o.coordinator,
      abi: arcVRFCoordinatorAbi,
      eventName: 'RandomWordsRequested',
      args: { keyHash },
      onLogs: (logs) => {
        // Not lastPollAt: health must reflect the HTTP scan, which fulfilment also depends on.
        for (const l of logs) add(l)
        wsFails = 0
        wake()
      },
      onError: (e) => {
        if (o.signal?.aborted || rewatch) return
        unwatch()
        if (Date.now() - since > 60_000) wsFails = 0 // a long-lived socket dropped: retry fast
        const ms = backoffMs(wsFails++)
        const failed = wsUrls[wsIdx]!
        wsIdx = (wsIdx + 1) % wsUrls.length
        log(`websocket ${hostOf(failed)} error, resubscribing on ${hostOf(wsUrls[wsIdx]!)} in ${ms / 1000}s (scanning every ${pollMs / 1000}s meanwhile): ${errMsg(e)}`)
        rewatch = setTimeout(() => {
          rewatch = undefined
          if (wsUrls.length > 1) {
            void closeWs(ws)
            ws = wsClient(wsUrls[wsIdx]!)
          }
          watch()
          wake() // scan once to cover the gap while the socket was down
        }, ms)
      },
    })
  }
  watch()
  o.signal?.addEventListener('abort', () => {
    clearInterval(watchdog)
    wake()
  })

  const readLogs = (fromBlock: bigint, toBlock: bigint, client: PublicClient = publicClient) =>
    client.getContractEvents({
      address: o.coordinator,
      abi: arcVRFCoordinatorAbi,
      eventName: 'RandomWordsRequested',
      args: { keyHash },
      fromBlock,
      toBlock,
    })
  let scanFails = 0

  while (!o.signal?.aborted) {
    step = 'eth_blockNumber'
    try {
      const head = await publicClient.getBlockNumber()
      const scanStart = { at: Date.now(), from }
      let lastProgressLog = Date.now()
      while (from <= head) {
        if (range < fullRange && Date.now() >= rangeResetAt) range = fullRange
        const old = archive && isOld(from + fullRange - 1n, head, o.historyBlocks)
        // Old chunks: full range from the archive RPCs, which serve it (a shrink is about the main list).
        const span = old ? fullRange : range
        const to = from + span - 1n < head ? from + span - 1n : head
        step = `eth_getLogs ${from}-${to}${old ? ' (full-history RPC)' : ''}`
        const r = old ? { logs: await readLogs(from, to, archive), to } : await readNearHead(readLogs, from, to, head)
        for (const l of r.logs) add(l)
        from = r.to + 1n
        // Each chunk read is progress: a long backfill must not look like an outage.
        lastOkPoll = Date.now()
        if (status) status.lastPollAt = lastOkPoll
        if (Date.now() - lastProgressLog >= 60_000) {
          lastProgressLog = Date.now()
          log(`backfilling: block ${from} of ${head} (${Number(((from - scanStart.from) * 100n) / (head - scanStart.from + 1n))}%)`)
        }
        if (r.to < to) break // the newest blocks wait for the next scan
      }
      if (Date.now() - scanStart.at >= 60_000) log(`backfill done: ${from - scanStart.from} blocks in ${Math.round((Date.now() - scanStart.at) / 1000)}s`)

      // Stamp the poll before fulfilments: a slow fulfil batch must not look like an outage.
      lastOkPoll = Date.now()
      scanFails = 0
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
          const msg = errMsg(e)
          log(`fulfil ${short(r.requestId)} failed (attempt ${r.attempts}, retrying in ${backoffMs(r.attempts) / 1000}s): ${msg}`)
          if (r.attempts === 5) void alert(`request-${r.requestId}`, `request ${r.requestId} still failing after 5 attempts (still retrying): ${msg}`)
        })
      }
      if (status) status.pending = pending.size

      // Balance is advisory: a failed read is logged, never counted as a failed poll.
      if (Date.now() - lastBalanceAt >= BALANCE_EVERY_MS) {
        lastBalanceAt = Date.now()
        try {
          const bal = await publicClient.getBalance({ address: o.txAccount.address })
          if (status) status.balanceWei = bal
          if (o.minBalanceWei && bal < o.minBalanceWei) {
            const msg = `gas balance ${formatUnits(bal, 18)} USDC is below ${formatUnits(o.minBalanceWei, 18)} USDC. Top up ${o.txAccount.address}`
            log(`WARNING: ${msg}`)
            void alert('low-balance', msg)
          }
        } catch (e) {
          log(`balance check failed: ${errMsg(e)}`)
        }
      }
    } catch (e) {
      const lim = blockRangeLimit(e)
      if (lim && lim > 0n && lim < range) {
        // Only shrinks until the reset, so this can't loop. Rescan at once: not a failure.
        range = lim
        rangeResetAt = Date.now() + RANGE_RETRY_MS
        log(`RPC limits eth_getLogs to ${lim} blocks; scanning in ${lim}-block ranges for ${RANGE_RETRY_MS / 60_000} minutes.`)
        continue
      }
      const msg = `${step}: ${errMsg(e)}`
      scanFails++
      if (status) status.lastError = msg
      log(`poll error: ${msg}`)
    }
    // Nap until the next scan, but come back within ~1 s for a request waiting on confirmations
    // or a retry whose backoff ends sooner. Never 0: a persistent error must not spin.
    // After a failed scan, retry in 2 s, 4 s, 8 s… so a short RPC blip clears before the watchdog fires.
    let napMs = scanFails ? Math.min(pollMs, 1_000 * 2 ** Math.min(scanFails, 6)) : pollMs
    for (const r of pending.values()) napMs = Math.min(napMs, Math.max(1_000, r.nextTryAt - Date.now()))
    if (!o.signal?.aborted) await nap(napMs)
  }
  clearInterval(watchdog)
  clearTimeout(rewatch)
  unwatch()
  await closeWs(ws)

  // From the WS push or the scan. Already-pending requests keep their retry state.
  function add(l: { args: RequestArgs; blockNumber: bigint | null; blockHash: Hex | null }) {
    const a = l.args
    if (l.blockNumber === null || l.blockHash === null || pending.has(a.requestId!)) return
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
      ...(await cachedFees()),
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

/** True when a chunk ending at `to` is older than the main RPCs keep logs (`history` blocks below head). */
export const isOld = (to: bigint, head: bigint, history: bigint | undefined) => history !== undefined && to < head - history

/** Blocks the scan steps back when the newest range is refused. */
export const SCAN_LAG = 20n

/** Reads logs for [from, to]. A load-balanced RPC can answer eth_blockNumber from one node and
 * eth_getLogs from another a few blocks behind, which refuses a range ending past its own head.
 * Then the read ends SCAN_LAG blocks below head instead; returns where it actually ended (from - 1
 * when nothing was read). */
export async function readNearHead<L>(read: (from: bigint, to: bigint) => Promise<L[]>, from: bigint, to: bigint, head: bigint): Promise<{ logs: L[]; to: bigint }> {
  try {
    return { logs: await read(from, to), to }
  } catch (e) {
    const safe = head - SCAN_LAG
    if (isRateLimited(e) || to <= safe) throw e
    // Every block in the range is that new: nothing to read yet, try again next scan.
    if (safe < from) return { logs: [], to: from - 1n }
    return { logs: await read(from, safe), to: safe }
  }
}

type RequestArgs = {
  requestId?: bigint
  preSeed?: bigint
  subId?: bigint
  minimumRequestConfirmations?: number
  callbackGasLimit?: number
  numWords?: number
  extraArgs?: Hex
  sender?: Address
}

/** RPC URLs often carry an API key in the path or query (QuickNode, dRPC, Alchemy…): log only the host. */
const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return '(invalid URL)'
  }
}

const short = (n: bigint) => {
  const h = n.toString(16)
  return h.length > 12 ? `0x${h.slice(0, 6)}…${h.slice(-4)}` : `0x${h}`
}
