/**
 * The API.
 *
 * A server-side boundary exists for one reason: the model credentials must never reach
 * the browser. The browser bundle contains no API key, no provider endpoint and no RPC
 * URL. Everything below runs in Node.
 *
 * The request flow for a real ENS name is:
 *
 *   raw name
 *     -> normalizeEnsName()            ENSIP-15, before any resolution call  [criterion 4]
 *     -> readPreferenceRecords()       five record keys via the Universal Resolver
 *     -> resolvePreferences()          closed allowlist + named defaults     [criteria 2,3]
 *     -> buildChatMessages()           app-authored system + separate user [criterion 1]
 *     -> askModel()                    configured endpoint, explicit timeout [criteria 5,7]
 *
 * Read-only lookups never require a connected wallet. MetaMask is an optional
 * convenience in the UI that can prefill the name field; nothing here reads it.
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'

import { ConfigError, getConfig, toPublicConfigView, type AppConfig } from './config'
import {
  InvalidEnsNameError,
  createEnsClient,
  normalizeEnsName,
  readPreferenceRecords,
  type EnsClient,
} from './ens'
import {
  ModelProviderError,
  ModelTimeoutError,
  RecordLeakageError,
  askModel,
} from './llm'
import {
  DEMO_PROFILES,
  getDemoProfile,
  profileToRawRecords,
  type DemoProfile,
} from '../shared/demo-names'
import {
  DEFAULT_PREFERENCE_LABELS,
  PREFERENCE_RECORD_KEYS,
  resolvePreferences,
  toPreferenceValues,
  type EffectivePreferences,
  type PreferenceField,
  type RawPreferenceRecords,
} from '../shared/preferences'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolvePath(here, '..', '..')

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

interface PreferenceView {
  field: PreferenceField
  recordKey: string
  /** The validated value, human readable. */
  displayValue: string
  source: 'record' | 'default'
  fallbackReason?: string
  appliedDefault: string
  defaultLabel: string
  discardedTokens?: readonly string[]
}

function describeAvoid(prefs: EffectivePreferences): string {
  return prefs.avoid.value.length > 0 ? prefs.avoid.value.join(', ') : 'no restrictions'
}

function toPreferenceView(prefs: EffectivePreferences): PreferenceView[] {
  const fields = Object.keys(PREFERENCE_RECORD_KEYS) as PreferenceField[]
  return fields.map((field) => {
    const resolved = prefs[field] as EffectivePreferences[PreferenceField]
    return {
      field,
      recordKey: resolved.recordKey,
      displayValue: field === 'avoid' ? describeAvoid(prefs) : String(resolved.value),
      source: resolved.source,
      fallbackReason: resolved.fallbackReason,
      appliedDefault: resolved.appliedDefault,
      defaultLabel: DEFAULT_PREFERENCE_LABELS[field],
      discardedTokens: resolved.discardedTokens,
    }
  })
}

interface ResolvedSource {
  /** 'ens' = live Sepolia read. 'sample' = labelled sample profile, not chain data. */
  kind: 'ens' | 'sample'
  ensName: string
  address: string | null
  nameResolved: boolean
  readFailures: readonly string[]
  records: Readonly<Record<string, string | null>>
  /** Per-key outcome: 'read' | 'unset' | 'failed'. Lets the UI tell "never set" from "read errored". */
  recordStatus: Readonly<Record<string, string | null>>
  preferences: PreferenceView[]
  /** Number of preferences that came from a record rather than a default. */
  fromRecordCount: number
  defaultCount: number
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

const askSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  profileId: z.string().trim().min(1).max(40).optional(),
  question: z.string().trim().min(1).max(2_000),
})

const resolveSchema = z.object({
  name: z.string().trim().min(1).max(200),
})

function fail(res: Response, status: number, code: string, message: string, extra?: unknown): void {
  res.status(status).json({ error: { code, message, ...(extra ? { detail: extra } : {}) } })
}

/**
 * Client errors raised before a route handler ever runs.
 *
 * `express.json()` rejects a body it cannot parse, one that is not a JSON object, one that is too
 * large and one with an unsupported charset. It does that by calling `next(err)`, which skips
 * every route, so without this handler Express's `finalhandler` answers with an HTML page and the
 * endpoint's `{error:{code,message}}` contract silently stops holding — a 400 with no code and
 * nothing actionable for the caller to show.
 *
 * `error.type` is the http-errors type; anything unrecognised falls back to the error's own status
 * and a generic message, so an unmapped failure can never surface an internal string.
 */
const BODY_ERRORS: Readonly<Record<string, { status: number; code: string; message: string }>> = {
  'entity.parse.failed': {
    status: 400,
    code: 'MALFORMED_JSON',
    message:
      'The request body is not valid JSON. Send a JSON object such as {"name":"ana.eth"} with ' +
      'Content-Type: application/json.',
  },
  'entity.verify.failed': {
    status: 400,
    code: 'MALFORMED_JSON',
    message: 'The request body could not be read. Send a JSON object such as {"name":"ana.eth"}.',
  },
  'request.aborted': {
    status: 400,
    code: 'REQUEST_ABORTED',
    message: 'The request was aborted before the body was received. Send it again.',
  },
  'request.size.invalid': {
    status: 400,
    code: 'MALFORMED_REQUEST',
    message: 'The request declared a body length that does not match what was sent.',
  },
  'entity.too.large': {
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
    message: 'The request body is larger than the 64 kB limit. Send only the fields the API needs.',
  },
  'parameters.too.many': {
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
    message: 'The request body is larger than the 64 kB limit. Send only the fields the API needs.',
  },
  'encoding.unsupported': {
    status: 415,
    code: 'UNSUPPORTED_ENCODING',
    message: 'That content encoding is not supported. Send the body unencoded.',
  },
  'charset.unsupported': {
    status: 415,
    code: 'UNSUPPORTED_CHARSET',
    message: 'That charset is not supported. Send UTF-8 JSON with Content-Type: application/json.',
  },
}

function describeBodyError(error: unknown): { status: number; code: string; message: string } {
  const type = (error as { type?: unknown } | null)?.type
  if (typeof type === 'string') {
    const mapped = BODY_ERRORS[type]
    if (mapped) return mapped
  }
  const status = (error as { status?: unknown; statusCode?: unknown } | null)?.status
  return {
    status: typeof status === 'number' && status >= 400 && status < 600 ? status : 400,
    code: 'BAD_REQUEST',
    message: 'The request could not be read. Send a JSON object such as {"name":"ana.eth"}.',
  }
}

/**
 * Last-resort handler for `/api`, so every response on this API is the documented JSON envelope.
 *
 * It logs the method, the path and the error type, and nothing else: never the body, never the
 * headers, never the message of an unexpected error. A request body can carry anything a caller
 * chose to put there, so echoing or logging it could put a credential in a log file.
 */
function apiErrorHandler() {
  return (error: unknown, req: Request, res: Response, next: (err?: unknown) => void): void => {
    if (res.headersSent) {
      next(error)
      return
    }

    const described = describeBodyError(error)
    const type = (error as { type?: unknown } | null)?.type ?? 'unknown'
    // baseUrl + path, never originalUrl: the mount prefix is restored without pulling in the
    // query string, which a caller could use to carry anything.
    console.warn(
      `[api] ${req.method} ${req.baseUrl}${req.path} -> ${described.status} ${described.code} (${type})`,
    )

    fail(res, described.status, described.code, described.message)
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function createApp(config: AppConfig) {
  const app = express()
  app.use(express.json({ limit: '64kb' }))

  const ensClient: EnsClient = createEnsClient(config.sepoliaRpcUrl, config.rpcTimeoutMs)

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      chain: 'sepolia',
      chainId: 11155111,
      config: toPublicConfigView(config),
      preferenceNamespace: PREFERENCE_RECORD_KEYS,
    })
  })

  /** Sample profiles, for the clearly-labelled offline demo. Never chain data. */
  app.get('/api/demo/profiles', (_req: Request, res: Response) => {
    if (!config.allowDemoFixtures) {
      fail(res, 404, 'SAMPLES_DISABLED', 'Sample profiles are disabled (ALLOW_DEMO_FIXTURES=false).')
      return
    }
    res.json({
      notice:
        'Sample profiles are SIMULATED record sets, not read from Sepolia. They exist so the ' +
        'demo and the recorded cases are reproducible without a funded wallet. A real ENS name ' +
        'is always read live from chain.',
      publishedOnChain: DEMO_PROFILES.every((p) => p.publishedOnChain),
      profiles: DEMO_PROFILES.map((profile: DemoProfile) => ({
        id: profile.id,
        ensName: profile.ensName,
        title: profile.title,
        persona: profile.persona,
        publishedOnChain: profile.publishedOnChain,
        demonstrates: profile.demonstrates,
        records: profile.records,
      })),
    })
  })

  app.post('/api/preferences/resolve', (req: Request, res: Response) => {
    const parsed = resolveSchema.safeParse(req.body)
    if (!parsed.success) {
      fail(res, 400, 'BAD_REQUEST', 'Provide a name, for example "ana.eth".', parsed.error.issues)
      return
    }

    try {
      // ENSIP-15 normalization happens here, before any resolution call.
      const normalizedName = normalizeEnsName(parsed.data.name)
      void readPreferenceRecords(ensClient, normalizedName)
        .then((result) => {
          const prefs = resolvePreferences(result.records)
          const views = toPreferenceView(prefs)
          res.json({
            kind: 'ens',
            ensName: result.normalizedName,
            address: result.address,
            nameResolved: result.nameResolved,
            readFailures: result.readFailures,
            records: result.records,
            recordStatus: result.recordStatus,
            preferences: views,
            fromRecordCount: views.filter((v) => v.source === 'record').length,
            defaultCount: views.filter((v) => v.source === 'default').length,
          } satisfies ResolvedSource)
        })
        .catch((error: unknown) => {
          handleUnexpected(res, error)
        })
    } catch (error) {
      if (error instanceof InvalidEnsNameError) {
        fail(res, 400, 'INVALID_ENS_NAME', error.message)
        return
      }
      handleUnexpected(res, error)
    }
  })

  app.post('/api/ask', (req: Request, res: Response) => {
    const parsed = askSchema.safeParse(req.body)
    if (!parsed.success) {
      fail(res, 400, 'BAD_REQUEST', 'Provide a name (or a sample profile) and a question.', parsed.error.issues)
      return
    }

    const { name, profileId, question } = parsed.data

    if (!name && !profileId) {
      fail(res, 400, 'BAD_REQUEST', 'Provide either an ENS name or a sample profile id.')
      return
    }

    if (profileId && !config.allowDemoFixtures) {
      fail(res, 404, 'SAMPLES_DISABLED', 'Sample profiles are disabled (ALLOW_DEMO_FIXTURES=false).')
      return
    }

    if (profileId) {
      const profile = getDemoProfile(profileId)
      if (!profile) {
        fail(res, 404, 'UNKNOWN_PROFILE', `No sample profile with id "${profileId}".`)
        return
      }
      void answerForSample(res, config, profile, question)
      return
    }

    try {
      const normalizedName = normalizeEnsName(name!)
      void (async () => {
        const result = await readPreferenceRecords(ensClient, normalizedName)
        await answerForResolved(res, config, {
          kind: 'ens',
          ensName: result.normalizedName,
          address: result.address,
          nameResolved: result.nameResolved,
          readFailures: result.readFailures,
          records: result.records,
          recordStatus: result.recordStatus,
        }, question)
      })().catch((error: unknown) => handleUnexpected(res, error))
    } catch (error) {
      if (error instanceof InvalidEnsNameError) {
        fail(res, 400, 'INVALID_ENS_NAME', error.message)
        return
      }
      handleUnexpected(res, error)
    }
  })

  async function answerForSample(
    res: Response,
    cfg: AppConfig,
    profile: DemoProfile,
    question: string,
  ): Promise<void> {
    await answerForResolved(
      res,
      cfg,
      {
        kind: 'sample',
        ensName: profile.ensName,
        address: null,
        nameResolved: false,
        readFailures: [],
        records: profileToRawRecords(profile),
        recordStatus: Object.fromEntries(
          Object.entries(profileToRawRecords(profile)).map(([key, value]) => [
            key,
            value === null ? 'unset' : 'read',
          ]),
        ),
      },
      question,
      {
        notice:
          `Sample profile "${profile.ensName}" — these records are SIMULATED, not read from ` +
          `Sepolia. The validation, prompt and model code path is identical to a live lookup.`,
        profileId: profile.id,
      },
    )
  }

  async function answerForResolved(
    res: Response,
    cfg: AppConfig,
    source: Omit<ResolvedSource, 'preferences' | 'fromRecordCount' | 'defaultCount'>,
    question: string,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    // --- criteria 2 and 3: validate every record, apply named defaults ---------
    const prefs = resolvePreferences(source.records)
    const views = toPreferenceView(prefs)
    const values = toPreferenceValues(prefs)

    try {
      // --- criteria 1, 5, 7 --------------------------------------------------
      const result = await askModel({
        question,
        preferences: values,
        config: cfg,
        rawRecords: source.records,
      })

      res.json({
        answer: result.answer,
        model: result.model,
        providerHost: result.providerHost,
        durationMs: result.durationMs,
        attempts: result.attempts,
        systemMessage: result.systemMessage,
        question,
        source: {
          ...source,
          preferences: views,
          fromRecordCount: views.filter((v) => v.source === 'record').length,
          defaultCount: views.filter((v) => v.source === 'default').length,
        } satisfies ResolvedSource,
        ...extra,
      })
    } catch (error) {
      if (error instanceof ModelTimeoutError) {
        fail(res, 504, 'MODEL_TIMEOUT', error.message, { timeoutMs: error.timeoutMs })
        return
      }
      if (error instanceof ModelProviderError) {
        fail(res, 502, 'MODEL_ERROR', error.message, { status: error.status })
        return
      }
      if (error instanceof RecordLeakageError) {
        // A real bug. Surface it rather than hiding it.
        fail(res, 500, 'RECORD_LEAKAGE', error.message, { leaks: error.leaks })
        return
      }
      handleUnexpected(res, error)
    }
  }

  function handleUnexpected(res: Response, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    // Node/undici network failures and RPC timeouts land here.
    fail(res, 502, 'UPSTREAM_ERROR', `Could not complete the request: ${message}`)
  }

  // Registered after the routes but before the 404 fallback: an error raised anywhere above
  // (including inside `express.json()`, which runs before every route) arrives here.
  app.use('/api', apiErrorHandler())

  app.use('/api', (_req: Request, res: Response) => {
    fail(res, 404, 'NOT_FOUND', 'Unknown API route.')
  })

  // Serve the built UI when it exists (production / single-port demo).
  const webDist = join(repoRoot, 'dist', 'web')
  if (existsSync(webDist)) {
    app.use(express.static(webDist))
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(join(webDist, 'index.html'))
    })
  }

  return app
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  let config: AppConfig
  try {
    config = getConfig()
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n${error.message}\n`)
      process.exit(1)
    }
    throw error
  }

  const app = createApp(config)
  const view = toPublicConfigView(config)

  app.listen(config.port, () => {
    console.log('')
    console.log('  Portable AI Preferences')
    console.log('  ENS:     Sepolia (chain id 11155111)')
    console.log(`  Model:   ${view.model} @ ${view.providerHost}`)
    console.log(`  Timeout: ${view.timeoutMs} ms per model request`)
    console.log(`  API key: ${view.hasApiKey ? 'present (server-side only)' : 'not set (local provider is fine)'}`)
    console.log(`  RPC:     ${view.rpcHost}`)
    console.log(`  Samples: ${view.allowDemoFixtures ? 'enabled (clearly labelled as simulated)' : 'disabled'}`)
    console.log('')
    console.log(`  ready on http://localhost:${config.port}`)
    console.log('')
  })
}

// Only start listening when executed directly, so tests can import createApp.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolvePath(process.argv[1]) === resolvePath(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  main()
}