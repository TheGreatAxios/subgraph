import { BigInt } from "@graphprotocol/graph-ts"

// Create a deterministic, unique, monotonic id for timeseries points.
// We avoid relying on graph-node auto-id behavior, since some deployments
// may validate/insert using the mapping-provided id.
export function makeTimeseriesPointId(blockNumber: BigInt, logIndex: BigInt): i64 {
  // (blockNumber * 1_000_000) + logIndex
  // logIndex is per-tx/per-block and comfortably fits into the lower 6 digits.
  return blockNumber.toI64() * 1000000 + logIndex.toI64()
}

