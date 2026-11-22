// A real Chainlink VRF v2.5 round on Base Sepolia (28 Sep 2026), re-derived with this repo's verifier
// (node/test/proof.test.ts). Same math as Arc VRF.
export const baseSepoliaRound = {
  keyHash: '0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71',
  preSeed: '0xae8c55299baafabfd93525c2b927e6bad97ad2e0e5d1be520aa05f45072af620',
  blockNumber: 47387533,
  blockHash: '0x82257b9523649c38964eb5a7152985e7408702c03630640a15d739305d87b9c2',
  seed: '0xb246f519fa7ad12880a7597c1ab0af2bdc3387db42f66eed2e897b69d757b6d9',
  gammaX: '0x31cc5813dd5c22876ed771b71b9ac2b4cf519256d4b0be74a39395e14623b8d5',
  gammaY: '0x4bceae8aa7b9b084c000b281ec2db94eacba24ff5efef253034721f28a5b52f6',
  randomness: '0x83faef5289060da3291f929088a2abed5dca9e50f052b9d755f9843aa503865a',
  word0: '0x3fcd8c03668ca23e5d6ad191eaf0614ef523d8e18f6263d82a85bc1552ee2f42',
  requestTx: 'https://sepolia.basescan.org/tx/0x37698ef8c02b356fc49eb04a59363c68ef8b6513f6aeb80f7772b416af1d9ed3',
  fulfilTx: 'https://sepolia.basescan.org/tx/0x9bdf053b40482ef98639ba5fe18172f7f7dce86bb6234bfcca85488e91519097',
} as const
