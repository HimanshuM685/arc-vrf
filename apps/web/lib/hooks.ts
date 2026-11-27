'use client'
import { getDeployment, isRateLimited, retryRateLimited, ARC_MIN_MAX_FEE_PER_GAS, type Deployment } from '@arc-vrf/sdk'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Abi, AbiEvent, Address, Hex, Log, PublicClient } from 'viem'
import { useAccount, useChainId, usePublicClient, useWriteContract } from 'wagmi'

export function useDeployment() {
  const chainId = useChainId()
  return { chainId, deployment: getDeployment(chainId) }
}

/** The subscription the deploy script creates and funds from the deployer wallet: the wrapper's
 * pool, which pays every direct-funding request. */
export function systemSub(d: Deployment | undefined, id: bigint | undefined): 'wrapper' | undefined {
  if (!d || id === undefined) return undefined
  if (id === BigInt(d.wrapperSubId)) return 'wrapper'
}

/** One getLogs call over [from, to]. Rate limited: wait (1s, 2s, 4s…) and retry the same range,
 * since splitting would only send more requests. Any other error (range too large): split in half. */
async function getLogsRange<E extends AbiEvent>(
  client: PublicClient,
  params: { address: Address; event: E; args?: Record<string, unknown> },
  from: bigint,
  to: bigint,
  depth = 0,
): Promise<Log[]> {
  try {
    return await retryRateLimited(() => client.getLogs({ ...params, fromBlock: from, toBlock: to } as never) as Promise<Log[]>, 6)
  } catch (e) {
    if (isRateLimited(e) || depth > 12 || to <= from) throw e
    const mid = (from + to) / 2n
    return [...(await getLogsRange(client, params, from, mid, depth + 1)), ...(await getLogsRange(client, params, mid + 1n, to, depth + 1))]
  }
}

// Arc testnet/mainnet logs are answered by the /api/rpc proxy from its in-memory index (any range, no
// Alchemy call per request), and local anvil has no range limit, so one request usually covers everything.
// getLogsRange still splits if an RPC refuses the range.
const LOG_CHUNK = 1_000_000n
// getBlockNumber and getLogs may be answered by different backend nodes behind the RPC, and one
// may be a few blocks behind. The newest blocks are re-read every poll and only cached once older
// than this, so a lagging provider can't make the cache skip their logs.
const SETTLE_BLOCKS = 64n

// Logs already read, per query: each poll only fetches blocks after `to`. Arc has instant
// finality and no reorgs, so settled logs never need re-reading. Saved after every chunk, so a
// scan that fails midway resumes where it stopped.
// ponytail: scans from deployBlock in the browser; add an indexer once ranges get long on mainnet.
const logCache = new Map<string, { to: bigint; logs: Log[] }>()

export function useLogs<E extends AbiEvent>(
  key: unknown[],
  params: { address?: Address; event: E; args?: Record<string, unknown>; fromBlock?: number },
  /** refetchMs: poll interval, false to stop, or a function of the current logs (e.g. stop once found). */
  opts: { refetchMs?: number | false | ((logs: Log<bigint, number, false, E>[] | undefined) => number | false); enabled?: boolean } = {},
) {
  const client = usePublicClient()
  const queryKey = ['logs', client?.chain.id, params.address, params.fromBlock, ...key]
  return useQuery({
    queryKey,
    enabled: !!client && !!params.address && opts.enabled !== false,
    refetchInterval:
      typeof opts.refetchMs === 'function'
        ? (q) => (opts.refetchMs as (l: Log<bigint, number, false, E>[] | undefined) => number | false)(q.state.data)
        : (opts.refetchMs ?? 10_000),
    retry: 1, // getLogsRange already retries rate limits; more layers only multiply requests
    queryFn: async () => {
      const c = client as PublicClient
      const cacheKey = JSON.stringify(queryKey, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
      const head = await c.getBlockNumber()
      const settled = head - SETTLE_BLOCKS
      let entry = logCache.get(cacheKey) ?? { to: BigInt(params.fromBlock ?? 0) - 1n, logs: [] }
      const recent: Log[] = []
      for (let from = entry.to + 1n; from <= head; ) {
        const to = from + LOG_CHUNK - 1n < head ? from + LOG_CHUNK - 1n : head
        const fresh = await getLogsRange(c, { address: params.address!, event: params.event, args: params.args }, from, to)
        if (to <= settled) entry = { to, logs: [...entry.logs, ...fresh] }
        else {
          recent.push(...fresh.filter((l) => l.blockNumber! > settled))
          if (settled > entry.to) entry = { to: settled, logs: [...entry.logs, ...fresh.filter((l) => l.blockNumber! <= settled)] }
        }
        logCache.set(cacheKey, entry)
        from = to + 1n
      }
      return [...entry.logs, ...recent] as Log<bigint, number, false, E>[]
    },
  })
}

export type TxState = { status: 'idle' | 'signing' | 'pending' | 'done' | 'error'; hash?: Hex; error?: string }

/** Sends a contract write, waits for the receipt, then refreshes all reads. Applies Arc's 20 gwei floor. */
export function useTx() {
  const client = usePublicClient()
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const qc = useQueryClient()
  const [state, setState] = useState<TxState>({ status: 'idle' })

  async function send(p: { address: Address; abi: Abi; functionName: string; args?: unknown[]; value?: bigint }) {
    if (!client || !address) return setState({ status: 'error', error: 'Connect a wallet first.' })
    let sent: Hex | undefined
    try {
      setState({ status: 'signing' })
      const fees = await client.estimateFeesPerGas()
      const hash = await writeContractAsync({
        ...p,
        maxFeePerGas: fees.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS ? fees.maxFeePerGas : ARC_MIN_MAX_FEE_PER_GAS,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      } as never)
      sent = hash
      setState({ status: 'pending', hash })
      // Safe to retry: waiting never re-sends. Without this a mined tx shows as an error.
      const r = await retryRateLimited(() => client.waitForTransactionReceipt({ hash }), 5)
      if (r.status !== 'success') throw new Error('Transaction reverted on-chain.')
      setState({ status: 'done', hash })
      await qc.invalidateQueries()
      return r
    } catch (e) {
      const err = e as { shortMessage?: string; message: string }
      setState({
        status: 'error',
        hash: sent,
        error: !isRateLimited(e)
          ? (err.shortMessage ?? err.message.split('\n')[0])
          : sent
            ? 'Sent, but the Arc RPC is rate limiting status checks. Check the transaction, or refresh in a few seconds.'
            : 'The Arc RPC is rate limiting requests right now. Nothing was sent; wait a few seconds and try again.',
      })
    }
  }
  return { ...state, send, reset: () => setState({ status: 'idle' }) }
}
