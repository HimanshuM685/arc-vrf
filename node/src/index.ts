// Arc VRF node entry point. Configure with env vars (see .env.example at the repo root).
import { getDeployment } from '@arc-vrf/sdk'
import { createPublicClient, http, parseEther, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { runOracle } from './oracle.js'

const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

const rpcUrl = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const chainId = await createPublicClient({ transport: http(rpcUrl) }).getChainId()
const deployment = getDeployment(chainId)
const coordinator = (process.env.COORDINATOR ?? deployment?.coordinator) as Address | undefined
if (!coordinator) throw new Error(`no COORDINATOR set and no deployment for chain ${chainId}`)

await runOracle({
  rpcUrl,
  coordinator,
  provingKey: BigInt(env('VRF_PROVING_KEY')),
  txAccount: privateKeyToAccount(env('NODE_TX_KEY') as Hex),
  startBlock: process.env.START_BLOCK
    ? BigInt(process.env.START_BLOCK)
    : deployment
      ? BigInt(deployment.deployBlock)
      : undefined,
  pollMs: Number(process.env.POLL_MS ?? 500),
  minBalanceWei: parseEther(process.env.MIN_BALANCE_USDC ?? '1'),
})
