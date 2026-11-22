// Usage: tsx src/cli/prove.ts <secretKey> <preSeed> <requestBlockHash>
// Prints abi.encode(Proof). Used by Foundry tests via vm.ffi.
import { encodeAbiParameters, type Hex } from 'viem'
import { proofTuple } from '../abi.ts'
import { finalSeed, generateProof } from '../proof.ts'

const [sk, preSeed, blockHash] = process.argv.slice(2)
if (!sk || !preSeed || !blockHash) throw new Error('usage: prove <sk> <preSeed> <blockHash>')
const pre = BigInt(preSeed)
const proof = generateProof(BigInt(sk), finalSeed(pre, blockHash as Hex), pre)
process.stdout.write(encodeAbiParameters([proofTuple], [proof]))
