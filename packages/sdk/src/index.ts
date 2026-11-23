export * from './chains.ts'
export * from './fees.ts'
export * from './generated.ts'

import { deployments } from './generated.ts'

export type Deployment = {
  blockhashStore: `0x${string}`
  coordinator: `0x${string}`
  batchCoordinator: `0x${string}`
  wrapper: `0x${string}`
  wrapperSubId: string
  keyHash: `0x${string}`
  hiLoGame: `0x${string}`
  hiLoSubId: string
  diceDirect: `0x${string}`
  deployBlock: number
}

export function getDeployment(chainId: number): Deployment | undefined {
  return (deployments as Record<string, Deployment>)[String(chainId)]
}
export * from './rpc.ts'
