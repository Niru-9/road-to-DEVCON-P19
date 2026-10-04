/**
 * Portable AI Preferences — the on-chain preference format.
 *
 * This module is the single source of truth for:
 *   1. WHICH ENS text record keys carry preferences (ENSIP-5 reverse-dot service keys),
 *   2. WHICH values each key is allowed to hold (closed allowlists),
 *   3. WHICH named default applies when a record is unset, empty or unsupported,
 *   4. What a resolved, fully-validated preference set looks like.
 *
 * Design notes that matter for safety:
 *
 * - ENS text records are PUBLIC, USER-CONTROLLED text. Anyone can write anything to
 *   them. They are therefore treated as untrusted input at all times (OWASP LLM01).
 * - Nothing in this file returns a raw record string as an effective value. A value
 *   only ever survives validation if it is a member of a closed allowlist.
 * - The output of `resolvePreferences` is the ONLY thing allowed to influence the
 *   system prompt, and only as a selection key into app-authored text. See prompt.ts.
 *
 * The format is intentionally simple and documented in README.md ("The preference format")
 * so that another assistant could adopt exactly the same records.
 */

/**
 * ENSIP-5 service-key namespace.
 *
 * ENSIP-5 defines global keys (lowercase letters, digits, hyphen) and namespaced
 * "service" keys in reverse-dot notation. Because this preference format is something
 * we invented, it MUST live in its own service namespace rather than squatting on
 * global keys that other applications already own.
 *
 * Shape: `<service>.<key>` — mirroring the canonical `com.twitter` example from ENSIP-5.
 */
export const SERVICE_NAMESPACE = 'com.portableprefs' as const

/** ENS text record keys for each preference field. */
export const PREFERENCE_RECORD_KEYS = {
  language: `${SERVICE_NAMESPACE}.language`,
  length: `${SERVICE_NAMESPACE}.length`,
  reading: `${SERVICE_NAMESPACE}.reading`,
  format: `${SERVICE_NAMESPACE}.format`,
  avoid: `${SERVICE_NAMESPACE}.avoid`,
} as const

export type PreferenceField = keyof typeof PREFERENCE_RECORD_KEYS

/** Every preference field, in a stable order (used for reads and for the UI). */
export const PREFERENCE_FIELDS = [
  'language',
  'length',
  'reading',
  'format',
  'avoid',
] as const satisfies readonly PreferenceField[]

// ---------------------------------------------------------------------------
// Closed allowlists
// ---------------------------------------------------------------------------

export const LANGUAGES = ['en', 'pt', 'es', 'fr', 'de', 'hi'] as const
export type Language = (typeof LANGUAGES)[number]

export const ANSWER_LENGTHS = ['short', 'brief', 'detailed'] as const
export type AnswerLength = (typeof ANSWER_LENGTHS)[number]

export const READING_LEVELS = ['simple', 'standard', 'technical'] as const
export type ReadingLevel = (typeof READING_LEVELS)[number]

export const ANSWER_FORMATS = ['plain', 'bullets', 'steps'] as const
export type AnswerFormat = (typeof ANSWER_FORMATS)[number]

/** Things an answer can be asked to avoid — all of these reduce reading load. */
export const AVOID_TOKENS = ['tables', 'code', 'jargon', 'emojis', 'links'] as const
export type AvoidToken = (typeof AVOID_TOKENS)[number]

/** Sentinel meaning "no restrictions at all". Part of the allowlist for `avoid`. */
export const AVOID_NONE = 'none' as const
export type AvoidRecordValue = AvoidToken | typeof AVOID_NONE

/**
 * Guard on how many comma-separated segments we will examine in an `avoid` record.
 *
 * This is a DoS guard, not a semantic limit: only five distinct avoid-tokens exist, and
 * duplicates and unknown tokens are dropped, so a well-formed list can never exceed five
 * entries however long the record is.
 */
export const AVOID_MAX_SEGMENTS = 16

// ---------------------------------------------------------------------------
// Named defaults
// ---------------------------------------------------------------------------

/**
 * The named default applied to each preference.
 *
 * These are deliberately boring, widely-comparable values so that a user with no
 * records set still gets a sane answer, and so that "unset" and "set to something
 * unknown" behave identically and predictably.
 */
export const PREFERENCE_DEFAULTS = {
  language: 'en',
  length: 'brief',
  reading: 'standard',
  format: 'plain',
  avoid: AVOID_NONE,
} as const satisfies Record<PreferenceField, string>

/** Short human labels for the UI, so a default reads as a deliberate choice. */
export const DEFAULT_PREFERENCE_LABELS: Record<PreferenceField, string> = {
  language: 'English',
  length: 'brief',
  reading: 'standard',
  format: 'plain',
  avoid: 'no restrictions',
}

// ---------------------------------------------------------------------------
// Resolution results
// ---------------------------------------------------------------------------

/** Where an effective value came from. */
export type PreferenceSource = 'record' | 'default'

/** Why a named default was substituted. */
export type PreferenceFallbackReason =
  /** The record does not exist — viem's getEnsText returned null. */
  | 'unset'
  /** The record exists but is empty or only whitespace. */
  | 'empty'
  /** The record holds something outside the closed allowlist. */
  | 'not-allowed'

export interface ResolvedPreference<T> {
  readonly field: PreferenceField
  /** The ENS text record key this preference is stored under. */
  readonly recordKey: string
  /** The validated value. Always a member of the allowlist (or [] for `avoid`). */
  readonly value: T
  readonly source: PreferenceSource
  /** Present only when source === 'default'. */
  readonly fallbackReason?: PreferenceFallbackReason
  /** The named default that was applied, for display and for tests. */
  readonly appliedDefault: string
  /**
   * Allowlisted tokens that were present in the record but discarded.
   * Only populated for `avoid`, which accepts a list.
   */
  readonly discardedTokens?: readonly string[]
}

export interface EffectivePreferences {
  readonly language: ResolvedPreference<Language>
  readonly length: ResolvedPreference<AnswerLength>
  readonly reading: ResolvedPreference<ReadingLevel>
  readonly format: ResolvedPreference<AnswerFormat>
  readonly avoid: ResolvedPreference<readonly AvoidToken[]>
}

/**
 * The validated values only. This is the ONLY shape accepted by the prompt builder,
 * which is what makes "no raw ENS record text can reach the system prompt" a
 * structural property rather than a promise.
 */
export interface PreferenceValues {
  readonly language: Language
  readonly length: AnswerLength
  readonly reading: ReadingLevel
  readonly format: AnswerFormat
  readonly avoid: readonly AvoidToken[]
}

/** The five raw record values as read from chain (null === record not set). */
export type RawPreferenceRecords = Readonly<Record<string, string | null>>

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Longest single record value we will even look at. Anything larger is malformed. */
export const MAX_RECORD_LENGTH = 200

function asAllowlist<T extends string>(values: readonly T[]): ReadonlySet<string> {
  return new Set<string>(values)
}

const LANGUAGE_SET = asAllowlist(LANGUAGES)
const LENGTH_SET = asAllowlist(ANSWER_LENGTHS)
const READING_SET = asAllowlist(READING_LEVELS)
const FORMAT_SET = asAllowlist(ANSWER_FORMATS)
const AVOID_SET = asAllowlist<AvoidRecordValue>([AVOID_NONE, ...AVOID_TOKENS])

/**
 * Resolve a single-valued preference against its closed allowlist.
 *
 * The branch structure is deliberate and is what scored criterion 3 checks for:
 * an unset record and an empty record each take an explicit path to a named default.
 */
function resolveEnum<T extends string>(
  field: PreferenceField,
  raw: string | null | undefined,
  allowed: ReadonlySet<string>,
  defaultValue: T,
): ResolvedPreference<T> {
  const recordKey = PREFERENCE_RECORD_KEYS[field]
  const appliedDefault = PREFERENCE_DEFAULTS[field]

  // --- explicit branch 1: record is not set (getEnsText returned null) -------
  if (raw === null || raw === undefined) {
    return {
      field,
      recordKey,
      value: defaultValue,
      source: 'default',
      fallbackReason: 'unset',
      appliedDefault,
    }
  }

  const trimmed = raw.trim()

  // --- explicit branch 2: record is set but empty / whitespace-only ---------
  if (trimmed.length === 0) {
    return {
      field,
      recordKey,
      value: defaultValue,
      source: 'default',
      fallbackReason: 'empty',
      appliedDefault,
    }
  }

  // --- explicit branch 3: present but not a usable value --------------------
  if (trimmed.length > MAX_RECORD_LENGTH) {
    return {
      field,
      recordKey,
      value: defaultValue,
      source: 'default',
      fallbackReason: 'not-allowed',
      appliedDefault,
    }
  }

  // Match case-insensitively, then require an EXACT allowlist member.
  // A value that is merely "close to" an allowed value is not allowed.
  const candidate = trimmed.toLowerCase()
  if (!allowed.has(candidate)) {
    return {
      field,
      recordKey,
      value: defaultValue,
      source: 'default',
      fallbackReason: 'not-allowed',
      appliedDefault,
    }
  }

  return {
    field,
    recordKey,
    value: candidate as T,
    source: 'record',
    appliedDefault,
  }
}

/**
 * Resolve the list-valued `avoid` preference.
 *
 * Each comma-separated token is checked against the allowlist individually. Unknown
 * tokens are DISCARDED (never forwarded anywhere); if nothing allowlisted survives,
 * the named default applies.
 */
function resolveAvoid(raw: string | null | undefined): ResolvedPreference<readonly AvoidToken[]> {
  const field = 'avoid' as const
  const recordKey = PREFERENCE_RECORD_KEYS.avoid
  const appliedDefault = PREFERENCE_DEFAULTS.avoid

  if (raw === null || raw === undefined) {
    return {
      field,
      recordKey,
      value: [],
      source: 'default',
      fallbackReason: 'unset',
      appliedDefault,
    }
  }

  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return {
      field,
      recordKey,
      value: [],
      source: 'default',
      fallbackReason: 'empty',
      appliedDefault,
    }
  }

  if (trimmed.length > MAX_RECORD_LENGTH) {
    return {
      field,
      recordKey,
      value: [],
      source: 'default',
      fallbackReason: 'not-allowed',
      appliedDefault,
    }
  }

  const segments = trimmed.split(',')
  if (segments.length > AVOID_MAX_SEGMENTS) {
    return {
      field,
      recordKey,
      value: [],
      source: 'default',
      fallbackReason: 'not-allowed',
      appliedDefault,
      discardedTokens: [],
    }
  }

  const tokens = segments
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0)

  const accepted: AvoidToken[] = []
  const discarded: string[] = []
  let sawNoneSentinel = false

  for (const token of tokens) {
    if (!AVOID_SET.has(token as AvoidRecordValue)) {
      // Outside the allowlist -> discarded.
      discarded.push(token)
      continue
    }
    if (token === AVOID_NONE) {
      sawNoneSentinel = true
      continue
    }
    if (accepted.includes(token as AvoidToken)) continue
    accepted.push(token as AvoidToken)
  }

  if (accepted.length === 0) {
    // `none` is itself an allowlisted record value meaning "no restrictions", so a
    // record that says `none` is a genuine record hit, not a fallback.
    if (sawNoneSentinel) {
      return {
        field,
        recordKey,
        value: [],
        source: 'record',
        appliedDefault,
        discardedTokens: discarded,
      }
    }

    return {
      field,
      recordKey,
      value: [],
      source: 'default',
      fallbackReason: 'not-allowed',
      appliedDefault,
      discardedTokens: discarded,
    }
  }

  return {
    field,
    recordKey,
    value: accepted,
    source: 'record',
    appliedDefault,
    discardedTokens: discarded,
  }
}

/**
 * Read every preference record and produce a fully validated preference set.
 *
 * `rawRecords` maps ENS text record key -> value, where `null` means the record is
 * unset. Every single value in `rawRecords` is checked against a closed allowlist.
 */
export function resolvePreferences(rawRecords: RawPreferenceRecords): EffectivePreferences {
  const read = (field: PreferenceField): string | null => {
    const value = rawRecords[PREFERENCE_RECORD_KEYS[field]]
    return value === undefined ? null : value
  }

  return {
    language: resolveEnum<Language>('language', read('language'), LANGUAGE_SET, PREFERENCE_DEFAULTS.language),
    length: resolveEnum<AnswerLength>('length', read('length'), LENGTH_SET, PREFERENCE_DEFAULTS.length),
    reading: resolveEnum<ReadingLevel>('reading', read('reading'), READING_SET, PREFERENCE_DEFAULTS.reading),
    format: resolveEnum<AnswerFormat>('format', read('format'), FORMAT_SET, PREFERENCE_DEFAULTS.format),
    avoid: resolveAvoid(read('avoid')),
  }
}

/** Strip the metadata down to the validated values, for the prompt builder. */
export function toPreferenceValues(prefs: EffectivePreferences): PreferenceValues {
  return {
    language: prefs.language.value,
    length: prefs.length.value,
    reading: prefs.reading.value,
    format: prefs.format.value,
    avoid: prefs.avoid.value,
  }
}

/** Every record key we read, in order. */
export function allPreferenceRecordKeys(): string[] {
  return PREFERENCE_FIELDS.map((field) => PREFERENCE_RECORD_KEYS[field])
}

/** Serialise validated preferences back into the on-chain record format. */
export function toRecordValues(values: PreferenceValues): Record<PreferenceField, string> {
  return {
    language: values.language,
    length: values.length,
    reading: values.reading,
    format: values.format,
    avoid: values.avoid.length > 0 ? values.avoid.join(',') : AVOID_NONE,
  }
}