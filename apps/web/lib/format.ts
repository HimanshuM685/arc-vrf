import { formatUnits, type Hex } from 'viem'

/** Native USDC on Arc has 18 decimals. Shows up to 6 significant decimals. */
export function usdc(wei: bigint | undefined, digits = 6): string {
  if (wei === undefined) return '…'
  const s = formatUnits(wei, 18)
  const [i, f = ''] = s.split('.')
  const frac = f.slice(0, digits).replace(/0+$/, '')
  return frac ? `${i}.${frac}` : i!
}

export const gwei = (wei: bigint) => formatUnits(wei, 9)

export function short(v: string | bigint | undefined, head = 6, tail = 4): string {
  if (v === undefined) return '…'
  const s = typeof v === 'bigint' ? `0x${v.toString(16)}` : v
  return s.length > head + tail + 3 ? `${s.slice(0, head + 2)}…${s.slice(-tail)}` : s
}

export const hex = (v: bigint): Hex => `0x${v.toString(16).padStart(64, '0')}`

export function explorerTx(base: string | undefined, hash: string) {
  return base ? `${base}/tx/${hash}` : undefined
}
export function explorerAddress(base: string | undefined, addr: string) {
  return base ? `${base}/address/${addr}` : undefined
}

export const REPO = 'https://github.com/HimanshuM685/arc-vrf'
