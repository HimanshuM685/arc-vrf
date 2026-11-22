// wagmi's Base Account connector lazily imports @base-org/account, which drags in the Coinbase
// server SDK and its uninstalled x402 peers. This app doesn't offer Base Account, so stub it.
export function createBaseAccountSDK(): never {
  throw new Error('Base Account is not enabled in this app.')
}
