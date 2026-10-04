/**
 * Read-only probe: does the app's own ENS read path return real text records for
 * well-known Sepolia names?
 *
 * This uses `readPreferenceRecords` — the exact function the app uses — plus the
 * standard ENSIP-5 keys, so a positive result is real evidence rather than a
 * reimplementation that might behave differently.
 *
 * Read-only. Costs nothing but RPC calls. Run: npx tsx scripts/probe-live-reads.ts
 */

import { getEnsText } from 'viem/ens'

import { createEnsClient, normalizeEnsName, readPreferenceRecords } from '../src/server/ens'
import { allPreferenceRecordKeys } from '../src/shared/preferences'

const RPC = 'https://ethereum-sepolia-rpc.publicnode.com'

/** Standard ENSIP-5 keys plus our namespace, to see whether ANY text exists. */
const PROBE_KEYS = [
  'url',
  'description',
  'notice',
  'email',
  'com.github',
  'com.twitter',
  ...allPreferenceRecordKeys(),
]

const CANDIDATES = [
  'vitalik.eth',
  'nick.eth',
  'wrapped.eth',
  'demo.eth',
  'sepolia.eth',
  'test.eth',
  'ens.eth',
  'ethereum.eth',
  'name.eth',
  'hello.eth',
  'ana.eth',
  'kai.eth',
  'portableprefs.eth',
  'lore.eth',
  'foo.eth',
  'bar.eth',
  'example.eth',
  'dev.eth',
  'testname.eth',
  'myethname.eth',
  'jason.eth',
  'nick.eth',
  'wallet.eth',
  'me.eth',
  'you.eth',
]

async function main(): Promise<void> {
  const client = createEnsClient(RPC, 20_000)
  const seen = new Set<string>()
  const names = CANDIDATES.filter((n) => (seen.has(n) ? false : (seen.add(n), true)))

  console.log('')
  console.log(`Probing ${names.length} Sepolia names for ANY readable text record`)
  console.log(`RPC: ${RPC}`)
  console.log(`Keys per name: ${PROBE_KEYS.length}`)
  console.log('='.repeat(72))

  let namesWithText = 0

  for (const candidate of names) {
    let normalized: string
    try {
      normalized = normalizeEnsName(candidate)
    } catch {
      console.log(`${candidate.padEnd(22)} INVALID NAME`)
      continue
    }

    const hits: string[] = []
    let failed = 0

    for (const key of PROBE_KEYS) {
      try {
        const value = await getEnsText(client, { name: normalized, key })
        if (typeof value === 'string' && value.length > 0) hits.push(`${key}=${JSON.stringify(value.slice(0, 60))}`)
      } catch {
        failed += 1
      }
    }

    if (hits.length > 0) {
      namesWithText += 1
      console.log(`${normalized.padEnd(22)} ${hits.length} TEXT RECORD(S)`)
      for (const hit of hits) console.log(`    ${hit}`)
    } else {
      console.log(
        `${normalized.padEnd(22)} no text (${failed}/${PROBE_KEYS.length} reads threw, rest returned null)`,
      )
    }
  }

  console.log('')
  console.log('='.repeat(72))
  console.log(`names with at least one readable text record: ${namesWithText}/${names.length}`)

  // Also show what the app's own preference read returns for one name, for the record.
  console.log('')
  console.log('App read path (readPreferenceRecords) for "vitalik.eth":')
  try {
    const result = await readPreferenceRecords(client, normalizeEnsName('vitalik.eth'))
    console.log(`  normalizedName : ${result.normalizedName}`)
    console.log(`  nameResolved   : ${result.nameResolved}`)
    console.log(`  address        : ${result.address ?? '(none)'}`)
    console.log(`  readFailures   : ${result.readFailures.length === 0 ? '(none)' : result.readFailures.join(', ')}`)
    for (const [key, value] of Object.entries(result.records)) {
      console.log(`  ${key.padEnd(32)} ${value === null ? 'null' : JSON.stringify(value)}`)
    }
  } catch (error) {
    console.log(`  threw: ${error instanceof Error ? error.message : String(error)}`)
  }
  console.log('')
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})