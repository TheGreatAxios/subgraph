import { BigInt, log } from "@graphprotocol/graph-ts"
import { Protocol } from "../../generated/schema"
import { getContractAddresses, getChainName, isSupportedChain } from "../contract-addresses"

export function getOrCreateProtocol(chainId: BigInt, timestamp: BigInt): Protocol | null {
  if (!isSupportedChain(chainId)) {
    log.warning("Unsupported chain: {}", [chainId.toString()])
    return null
  }

  let protocolId = chainId.toString()
  let protocol = Protocol.load(protocolId)

  if (protocol == null) {
    protocol = new Protocol(protocolId)
    protocol.chainId = chainId
    protocol.name = getChainName(chainId)

    let addresses = getContractAddresses(chainId)
    protocol.identityRegistry = addresses.identityRegistry
    protocol.reputationRegistry = addresses.reputationRegistry
    protocol.validationRegistry = addresses.validationRegistry

    protocol.createdAt = timestamp
  }

  protocol.updatedAt = timestamp
  protocol.save()
  return protocol
}

