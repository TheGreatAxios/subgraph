import { BigInt, Bytes, ethereum, log, BigDecimal } from "@graphprotocol/graph-ts"
import { getChainId } from "./utils/chain"
import {
  ValidationRequest,
  ValidationResponse
} from "../generated/ValidationRegistry/ValidationRegistry"
import {
  Agent,
  Validation,
  ValidationPoint
} from "../generated/schema"
import { getOrCreateProtocol } from "./utils/protocol"
import { makeTimeseriesPointId } from "./utils/timeseries"


// =============================================================================
// EVENT HANDLERS
// =============================================================================

export function handleValidationRequest(event: ValidationRequest): void {
  let agentId = event.params.agentId
  let validatorAddress = event.params.validatorAddress
  let requestHash = event.params.requestHash
  let chainId = getChainId()
  let agentEntityId = `${chainId.toString()}:${agentId.toString()}`
  
  // Load agent
  let agent = Agent.load(agentEntityId)
  if (agent == null) {
    log.warning("Validation request for unknown agent: {}", [agentEntityId])
    return
  }
  
  // Create validation entity
  let validation = new Validation(requestHash.toHexString())
  validation.agent = agentEntityId
  validation.validatorAddress = validatorAddress
  validation.requestUri = event.params.requestURI
  validation.requestHash = requestHash
  validation.response = 0 // Pending
  validation.responseUri = ""
  validation.responseHash = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000")
  validation.tag = ""
  validation.status = "PENDING"
  validation.createdAt = event.block.timestamp
  validation.updatedAt = event.block.timestamp
  validation.save()
  
  // Schedule timeout check (1 hour timeout)
  scheduleValidationTimeoutCheck(validation, event.block.timestamp)
  
  // Update agent activity
  agent.lastActivity = event.block.timestamp
  agent.updatedAt = event.block.timestamp
  agent.save()

  // Ensure protocol exists and emit validation request point (analytics via aggregations)
  let protocol = getOrCreateProtocol(BigInt.fromI32(chainId), event.block.timestamp)
  if (protocol != null) {
    let pid = makeTimeseriesPointId(event.block.number, event.logIndex)
    let p = new ValidationPoint(pid)
    p.protocol = protocol.id
    p.agent = agentEntityId
    p.timestamp = event.block.timestamp.toI64()
    p.score = 0
    p.isRequest = true
    p.isResponse = false
    p.requestCount = BigInt.fromI32(1)
    p.responseCount = BigInt.fromI32(0)
    p.responseScore = BigInt.fromI32(0)
    p.save()
  }
  
  log.info("Validation request for agent {}: {}", [agentEntityId, requestHash.toHexString()])
}

export function handleValidationResponse(event: ValidationResponse): void {
  let agentId = event.params.agentId
  let requestHash = event.params.requestHash
  let response = event.params.response
  let chainId = getChainId()
  let agentEntityId = `${chainId.toString()}:${agentId.toString()}`
  
  // Load validation
  let validation = Validation.load(requestHash.toHexString())
  if (validation == null) {
    log.warning("Response for unknown validation: {}", [requestHash.toHexString()])
    return
  }
  
  // Load agent
  let agentForResponse = Agent.load(agentEntityId)
  if (agentForResponse == null) {
    log.warning("Validation response for unknown agent: {}", [agentEntityId])
    return
  }
  
  // Update validation
  validation.response = response
  validation.responseUri = event.params.responseURI
  validation.responseHash = event.params.responseHash
  validation.tag = event.params.tag
  validation.status = "COMPLETED"
  validation.updatedAt = event.block.timestamp
  validation.save()
  
  // Update agent activity
  let agent = Agent.load(agentEntityId)
  if (agent != null) {
    agent.lastActivity = event.block.timestamp
    agent.updatedAt = event.block.timestamp
    agent.save()
  }

  // Ensure protocol exists and emit validation response point
  let protocol = getOrCreateProtocol(BigInt.fromI32(chainId), event.block.timestamp)
  if (protocol != null) {
    let pid = makeTimeseriesPointId(event.block.number, event.logIndex)
    let p = new ValidationPoint(pid)
    p.protocol = protocol.id
    p.agent = agentEntityId
    p.timestamp = event.block.timestamp.toI64()
    p.score = response
    p.isRequest = false
    p.isResponse = true
    p.requestCount = BigInt.fromI32(0)
    p.responseCount = BigInt.fromI32(1)
    p.responseScore = BigInt.fromI32(response)
    p.save()
  }
  
  log.info("Validation response for agent {}: score {}", [agentEntityId, response.toString()])
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Analytics moved to timeseries + aggregations.


// =============================================================================
// VALIDATION TIMEOUT MANAGEMENT
// =============================================================================

/**
 * Schedule validation timeout check (1 hour timeout)
 * This would typically be handled by a background job or cron
 */
function scheduleValidationTimeoutCheck(validation: Validation, createdAt: BigInt): void {
  // In a real implementation, this would schedule a background job
  // For now, we'll just log the timeout period
  let timeoutPeriod = BigInt.fromI32(60 * 60) // 1 hour
  let timeoutAt = createdAt.plus(timeoutPeriod)
  
  log.info("Validation {} scheduled for timeout check at: {}", [
    validation.id,
    timeoutAt.toString()
  ])
}

export function checkValidationTimeouts(): void {
  // The Graph doesn't support Date.now() - timeout checking requires external services
  log.warning("checkValidationTimeouts() called but cannot get current time in The Graph context. Use external service with block timestamp queries.", [])
}

export function updateValidationStatus(validation: Validation, currentTimestamp: BigInt): void {
  // Check if validation has received a response
  if (validation.response > 0) {
    validation.status = "COMPLETED"
  } else {
    // Check if validation has expired (1 hour timeout)
    let timeoutPeriod = BigInt.fromI32(60 * 60) // 1 hour
    let timeoutAt = validation.createdAt.plus(timeoutPeriod)
    
    if (currentTimestamp > timeoutAt) {
      validation.status = "EXPIRED"
      log.info("Validation {} expired after timeout", [validation.id])
    } else {
      validation.status = "PENDING"
    }
  }
  
  validation.updatedAt = currentTimestamp
  validation.save()
}
