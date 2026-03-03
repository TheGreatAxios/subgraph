#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const NETWORKS_DIR = path.join(ROOT_DIR, 'config', 'networks');
const DEPLOYMENT_FILE = path.join(ROOT_DIR, 'deployments', 'deployment.json');
const CONSTANTS_FILE = path.join(ROOT_DIR, 'src', 'constants.ts');
const CONTRACT_ADDRESSES_FILE = path.join(ROOT_DIR, 'src', 'contract-addresses.ts');

// Colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function validateNetworkConfig(networkName, config) {
  const errors = [];
  const warnings = [];

  // Required fields
  if (!config.network) errors.push('Missing "network" field');
  if (!config.chainId) errors.push('Missing "chainId" field');
  if (!config.displayName) errors.push('Missing "displayName" field');

  // Registry configs
  // Addresses/startBlocks are optional and may be managed outside this repo or provided for convenience.
  const registries = ['identityRegistry', 'reputationRegistry', 'validationRegistry'];
  for (const registry of registries) {
    if (!config[registry]) {
      warnings.push(`Missing "${registry}" configuration (ok if deployment details are managed elsewhere)`);
      continue;
    }
    if (config[registry].address !== undefined) {
      // Check address format (if provided)
      if (!/^0x[a-fA-F0-9]{40}$/.test(config[registry].address)) {
        errors.push(`Invalid address format for "${registry}.address": ${config[registry].address}`);
      }
    }
    // startBlock is optional; no validation required here
  }

  // Graph node config
  if (!config.graphNode) {
    errors.push('Missing "graphNode" configuration');
  } else if (!config.graphNode.network) {
    errors.push('Missing "graphNode.network"');
  }

  return { errors, warnings };
}

function parseConstantsNetworkChainIds() {
  const errors = [];
  const content = fs.readFileSync(CONSTANTS_FILE, 'utf8');

  // export const FOO = "bar";
  const constRegex = /export const (\w+)\s*=\s*"([^"]+)";/g;
  const networkConstToValue = new Map();
  let m;
  while ((m = constRegex.exec(content)) !== null) {
    networkConstToValue.set(m[1], m[2]);
  }

  // if (...) return BigInt.fromI32(123);
  // if (...) return BigInt.fromString("1351057110");
  const chainIdByNetworkValue = new Map();
  const ifRegex = /if\s*\(([^)]+)\)\s*return\s*BigInt\.from(I32|String)\(([^)]+)\);/g;

  while ((m = ifRegex.exec(content)) !== null) {
    const condition = m[1];
    const ctor = m[2];
    const raw = m[3].trim();

    const chainId =
      ctor === 'I32'
        ? raw.replace(/[^0-9-]/g, '')
        : raw.replace(/['"]/g, '').trim();

    const networks = [];
    const netTokenRegex = /Network\.(\w+)/g;
    let n;
    while ((n = netTokenRegex.exec(condition)) !== null) {
      const networkConst = n[1];
      const networkValue = networkConstToValue.get(networkConst);
      if (!networkValue) {
        errors.push(`src/constants.ts: Unknown Network constant referenced: Network.${networkConst}`);
        continue;
      }
      networks.push(networkValue);
    }

    for (const networkValue of networks) {
      chainIdByNetworkValue.set(networkValue, chainId);
    }
  }

  return { chainIdByNetworkValue, errors };
}

function parseContractAddresses() {
  const content = fs.readFileSync(CONTRACT_ADDRESSES_FILE, 'utf8');

  const chainToAddresses = new Map();
  const presentChainIds = new Set();

  // Detect presence of branches (even if addresses are zero/variables)
  const presentI32 = /chainId\.equals\(BigInt\.fromI32\((\d+)\)\)/g;
  let p;
  while ((p = presentI32.exec(content)) !== null) {
    presentChainIds.add(p[1]);
  }

  const presentStr = /chainId\.equals\(BigInt\.fromString\("(\d+)"\)\)/g;
  while ((p = presentStr.exec(content)) !== null) {
    presentChainIds.add(p[1]);
  }

  // fromI32 branches
  const branchI32 = /chainId\.equals\(BigInt\.fromI32\((\d+)\)\)[\s\S]*?return new ContractAddresses\(\s*Bytes\.fromHexString\("([^"]+)"\),\s*Bytes\.fromHexString\("([^"]+)"\),/g;
  let m;
  while ((m = branchI32.exec(content)) !== null) {
    chainToAddresses.set(m[1], { identity: m[2], reputation: m[3] });
  }

  // fromString branches (e.g. SKALE)
  const branchStr = /chainId\.equals\(BigInt\.fromString\("(\d+)"\)\)[\s\S]*?return new ContractAddresses\(\s*Bytes\.fromHexString\("([^"]+)"\),\s*Bytes\.fromHexString\("([^"]+)"\),/g;
  while ((m = branchStr.exec(content)) !== null) {
    chainToAddresses.set(m[1], { identity: m[2], reputation: m[3] });
  }

  return { chainToAddresses, presentChainIds };
}

function main() {
  log('\n🔍 Validating network configurations\n', 'cyan');

  let hasErrors = false;

  // Load code-based network/chain mappings for deeper validation
  let constantsMapping = null;
  let contractAddresses = null;
  try {
    constantsMapping = parseConstantsNetworkChainIds();
    if (constantsMapping.errors.length > 0) {
      hasErrors = true;
      log('\n❌ src/constants.ts mapping parse errors:', 'red');
      constantsMapping.errors.forEach(e => log(`   - ${e}`, 'red'));
    }
  } catch (e) {
    hasErrors = true;
    log('\n❌ Failed to read/parse src/constants.ts for network→chainId validation', 'red');
    log(`   ${e.message}`, 'red');
  }

  try {
    contractAddresses = parseContractAddresses();
  } catch (e) {
    hasErrors = true;
    log('\n❌ Failed to read/parse src/contract-addresses.ts for chainId→addresses validation', 'red');
    log(`   ${e.message}`, 'red');
  }

  // Check if networks directory exists
  if (!fs.existsSync(NETWORKS_DIR)) {
    log('❌ Networks directory not found: ' + NETWORKS_DIR, 'red');
    process.exit(1);
  }

  // Get all network configs
  const networkFiles = fs.readdirSync(NETWORKS_DIR).filter(f => f.endsWith('.json'));

  if (networkFiles.length === 0) {
    log('❌ No network configuration files found', 'red');
    process.exit(1);
  }

  log(`Found ${networkFiles.length} network configurations\n`, 'green');

  // Validate each network config
  for (const file of networkFiles) {
    const networkName = file.replace('.json', '');
    const configPath = path.join(NETWORKS_DIR, file);

    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const { errors, warnings } = validateNetworkConfig(networkName, config);

      // Deep validation: JSON config must match code mappings
      if (constantsMapping && constantsMapping.chainIdByNetworkValue) {
        const graphNodeNetwork = config.graphNode && config.graphNode.network;
        if (graphNodeNetwork) {
          const mappedChainId = constantsMapping.chainIdByNetworkValue.get(graphNodeNetwork);
          if (!mappedChainId) {
            errors.push(`graphNode.network "${graphNodeNetwork}" is not mapped in src/constants.ts getChainIdFromNetwork()`);
          } else if (String(config.chainId) !== String(mappedChainId)) {
            errors.push(`chainId mismatch: config.chainId=${config.chainId} but src/constants.ts maps "${graphNodeNetwork}" → ${mappedChainId}`);
          }
        }
      }

      if (contractAddresses && contractAddresses.presentChainIds) {
        const cid = String(config.chainId || '');
        const haveOnchainAddresses =
          config.identityRegistry && typeof config.identityRegistry.address === 'string' && config.identityRegistry.address.length > 0 &&
          config.reputationRegistry && typeof config.reputationRegistry.address === 'string' && config.reputationRegistry.address.length > 0;

        const isPresent = contractAddresses.presentChainIds.has(cid);
        const entry = contractAddresses.chainToAddresses.get(cid);
        if (haveOnchainAddresses) {
          if (!isPresent) {
            errors.push(`chainId ${cid} is not present in src/contract-addresses.ts getContractAddresses()`);
          } else if (!entry) {
            warnings.push(`chainId ${cid} is present in src/contract-addresses.ts, but validator could not parse identity/reputation addresses`);
          } else {
            const i = config.identityRegistry.address;
            const r = config.reputationRegistry.address;
            if (entry.identity.toLowerCase() !== i.toLowerCase()) {
              errors.push(`identityRegistry address mismatch for chainId ${cid}: config=${i}, code=${entry.identity}`);
            }
            if (entry.reputation.toLowerCase() !== r.toLowerCase()) {
              errors.push(`reputationRegistry address mismatch for chainId ${cid}: config=${r}, code=${entry.reputation}`);
            }
          }
        } else {
          if (!isPresent) {
            warnings.push(`chainId ${cid} not present in src/contract-addresses.ts (ok if contracts are not deployed)`);
          }
        }
      }

      if (errors.length > 0 || warnings.length > 0) {
        log(`\n📄 ${networkName} (${config.displayName || 'Unknown'})`, 'cyan');

        if (errors.length > 0) {
          hasErrors = true;
          log('   ❌ Errors:', 'red');
          errors.forEach(err => log(`      - ${err}`, 'red'));
        }

        if (warnings.length > 0) {
          log('   ⚠️  Warnings:', 'yellow');
          warnings.forEach(warn => log(`      - ${warn}`, 'yellow'));
        }
      } else {
        log(`✅ ${networkName} (${config.displayName})`, 'green');
      }
    } catch (error) {
      hasErrors = true;
      log(`\n❌ ${networkName}: Failed to parse JSON`, 'red');
      log(`   ${error.message}`, 'red');
    }
  }

  // Validate deployment.json if it exists
  if (fs.existsSync(DEPLOYMENT_FILE)) {
    log('\n🔍 Validating deployment.json\n', 'cyan');

    try {
      const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'));

      if (!deployment['erc-8004']) {
        log('❌ Missing "erc-8004" entry in deployment.json', 'red');
        hasErrors = true;
      } else {
        const deployments = deployment['erc-8004'].deployments;
        const deploymentCount = Object.keys(deployments || {}).length;

        log(`✅ Found ${deploymentCount} deployment entries`, 'green');

        // Check that each deployment references a valid network config
        for (const [name, config] of Object.entries(deployments || {})) {
          const networkFile = `${config.network}.json`;
          if (!networkFiles.includes(networkFile)) {
            log(`⚠️  ${name}: references unknown network "${config.network}"`, 'yellow');
          }
        }
      }
    } catch (error) {
      log('❌ Failed to parse deployment.json', 'red');
      log(`   ${error.message}`, 'red');
      hasErrors = true;
    }
  } else {
    log('\n⚠️  deployment.json not found (optional)', 'yellow');
  }

  log('\n' + '='.repeat(70), 'cyan');

  if (hasErrors) {
    log('❌ Validation failed with errors', 'red');
    log('='.repeat(70) + '\n', 'cyan');
    process.exit(1);
  } else {
    log('✅ All validations passed!', 'green');
    log('='.repeat(70) + '\n', 'cyan');
  }
}

if (require.main === module) {
  main();
}
