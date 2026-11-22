'use client'
import { getDeployment, ARC_MIN_MAX_FEE_PER_GAS } from '@arc-vrf/sdk'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Abi, AbiEvent, Address, Hex, Log, PublicClient } from 'viem'
import { useAccount, useChainId, usePublicClient, useWriteContract } from 'wagmi'

export function useDeployment() {
  const chainId = useChainId()
  return { chainId, deployment: getDeployment(chainId) }
}

/** getLogs over [from, latest], splitting the range when the RPC refuses a large query.
 * ponytail: fine for a young deployment; add an indexer once ranges get long on mainnet. */
export async function getLogsAdaptive<E extends AbiEvent>(
  client: PublicClient,
  params: { address: Address; event: E; args?: Record<string, unknown>; fromBlock: bigint; toBlock?: bigint },
): Promise<Log<bigint, number, false, E>[]> {
  const toBlock = params.toBlock ?? (await client.getBlockNumber())
  const run = async (from: bigint, to: bigint, depth: number): Promise<Log<bigint, number, false, E>[]> => {
    try {
      return (await client.getLogs({ ...params, fromBlock: from, toBlock: to } as never)) as never
    } catch (e) {
      if (depth > 12 || to <= from) throw e
      const mid = (from + to) / 2n
      return [...(await run(from, mid, depth + 1)), ...(await run(mid + 1n, to, depth + 1))]
    }
  }
  return run(params.fromBlock, toBlock, 0)
}

export function useLogs<E extends AbiEvent>(
  key: unknown[],
  params: { address?: Address; event: E; args?: Record<string, unknown>; fromBlock?: number },
  opts: { refetchMs?: number; enabled?: boolean } = {},
) {
  const client = usePublicClient()
  return useQuery({
    queryKey: ['logs', client?.chain.id, params.address, ...key],
    enabled: !!client && !!params.address && opts.enabled !== false,
    refetchInterval: opts.refetchMs ?? 4000,
    queryFn: () =>
      getLogsAdaptive(client as PublicClient, {
        address: params.address!,
        event: params.event,
        args: params.args,
        fromBlock: BigInt(params.fromBlock ?? 0),
      }),
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
    try {
      setState({ status: 'signing' })
      const fees = await client.estimateFeesPerGas()
      const hash = await writeContractAsync({
        ...p,
        maxFeePerGas: fees.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS ? fees.maxFeePerGas : ARC_MIN_MAX_FEE_PER_GAS,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      } as never)
      setState({ status: 'pending', hash })
      const r = await client.waitForTransactionReceipt({ hash })
      if (r.status !== 'success') throw new Error('Transaction reverted on-chain.')
      setState({ status: 'done', hash })
      await qc.invalidateQueries()
      return r
    } catch (e) {
      const err = e as { shortMessage?: string; message: string }
      setState({ status: 'error', error: err.shortMessage ?? err.message.split('\n')[0] })
    }
  }
  return { ...state, send, reset: () => setState({ status: 'idle' }) }
}
