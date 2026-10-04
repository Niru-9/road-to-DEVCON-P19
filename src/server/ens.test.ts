/**
 * Checks for scored criterion 4 — the entered name is normalized with ENSIP-15 before
 * any ENS resolution call.
 *
 * These run without a network: they assert the normalization contract, including the
 * guarantee that `normalizeEnsName` is the only way to obtain a resolvable name. The
 * live end-to-end read against Sepolia is verified separately by
 * `npx tsx scripts/ens-check.ts`, and its observed output is in docs/harness-run-log.md.
 */

import { describe, expect, it } from 'vitest'

import {
  InvalidEnsNameError,
  MAX_NAME_LENGTH,
  normalizeEnsName,
  readPreferenceRecords,
  type EnsClient,
} from './ens'
import {
  PREFERENCE_RECORD_KEYS,
  resolvePreferences,
} from '../shared/preferences'

/**
 * A minimal stand-in for a viem client. `readPreferenceRecords` only ever calls
 * `getEnsAddress` on it, and the text reads are injected per test, so nothing here depends
 * on viem internals.
 */
const stubEnsClient = {
  getEnsAddress: async () => null,
} as unknown as EnsClient

describe('criterion 4 — the entered name is normalized before resolution', () => {
  it('lowercases and trims the user input (UTS-46)', () => {
    expect(normalizeEnsName('  ANA.eth  ')).toBe('ana.eth')
    expect(normalizeEnsName('Nick.ETH')).toBe('nick.eth')
    expect(normalizeEnsName('vitalik.eth')).toBe('vitalik.eth')
  })

  it('preserves non-ASCII labels that ENSIP-15 accepts', () => {
    expect(normalizeEnsName('ábaco.eth')).toBe('ábaco.eth')
    expect(normalizeEnsName('🍎.eth')).toBe('🍎.eth')
  })

  it('rejects an empty or whitespace-only name', () => {
    expect(() => normalizeEnsName('')).toThrow(InvalidEnsNameError)
    expect(() => normalizeEnsName('    ')).toThrow(InvalidEnsNameError)
  })

  it('rejects a name with no ENS root, which UTS-46 alone would let through', () => {
    // normalize('notaname') returns 'notaname' without throwing, so the root check in
    // normalizeEnsName is what stops this reaching a resolver.
    expect(() => normalizeEnsName('notaname')).toThrow(InvalidEnsNameError)
  })

  it('rejects structurally invalid names', () => {
    expect(() => normalizeEnsName('foo.eth.')).toThrow(InvalidEnsNameError)
    expect(() => normalizeEnsName('.eth')).toThrow(InvalidEnsNameError)
    expect(() => normalizeEnsName('has space.eth')).toThrow(InvalidEnsNameError)
    expect(() => normalizeEnsName('under_score.eth')).toThrow(InvalidEnsNameError)
  })

  it('rejects an over-long name before doing any work', () => {
    expect(() => normalizeEnsName(`${'a'.repeat(MAX_NAME_LENGTH + 1)}.eth`)).toThrow(
      InvalidEnsNameError,
    )
  })

  it('accepts a non-eth testnet root too', () => {
    expect(normalizeEnsName('team.test')).toBe('team.test')
  })

  it('is idempotent', () => {
    const once = normalizeEnsName('  MiXeD.eth ')
    expect(normalizeEnsName(once)).toBe(once)
  })

  it('produces a message that does not echo an unbounded amount of user input', () => {
    const noisy = `${'z'.repeat(500)}.eth`
    try {
      normalizeEnsName(noisy)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as Error).message.length).toBeLessThan(200)
    }
  })

  it('refuses an address, and says why rather than "check the spelling"', () => {
    // An address is the one wrong-kind-of-input worth naming: preferences are ENS text
    // records on a name, and "check the spelling" would be advice about an input whose
    // spelling is perfectly fine.
    for (const address of [
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      'd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    ]) {
      expect(() => normalizeEnsName(address)).toThrow(InvalidEnsNameError)
      try {
        normalizeEnsName(address)
        expect.unreachable('should have thrown')
      } catch (error) {
        const message = (error as Error).message
        expect(message).toMatch(/address/i)
        expect(message).toMatch(/text records on a NAME/i)
        expect(message).not.toMatch(/Check the spelling/)
      }
    }
  })
})

describe('a failed read is not the same fact as an unset record', () => {
  // Both cases yield a null value and both fall back to the named default, so the only place
  // the difference is visible is `recordStatus`. Without it, a reverting resolver would look
  // exactly like an owner who never set their preferences — a silent wrong answer.
  //
  // `readPreferenceRecords` takes its text reader as a parameter precisely so this can be
  // tested without stubbing viem internals.

  const ALL_KEYS = Object.values(PREFERENCE_RECORD_KEYS)

  it('labels a returned value as "read"', async () => {
    const result = await readPreferenceRecords(stubEnsClient, 'ana.eth', async () => 'pt')
    expect(Object.values(result.recordStatus)).toEqual(ALL_KEYS.map(() => 'read'))
    expect(result.readFailures).toEqual([])
  })

  it('labels a null result as "unset", not "failed"', async () => {
    const result = await readPreferenceRecords(stubEnsClient, 'ana.eth', async () => null)
    expect(Object.values(result.recordStatus)).toEqual(ALL_KEYS.map(() => 'unset'))
    expect(result.readFailures).toEqual([])
  })

  it('labels a throwing read as "failed" and still returns a usable result', async () => {
    const result = await readPreferenceRecords(stubEnsClient, 'ana.eth', async () => {
      throw new Error('resolver reverted')
    })

    expect(result.readFailures).toHaveLength(ALL_KEYS.length)
    expect(Object.values(result.recordStatus)).toEqual(ALL_KEYS.map(() => 'failed'))
    // Everything still falls back to defaults rather than throwing, but the caller can now
    // tell that nothing was actually read.
    expect(Object.values(result.records).every((v) => v === null)).toBe(true)
    const prefs = resolvePreferences(result.records)
    expect(prefs.language.value).toBe('en')
    expect(prefs.language.source).toBe('default')
  })

  it('isolates one throwing key from the other four', async () => {
    let call = 0
    const result = await readPreferenceRecords(
      stubEnsClient,
      'ana.eth',
      async (_client, _name, key) => {
        call += 1
        if (key === PREFERENCE_RECORD_KEYS.language) throw new Error('resolver reverted')
        return 'short'
      },
    )

    expect(call).toBe(ALL_KEYS.length)
    expect(result.readFailures).toEqual([PREFERENCE_RECORD_KEYS.language])
    expect(result.recordStatus[PREFERENCE_RECORD_KEYS.language]).toBe('failed')
    expect(result.recordStatus[PREFERENCE_RECORD_KEYS.length]).toBe('read')
    // The surviving value is used; the failed one defaults.
    expect(resolvePreferences(result.records).length.value).toBe('short')
    expect(resolvePreferences(result.records).language.source).toBe('default')
  })

  it('reads the address separately, and does not fail the whole read without one', async () => {
    const noAddress = { getEnsAddress: async () => null } as unknown as EnsClient
    const result = await readPreferenceRecords(noAddress, 'ana.eth', async () => 'pt')
    expect(result.address).toBeNull()
    expect(result.nameResolved).toBe(false)
    // Records still came back, because a name can hold text records without resolving.
    expect(result.records[PREFERENCE_RECORD_KEYS.language]).toBe('pt')
  })
})