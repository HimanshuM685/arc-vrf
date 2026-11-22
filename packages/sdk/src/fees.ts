import { concatHex, encodeAbiParameters, keccak256, toBytes, slice, type Hex } from 'viem'

/** bytes4(keccak256("VRF ExtraArgsV1")) = 0x92fd1338, same tag as Chainlink v2.5. */
export const EXTRA_ARGS_V1_TAG = slice(keccak256(toBytes('VRF ExtraArgsV1')), 0, 4)

/** The only extraArgs Arc VRF accepts besides empty bytes: ExtraArgsV1({nativePayment: true}). */
export const NATIVE_EXTRA_ARGS: Hex = concatHex([EXTRA_ARGS_V1_TAG, encodeAbiParameters([{ type: 'bool' }], [true])])

export type WrapperConfig = {
  wrapperGasOverhead: number
  coordinatorGasOverheadNative: number
  coordinatorGasOverheadPerWord: number
  premiumPercentage: number
  flatFeeNativePPM: number
}

/** Mirrors ArcVRFWrapper._calculateRequestPriceNative. Result in USDC wei (18 decimals). */
export function wrapperPrice(cfg: WrapperConfig, callbackGasLimit: bigint, numWords: bigint, gasPrice: bigint): bigint {
  const wrapperCost = gasPrice * BigInt(cfg.wrapperGasOverhead)
  const coordOverhead = BigInt(cfg.coordinatorGasOverheadNative) + numWords * BigInt(cfg.coordinatorGasOverheadPerWord)
  const coordCost = gasPrice * (callbackGasLimit + coordOverhead)
  return wrapperCost + (coordCost * BigInt(100 + cfg.premiumPercentage)) / 100n + 10n ** 12n * BigInt(cfg.flatFeeNativePPM)
}

/** Chainlink's upper-bound formula for what a subscription should hold for one request:
 * maxGasPrice * (200,000 + callbackGasLimit) * (100 + premium) / 100 (+ flat fee). */
export function subscriptionMaxCost(maxGasPrice: bigint, callbackGasLimit: bigint, premiumPercentage: number, flatFeeNativePPM = 0): bigint {
  return (maxGasPrice * (200_000n + callbackGasLimit) * BigInt(100 + premiumPercentage)) / 100n + 10n ** 12n * BigInt(flatFeeNativePPM)
}

/** Subscription charge for a fulfilment that used `gasUsed` (as the coordinator bills it). */
export function subscriptionCharge(gasPrice: bigint, gasUsed: bigint, gasAfterPaymentCalculation: number, premiumPercentage: number, flatFeeNativePPM = 0): bigint {
  return (gasPrice * (BigInt(gasAfterPaymentCalculation) + gasUsed) * BigInt(100 + premiumPercentage)) / 100n + 10n ** 12n * BigInt(flatFeeNativePPM)
}
