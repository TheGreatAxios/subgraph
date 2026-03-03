import { BigInt, dataSource, log } from "@graphprotocol/graph-ts"
import { getChainIdFromNetwork } from "../constants"

/**
 * Get the chain ID for the current data source network
 * @returns Chain ID as i32, or 0 for unknown networks
 */
export function getChainId(): i32 {
  let network = dataSource.network()

  let chainId = getChainIdFromNetwork(network)
  if (chainId.equals(BigInt.fromI32(0))) {
    log.warning("Unknown network: {}, using chain ID 0", [network])
    return 0
  }
  if (!chainId.isI32()) {
    log.warning("Chain ID does not fit i32: {} (network: {})", [chainId.toString(), network])
    return 0
  }
  return chainId.toI32()
}
