'use client'
import { getDeployment, isRateLimited, ARC_MIN_MAX_FEE_PER_GAS } from '@arc-vrf/sdk'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Abi, AbiEvent, Address, Hex, Log, PublicClient } from 'viem'
import { useAccount, useChainId, usePublicClient, useWriteContract } from 'wagmi'

export function useDeployment() {
  const chainId = useChainId()
  return { chainId, deployment: getDeployment(chainId) }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One getLogs call over [from, to]. Rate limited: wait (1s, 2s, 4s…) and retry the same range,
 * since splitting would only send more requests. Any other error (range too large): split in half. */
async function getLogsRange<E extends AbiEvent>(
  client: PublicClient,
  params: { address: Address; event: E; args?: Record<string, unknown> },
  from: bigint,
  to: bigint,
  depth = 0,
): Promise<Log[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await client.getLogs({ ...params, fromBlock: from, toBlock: to } as never)) as Log[]
    } catch (e) {
      if (isRateLimited(e) && attempt < 5) {
        await sleep(1_000 * 2 ** attempt)
        continue
      }
      if (isRateLimited(e) || depth > 10 || to <= from) throw e
      const mid = (from + to) / 2n
      return [...(await getLogsRange(client, params, from, mid, depth + 1)), ...(await getLogsRange(client, params, mid + 1n, to, depth + 1))]
    }
  }
}

// Public Arc RPCs cap getLogs ranges (Blockdaemon: 100k blocks). Scans go in chunks this size.
const LOG_CHUNK = 10_000n

// Logs already read, per query: each poll only fetches blocks after `to`. Arc has instant
// finality and no reorgs, so cached logs never need re-reading. Saved after every chunk, so a
// scan that fails midway resumes where it stopped.
// ponytail: scans from deployBlock in the browser; add an indexer once ranges get long on mainnet.
const logCache = new Map<string, { to: bigint; logs: Log[] }>()

export function useLogs<E extends AbiEvent>(
  key: unknown[],
  params: { address?: Address; event: E; args?: Record<string, unknown>; fromBlock?: number },
  opts: { refetchMs?: number; enabled?: boolean } = {},
) {
  const client = usePublicClient()
  const queryKey = ['logs', client?.chain.id, params.address, params.fromBlock, ...key]
  return useQuery({
    queryKey,
    enabled: !!client && !!params.address && opts.enabled !== false,
    refetchInterval: opts.refetchMs ?? 4000,
    queryFn: async () => {
      const c = client as PublicClient
      const cacheKey = JSON.stringify(queryKey, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
      const head = await c.getBlockNumber()
      let entry = logCache.get(cacheKey) ?? { to: BigInt(params.fromBlock ?? 0) - 1n, logs: [] }
      while (entry.to < head) {
        const from = entry.to + 1n
        const to = from + LOG_CHUNK - 1n < head ? from + LOG_CHUNK - 1n : head
        const fresh = await getLogsRange(c, { address: params.address!, event: params.event, args: params.args }, from, to)
        entry = { to, logs: [...entry.logs, ...fresh] }
        logCache.set(cacheKey, entry)
      }
      return entry.logs as Log<bigint, number, false, E>[]
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
      const r = await client.waitForTransactionReceipt({ hash })
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
