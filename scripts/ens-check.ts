/**
 * Inspect preference text records for one or more ENS names on Sepolia.
 *
 *   npx tsx scripts/ens-check.ts ana.eth demo.eth
 *   npx tsx scripts/ens-check.ts --all      # the names in docs/demo-names.md
 *
 * This is a read-only diagnostic. It prints what is actually set on chain for each of
 * the five documented preference record keys, which is how the demo names in
 * docs/demo-names.md are verified. It never writes to chain.
 *
 * Set SEPOLIA_RPC_URL in .env if you want to use a keyed endpoint. A public endpoint
 * works and is not a secret.
 */

import { config as loadDotenv } from 'dotenv'

loadDotenv()

import { getConfig } from '../src/server/config'
import { createEnsClient, normalizeEnsName, readPreferenceRecords } from '../src/server/ens'
import { allPreferenceRecordKeys } from '../src/shared/preferences'
import { DEMO_NAMES } from '../src/shared/demo-names'

const rpcUrl = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const rpcTimeoutMs = Number(process.env.RPC_TIMEOUT_MS ?? 15_000)

function parseConfigOrExit(): ReturnType<typeof getConfig> {
  try {
    return getConfig()
  } catch {
    // The RPC check does not need model credentials, so a missing LLM_* is not fatal.
    return {
      llmBaseUrl: '',
      llmModel: '',
      llmApiKey: '',
      llmTimeoutMs: 20_000,
      sepoliaRpcUrl: rpcUrl,
      rpcTimeoutMs,
      port: 8787,
      allowDemoFixtures: true,
    }
  }
}

async function main(): Promise<void> {
  parseConfigOrExit()

  const args = process.argv.slice(2)
  const useAll = args.includes('--all')
  const names = useAll ? DEMO_NAMES.map((entry) => entry.ensName) : args.filter((a) => !a.startsWith('--'))

  if (names.length === 0) {
    console.error('Usage: npx tsx scripts/ens-check.ts <ens-name> [<ens-name> ...] | --all')
    process.exit(2)
  }

  const client = createEnsClient(rpcUrl, rpcTimeoutMs)
  const keys = allPreferenceRecordKeys()

  let anyResolved = false

  for (const candidate of names) {
    console.log('')
    console.log('='.repeat(72))
    console.log(`input: ${JSON.stringify(candidate)}`)

    let normalized: string
    try {
      normalized = normalizeEnsName(candidate)
      console.log(`ENSIP-15 normalized: ${normalized}`)
    } catch (error) {
      console.log(`INVALID NAME: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    try {
      const result = await readPreferenceRecords(client, normalized)
      anyResolved = anyResolved || result.nameResolved

      console.log(`address: ${result.address ?? '(does not resolve)'}`)
      if (result.readFailures.length > 0) {
        console.log(`read failures: ${result.readFailures.join(', ')}`)
      }
      console.log('-'.repeat(72))

      for (const key of keys) {
        const value = result.records[key]
        const shown = value === null ? '(unset)' : JSON.stringify(value)
        console.log(`  ${key.padEnd(30)} ${shown}`)
      }

      const setCount = keys.filter((key) => result.records[key] !== null).length
      console.log('-'.repeat(72))
      console.log(`${setCount}/${keys.length} preference records set`)
    } catch (error) {
      console.log(`READ ERROR: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  console.log('')
  console.log('='.repeat(72))
  console.log(anyResolved ? 'At least one name resolved.' : 'No supplied name resolved on Sepolia.')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})