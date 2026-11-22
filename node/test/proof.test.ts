import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodeAbiParameters, decodeEventLog, parseAbi, type Hex } from 'viem'
import { batchFulfillParams } from '../src/abi.js'
import { finalSeed, generateProof, keyHashOf, verifyProof } from '../src/proof.js'

const fx = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')).result

describe('Base Sepolia fixture (Chainlink-generated proof)', () => {
  const tx = fx('tx.json')
  const rcpt = fx('rcpt.json')
  const req = fx('req.json')
  const [proofs, rcs] = decodeAbiParameters(batchFulfillParams, `0x${(tx.input as string).slice(10)}` as Hex)
  const proof = proofs[0]!
  const rc = rcs[0]!

  it('commitment block matches the request receipt block', () => {
    expect(rc.blockNum).toBe(BigInt(req.blockNumber))
  })

  it('keyHash and randomness match on-chain values', () => {
    expect(keyHashOf(proof.pk)).toBe('0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71')
    const randomness = verifyProof(proof, finalSeed(proof.seed, req.blockHash))
    const ev = parseAbi([
      'event RandomWordsFulfilled(uint256 indexed requestId, uint256 outputSeed, uint256 indexed subId, uint96 payment, bool nativePayment, bool success, bool onlyPremium)',
    ])
    const log = rcpt.logs
      .map((l: { data: Hex; topics: [Hex] }) => {
        try {
          return decodeEventLog({ abi: ev, data: l.data, topics: l.topics })
        } catch {
          return undefined
        }
      })
      .find(Boolean)
    expect(log.args.outputSeed).toBe(randomness)
  })

  it('rejects a tampered seed', () => {
    expect(() => verifyProof(proof, finalSeed(proof.seed + 1n, req.blockHash))).toThrow()
  })
})

describe('generateProof', () => {
  it('round-trips through verifyProof for random seeds', () => {
    const sk = 0xc0ffeen
    for (let i = 0; i < 5; i++) {
      const preSeed = BigInt(i) * 0x1234567n + 1n
      const seed = finalSeed(preSeed, `0x${'ab'.repeat(32)}`)
      const p = generateProof(sk, seed, preSeed)
      expect(p.seed).toBe(preSeed)
      expect(() => verifyProof(p, seed)).not.toThrow()
    }
  })
})
