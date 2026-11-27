// Creates .env at the repo root from .env.example with three fresh keys (proving, node, deployer).
// Prints only the addresses you need to fund, never the keys. Refuses to overwrite an existing .env.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'

const root = new URL('../../', import.meta.url)
const envPath = new URL('.env', root)
if (existsSync(envPath)) {
  console.error('.env already exists; not overwriting it. Move it away first if you really want new keys.')
  process.exit(1)
}

const keys = {
  VRF_PROVING_KEY: generatePrivateKey(),
  NODE_TX_KEY: generatePrivateKey(),
  DEPLOYER_KEY: generatePrivateKey(),
}
let env = readFileSync(new URL('.env.example', root), 'utf8')
for (const [k, v] of Object.entries(keys)) env = env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`)
writeFileSync(envPath, env, { mode: 0o600 })
chmodSync(envPath, 0o600)

console.log(`Wrote .env with three new keys (file is readable only by you).

Fund these with Arc USDC (testnet: https://faucet.circle.com):
  deployer  ${privateKeyToAddress(keys.DEPLOYER_KEY)}   ~2.5 USDC
  node      ${privateKeyToAddress(keys.NODE_TX_KEY)}   ~1 USDC

Do not fund the proving key.
Next: make deploy-contracts (deploys to Arc Testnet over its public RPCs)`)
