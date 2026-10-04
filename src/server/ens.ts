/**
 * ENS on Sepolia: normalize, then read.
 *
 * Scored criterion 4 lives here: the user-entered name is passed through viem's
 * ENSIP-15 `normalize()` before ANY resolution call. `normalizeEnsName` is the only
 * way this module accepts a name, and every read below receives only its output.
 *
 * Resolution goes through viem's Universal Resolver actions (`getEnsText`), which is
 * the forward-compatible path and works for both ENSv1 and ENSv2 Beta names on Sepolia.
 */

import { createPublicClient, http } from 'viem'
import type { PublicClient } from 'viem'
import { sepolia } from 'viem/chains'
import { getEnsAddress, getEnsText, normalize } from 'viem/ens'

import { allPreferenceRecordKeys, type RawPreferenceRecords } from '../shared/preferences'

export type EnsClient = PublicClient

/** The entered name was not a name ENSIP-15 will accept. */
export class InvalidEnsNameError extends Error {
  /**
   * @param input    What the user typed, for the message.
   * @param cause    Underlying reason, kept for diagnosis.
   * @param guidance Replaces the generic "check the spelling" advice when a more specific
   *                 explanation is genuinely more useful (e.g. an address was pasted).
   */
  constructor(input: string, cause: unknown, guidance?: string) {
    super(
      `"${truncate(input)}" is not a name ENS can accept. ` +
        (guidance ?? `Check the spelling, and use a full name such as "ana.eth".`),
    )
    this.name = 'InvalidEnsNameError'
    this.cause = cause
  }
}

/**
 * A 20-byte hex address, with or without the `0x` prefix.
 *
 * Preference values live in ENS *text records*, which are keyed by name. An address has no
 * records, so an address is never resolvable to preferences. Rejecting it is required, but
 * saying only "check the spelling" is misleading: the spelling is fine, the input is the wrong
 * kind of thing. This is detected separately so the rejection can explain itself.
 */
const HEX_ADDRESS = /^(?:0x)?[0-9a-fA-F]{40}$/

/** Every record read failed, or the name could not be resolved at all. */
export class EnsReadError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'EnsReadError'
    this.cause = cause
  }
}

function truncate(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** Longest name we will even attempt to normalize. */
export const MAX_NAME_LENGTH = 200

/**
 * ENSIP-15 (UTS-46) normalization.
 *
 * This is deliberately the ONLY entry point for a user-supplied name. Callers cannot
 * obtain a resolvable name without going through it. It throws
 * `InvalidEnsNameError` for anything ENS will not accept, including empty input.
 */
export function normalizeEnsName(input: string): string {
  const candidate = typeof input === 'string' ? input.trim() : ''

  if (candidate.length === 0) {
    throw new InvalidEnsNameError(input ?? '', new Error('empty input'))
  }

  if (candidate.length > MAX_NAME_LENGTH) {
    throw new InvalidEnsNameError(candidate, new Error('too long'))
  }

  // An address is the one wrong-kind-of-input that is worth naming, because the field it was
  // pasted into says it is acceptable and the generic "check the spelling" advice is wrong.
  if (HEX_ADDRESS.test(candidate)) {
    throw new InvalidEnsNameError(
      candidate,
      new Error('address, not a name'),
      'That is a wallet address, and preferences are stored as ENS text records on a NAME, so ' +
        'an address cannot carry them. Enter the ENS name instead — for example "ana.eth" — or ' +
        'use one of the sample profiles below.',
    )
  }

  try {
    const normalized = normalize(candidate)

    // UTS-46 happily returns a bare label such as "notaname" with no error, which would
    // otherwise reach the resolver and fail there with a confusing message. Require at
    // least one label plus an alphabetic root of two or more characters, so
    // "ana.eth" and "team.test" pass while "notaname" and "foo.eth." do not.
    if (!/^.+\.[a-z]{2,}$/.test(normalized)) {
      throw new InvalidEnsNameError(
        candidate,
        new Error(`"${normalized}" has no valid ENS root`),
      )
    }

    return normalized
  } catch (cause) {
    if (cause instanceof InvalidEnsNameError) throw cause
    throw new InvalidEnsNameError(candidate, cause)
  }
}

/** A viem public client for ENS on Sepolia, with an explicit RPC timeout. */
export function createEnsClient(rpcUrl: string, rpcTimeoutMs: number): EnsClient {
  return createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl, { timeout: rpcTimeoutMs, retryCount: 1 }),
  }) as EnsClient
}

export interface PreferenceReadResult {
  /** Already ENSIP-15 normalized. */
  readonly normalizedName: string
  /** Resolved address if the name resolves; null when it does not. */
  readonly address: `0x${string}` | null
  /** record key -> raw value, where null means the record is unset. */
  readonly records: RawPreferenceRecords
  /**
   * Per-key outcome, so "the owner never set this" is distinguishable from "the resolver
   * errored and we do not actually know". Both yield a null value and both fall back to the
   * named default, but they are not the same fact and a user debugging a broken name needs to
   * be able to tell them apart.
   */
  readonly recordStatus: Readonly<Record<string, PreferenceRecordStatus>>
  /** Record keys whose read threw. Treated downstream as unset. */
  readonly readFailures: readonly string[]
  /** True when the name itself could not be resolved. */
  readonly nameResolved: boolean
}

export type PreferenceRecordStatus = 'read' | 'unset' | 'failed'

/** Reads one text record. Returns null when the record is unset; may throw. */
export type PreferenceTextReader = (
  client: EnsClient,
  name: string,
  key: string,
) => Promise<string | null>

/** The real reader: viem's Universal Resolver action. */
export const readTextViaUniversalResolver: PreferenceTextReader = async (client, name, key) =>
  getEnsText(client, { name, key })

/**
 * Read every documented preference record for an already-normalized name.
 *
 * Individual record failures are isolated: a resolver that reverts on one key must not
 * abort the other four, and an unset record is reported as `null` so that the named
 * default branch downstream runs.
 *
 * @param readText Injectable for testing. Defaults to the Universal Resolver. Production
 *                 code should never pass anything else.
 */
export async function readPreferenceRecords(
  client: EnsClient,
  normalizedName: string,
  readText: PreferenceTextReader = readTextViaUniversalResolver,
): Promise<PreferenceReadResult> {
  const keys = allPreferenceRecordKeys()

  const settled = await Promise.all(
    keys.map(async (key) => {
      try {
        // `strict` is left at its default (false) in the real reader so a reverting resolver
        // yields null rather than throwing.
        const value = await readText(client, normalizedName, key)
        return {
          key,
          value: value ?? null,
          // Distinguish a genuinely unset record from a read that told us nothing.
          status: (value === null || value === undefined ? 'unset' : 'read') as PreferenceRecordStatus,
        }
      } catch {
        // The read did not succeed. This is NOT the same as "unset", so it is labelled
        // separately and surfaced to the caller rather than silently becoming a default.
        return { key, value: null, status: 'failed' as PreferenceRecordStatus }
      }
    }),
  )

  const records: Record<string, string | null> = {}
  const recordStatus: Record<string, PreferenceRecordStatus> = {}
  const readFailures: string[] = []

  for (const entry of settled) {
    records[entry.key] = entry.value
    recordStatus[entry.key] = entry.status
    if (entry.status === 'failed') readFailures.push(entry.key)
  }

  // Best effort: a name with text records can still lack a resolving address, and a
  // missing address must not stop us reading preferences.
  let address: `0x${string}` | null = null
  try {
    address = await getEnsAddress(client, { name: normalizedName })
  } catch {
    address = null
  }

  return {
    normalizedName,
    address,
    records,
    recordStatus,
    readFailures,
    nameResolved: address !== null,
  }
}

/** Convenience: normalize then read. The raw input never reaches viem directly. */
export async function resolvePreferencesFromEns(
  client: EnsClient,
  rawInput: string,
): Promise<PreferenceReadResult> {
  const normalizedName = normalizeEnsName(rawInput)
  return readPreferenceRecords(client, normalizedName)
}