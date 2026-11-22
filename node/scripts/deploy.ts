// Usage: RPC_URL=... DEPLOYER_KEY=0x... VRF_PROVING_KEY=0x... pnpm --filter @arc-vrf/node deploy-contracts
// (or VRF_PUBLIC_KEY=x,y instead of VRF_PROVING_KEY, so the deployer never sees the secret key)
import { parseEther, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { deploy } from '../src/deploy.ts'
import { publicKey } from '../src/proof.ts'

const env = process.env
if (!env.DEPLOYER_KEY) throw new Error('missing env DEPLOYER_KEY')
const pk = env.VRF_PUBLIC_KEY
  ? (env.VRF_PUBLIC_KEY.split(',').map((x) => BigInt(x.trim())) as unknown as readonly [bigint, bigint])
  : env.VRF_PROVING_KEY
    ? publicKey(BigInt(env.VRF_PROVING_KEY))
    : undefined
if (!pk) throw new Error('set VRF_PUBLIC_KEY=x,y or VRF_PROVING_KEY')

await deploy({
  rpcUrl: env.RPC_URL ?? 'http://127.0.0.1:8545',
  deployer: privateKeyToAccount(env.DEPLOYER_KEY as Hex),
  provingKey: pk,
  maxGasPriceGwei: Number(env.MAX_GAS_PRICE_GWEI ?? 500),
  premiumPercentage: Number(env.PREMIUM_PCT ?? 50),
  wrapperPremiumPercentage: Number(env.WRAPPER_PREMIUM_PCT ?? 60),
  flatFeeNativePPM: Number(env.FLAT_FEE_PPM ?? 0),
  wrapperFunding: parseEther(env.WRAPPER_FUNDING_USDC ?? '1'),
  exampleFunding: parseEther(env.EXAMPLE_FUNDING_USDC ?? '0.5'),
})
await import('../../packages/sdk/scripts/gen.ts')
