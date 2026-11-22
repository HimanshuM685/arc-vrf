import { parseAbiParameters } from 'viem'

// Solidity struct layouts shared by the node and tests.
export const proofComponents = [
  { name: 'pk', type: 'uint256[2]' },
  { name: 'gamma', type: 'uint256[2]' },
  { name: 'c', type: 'uint256' },
  { name: 's', type: 'uint256' },
  { name: 'seed', type: 'uint256' },
  { name: 'uWitness', type: 'address' },
  { name: 'cGammaWitness', type: 'uint256[2]' },
  { name: 'sHashWitness', type: 'uint256[2]' },
  { name: 'zInv', type: 'uint256' },
] as const

export const proofTuple = { type: 'tuple', components: proofComponents } as const

export const rcComponents = [
  { name: 'blockNum', type: 'uint64' },
  { name: 'subId', type: 'uint256' },
  { name: 'callbackGasLimit', type: 'uint32' },
  { name: 'numWords', type: 'uint32' },
  { name: 'sender', type: 'address' },
  { name: 'extraArgs', type: 'bytes' },
] as const

export const batchFulfillParams = parseAbiParameters([
  'Proof[] proofs, RC[] rcs',
  'struct Proof { uint256[2] pk; uint256[2] gamma; uint256 c; uint256 s; uint256 seed; address uWitness; uint256[2] cGammaWitness; uint256[2] sHashWitness; uint256 zInv; }',
  'struct RC { uint64 blockNum; uint256 subId; uint32 callbackGasLimit; uint32 numWords; address sender; bytes extraArgs; }',
])
