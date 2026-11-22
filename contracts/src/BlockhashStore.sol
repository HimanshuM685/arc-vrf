// SPDX-License-Identifier: MIT
// Derived from Chainlink BlockhashStore.sol (chainlink-evm@e162754, MIT).
// Arc change: plain blockhash/block.number instead of ChainSpecificUtil (no Arbitrum paths).
pragma solidity 0.8.19;

/// @notice Stores block hashes older than the 256-block BLOCKHASH window.
/// On Arc the coordinator first tries EIP-2935 history (~8191 blocks), then this store.
contract BlockhashStore {
  mapping(uint256 => bytes32) internal s_blockhashes;

  /// @notice stores blockhash of a block within the last 256
  function store(uint256 n) public {
    bytes32 h = blockhash(n);
    require(h != 0x0, "blockhash(n) failed");
    s_blockhashes[n] = h;
  }

  /// @notice stores blockhash of the earliest block still available
  function storeEarliest() external {
    store(block.number - 256);
  }

  /// @notice stores blockhash of n given the RLP header of block n+1 (whose hash is already stored)
  function storeVerifyHeader(uint256 n, bytes memory header) public {
    require(keccak256(header) == s_blockhashes[n + 1], "header has unknown blockhash");
    bytes32 parentHash;
    assembly {
      parentHash := mload(add(header, 36)) // skip length prefix + RLP list header
    }
    s_blockhashes[n] = parentHash;
  }

  function getBlockhash(uint256 n) external view returns (bytes32) {
    bytes32 h = s_blockhashes[n];
    require(h != 0x0, "blockhash not found in store");
    return h;
  }
}
