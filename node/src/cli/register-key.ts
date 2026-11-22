// Usage: VRF_PROVING_KEY=0x... tsx src/cli/register-key.ts
// Prints the uncompressed public key and keyHash to pass to ArcVRFCoordinator.registerProvingKey.
import { keyHashOf, publicKey } from '../proof.js'

const sk = process.env.VRF_PROVING_KEY
if (!sk) throw new Error('set VRF_PROVING_KEY')
const pk = publicKey(BigInt(sk))
console.log(JSON.stringify({ pk: pk.map(String), keyHash: keyHashOf(pk) }, null, 2))
