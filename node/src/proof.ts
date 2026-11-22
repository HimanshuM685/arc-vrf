// VRF proof generation for ArcVRFCoordinator / VRF.sol.
// TypeScript port of Chainlink's Go implementation (chainlink-common keystore/corekeys/vrfkey
// crypto.go + proof.go, and chainlink core/services/vrf/proof/solidity_proof.go, MIT).
// Scheme: Goldberg et al. (draft-irtf-cfrg-vrf-05) on secp256k1 with Keccak, as verified by VRF.sol.
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { concatHex, encodePacked, keccak256, numberToHex, type Address, type Hex } from 'viem'

const Point = secp256k1.Point
type Pt = InstanceType<typeof Point>

export const FIELD_SIZE = Point.Fp.ORDER
export const GROUP_ORDER = Point.Fn.ORDER

const mod = (a: bigint, m: bigint) => ((a % m) + m) % m
const b32 = (x: bigint): Hex => numberToHex(x, { size: 32 })
const h2b = (h: Hex) => BigInt(h)

function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  let r = 1n
  base = mod(base, m)
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % m
    base = (base * base) % m
    exp >>= 1n
  }
  return r
}

function modInv(a: bigint, m: bigint): bigint {
  return modPow(a, m - 2n, m) // m is prime
}

const ySquared = (x: bigint) => mod(x * x * x + 7n, FIELD_SIZE)
const sqrt = (x: bigint) => modPow(x, (FIELD_SIZE + 1n) / 4n, FIELD_SIZE)

/** keccak256 re-hashed until the result is below FIELD_SIZE (VRF.sol _fieldHash). */
export function fieldHash(msg: Hex): bigint {
  let x = h2b(keccak256(msg))
  while (x >= FIELD_SIZE) x = h2b(keccak256(b32(x)))
  return x
}

const ptHex = (p: Pt): Hex => {
  const { x, y } = p.toAffine()
  return concatHex([b32(x), b32(y)])
}

/** Try-and-increment hash to curve with even y (VRF.sol _hashToCurve). */
export function hashToCurve(pk: Pt, seed: bigint): Pt {
  let x = fieldHash(concatHex([b32(1n), ptHex(pk), b32(seed)]))
  for (;;) {
    let y = sqrt(ySquared(x))
    if (mod(y * y, FIELD_SIZE) === ySquared(x)) {
      if (y % 2n === 1n) y = FIELD_SIZE - y
      return Point.fromAffine({ x, y })
    }
    x = fieldHash(b32(x))
  }
}

/** Ethereum address of a curve point: last 20 bytes of keccak256(x || y). */
export function pointAddress(p: Pt): Address {
  return `0x${keccak256(ptHex(p)).slice(26)}` as Address
}

/** VRF.sol _scalarFromCurvePoints. Not reduced mod the group order. */
export function scalarFromCurvePoints(hash: Pt, pk: Pt, gamma: Pt, uWitness: Address, v: Pt): bigint {
  return h2b(keccak256(concatHex([b32(2n), ptHex(hash), ptHex(pk), ptHex(gamma), ptHex(v), uWitness])))
}

const mul = (p: Pt, k: bigint) => p.multiply(mod(k, GROUP_ORDER))

/** Mirrors VRF.sol _projectiveECAdd exactly; zInv must invert the z it computes. */
export function projectiveECAddZ(p: Pt, q: Pt): bigint {
  const F = FIELD_SIZE
  const pm = (x1: bigint, z1: bigint, x2: bigint, z2: bigint): [bigint, bigint] => [(x1 * x2) % F, (z1 * z2) % F]
  const ps = (x1: bigint, z1: bigint, x2: bigint, z2: bigint): [bigint, bigint] => [
    ((z2 * x1) % F + ((F - x2) * z1) % F) % F,
    (z1 * z2) % F,
  ]
  const { x: px, y: py } = p.toAffine()
  const { x: qx, y: qy } = q.toAffine()
  const lx = (qy + F - py) % F
  const lz = (qx + F - px) % F
  let [sx, dx] = pm(lx, lz, lx, lz)
  ;[sx, dx] = ps(sx, dx, px, 1n)
  ;[sx, dx] = ps(sx, dx, qx, 1n)
  let [sy, dy] = ps(px, 1n, sx, dx)
  ;[sy, dy] = pm(sy, dy, lx, lz)
  ;[sy, dy] = ps(sy, dy, py, 1n)
  return dx !== dy ? (dx * dy) % F : dx
}

/** Matches the `Proof` struct in VRF.sol / VRFTypes.Proof (field order matters for ABI encoding). */
export type SolidityProof = {
  pk: readonly [bigint, bigint]
  gamma: readonly [bigint, bigint]
  c: bigint
  s: bigint
  seed: bigint
  uWitness: Address
  cGammaWitness: readonly [bigint, bigint]
  sHashWitness: readonly [bigint, bigint]
  zInv: bigint
}

const xy = (p: Pt) => {
  const { x, y } = p.toAffine()
  return [x, y] as const
}

export function publicKey(sk: bigint): readonly [bigint, bigint] {
  return xy(Point.BASE.multiply(sk))
}

/** keyHash = keccak256(abi.encode(uint256[2] pk)), as ArcVRFCoordinator.hashOfKey. */
export function keyHashOf(pk: readonly [bigint, bigint]): Hex {
  return keccak256(concatHex([b32(pk[0]), b32(pk[1])]))
}

function randomScalar(): bigint {
  for (;;) {
    const k = h2b(`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`)
    if (k > 0n && k < GROUP_ORDER) return k
  }
}

/** The randomness the coordinator derives: keccak256(abi.encode(3, gamma)). */
export function outputOf(gamma: readonly [bigint, bigint]): bigint {
  return h2b(keccak256(concatHex([b32(3n), b32(gamma[0]), b32(gamma[1])])))
}

/**
 * Proof over `actualSeed` = keccak256(abi.encodePacked(preSeed, requestBlockHash)).
 * The returned proof's `seed` is set to `preSeed`; the coordinator recomputes actualSeed on-chain.
 * Pass `nonce` only in tests: a predictable nonce leaks the secret key.
 */
export function generateProof(sk: bigint, actualSeed: bigint, preSeed: bigint, nonce = randomScalar()): SolidityProof {
  if (sk <= 0n || sk >= GROUP_ORDER) throw new Error('bad secret key')
  const pkPt = Point.BASE.multiply(sk)
  const h = hashToCurve(pkPt, actualSeed)
  const gamma = h.multiply(sk)
  const u = Point.BASE.multiply(nonce)
  const uWitness = pointAddress(u)
  const v = h.multiply(nonce)
  const c = scalarFromCurvePoints(h, pkPt, gamma, uWitness, v)
  const s = mod(nonce - c * sk, GROUP_ORDER)
  const cGamma = mul(gamma, c)
  const sHash = mul(h, s)
  if (cGamma.equals(sHash)) return generateProof(sk, actualSeed, preSeed) // cryptographically negligible
  return {
    pk: xy(pkPt),
    gamma: xy(gamma),
    c,
    s,
    seed: preSeed,
    uWitness,
    cGammaWitness: xy(cGamma),
    sHashWitness: xy(sHash),
    zInv: modInv(projectiveECAddZ(cGamma, sHash), FIELD_SIZE),
  }
}

/** Off-chain check equivalent to VRF.sol _verifyVRFProof. Returns the randomness, or throws. */
export function verifyProof(p: SolidityProof, actualSeed: bigint): bigint {
  const pk = Point.fromAffine({ x: p.pk[0], y: p.pk[1] })
  const gamma = Point.fromAffine({ x: p.gamma[0], y: p.gamma[1] })
  const cGamma = Point.fromAffine({ x: p.cGammaWitness[0], y: p.cGammaWitness[1] })
  const sHash = Point.fromAffine({ x: p.sHashWitness[0], y: p.sHashWitness[1] })
  const u = mul(pk, p.c).add(mul(Point.BASE, p.s))
  if (pointAddress(u).toLowerCase() !== p.uWitness.toLowerCase()) throw new Error('addr(c*pk+s*g) != uWitness')
  const h = hashToCurve(pk, actualSeed)
  if (!mul(gamma, p.c).equals(cGamma) || !mul(h, p.s).equals(sHash)) throw new Error('bad witness points')
  if ((projectiveECAddZ(cGamma, sHash) * p.zInv) % FIELD_SIZE !== 1n) throw new Error('bad zInv')
  const v = cGamma.add(sHash)
  if (scalarFromCurvePoints(h, pk, gamma, p.uWitness, v) !== p.c) throw new Error('invalid proof')
  return outputOf(p.gamma)
}

/** actualSeed = keccak256(abi.encodePacked(uint256 preSeed, bytes32 blockHash)) */
export function finalSeed(preSeed: bigint, blockHash: Hex): bigint {
  return h2b(keccak256(encodePacked(['uint256', 'bytes32'], [preSeed, blockHash])))
}

/** randomWords[i] = keccak256(abi.encode(randomness, i)) */
export function expandWords(randomness: bigint, n: number): bigint[] {
  return Array.from({ length: n }, (_, i) => h2b(keccak256(concatHex([b32(randomness), b32(BigInt(i))]))))
}
