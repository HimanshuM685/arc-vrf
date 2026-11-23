import { arcVRFCoordinatorAbi, arcVRFWrapperAbi, diceDirectAbi, hiLoGameAbi } from '@arc-vrf/sdk'
import { getAbiItem } from 'viem'

export const ev = {
  requested: getAbiItem({ abi: arcVRFCoordinatorAbi, name: 'RandomWordsRequested' }),
  fulfilled: getAbiItem({ abi: arcVRFCoordinatorAbi, name: 'RandomWordsFulfilled' }),
  subCreated: getAbiItem({ abi: arcVRFCoordinatorAbi, name: 'SubscriptionCreated' }),
  subTransferred: getAbiItem({ abi: arcVRFCoordinatorAbi, name: 'SubscriptionOwnerTransferred' }),
  subFunded: getAbiItem({ abi: arcVRFCoordinatorAbi, name: 'SubscriptionFundedWithNative' }),
  wrapperRequest: getAbiItem({ abi: arcVRFWrapperAbi, name: 'WrapperRequestMade' }),
  wrapperFailed: getAbiItem({ abi: arcVRFWrapperAbi, name: 'WrapperFulfillmentFailed' }),
  roundSettled: getAbiItem({ abi: hiLoGameAbi, name: 'RoundSettled' }),
  roundRequested: getAbiItem({ abi: hiLoGameAbi, name: 'RoundRequested' }),
  diceRolled: getAbiItem({ abi: diceDirectAbi, name: 'DiceRolled' }),
  diceLanded: getAbiItem({ abi: diceDirectAbi, name: 'DiceLanded' }),
}
