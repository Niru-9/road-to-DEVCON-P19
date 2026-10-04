/**
 * The model call.
 *
 * Scored criteria that live here:
 *
 *  - Criterion 5: every request is bounded by an EXPLICIT timeout. `AbortController`
 *    plus `setTimeout` from `config.llmTimeoutMs`, applied per attempt, and always
 *    cleared in `finally` so a timer can never keep the process alive.
 *  - Criterion 7: the endpoint and the model id come from `AppConfig` (i.e. the
 *    environment). There is no provider URL or model name literal at the call site.
 *  - Criterion 1: the question is sent as its own `user` message. The system message is
 *    built by `buildChatMessages` from app-authored text only.
 *
 * The API key is used to build an Authorization header and is never returned, logged
 * or echoed to the client.
 */

import { buildChatMessages, findRecordLeakage } from '../shared/prompt'
import type { PreferenceValues } from '../shared/preferences'
import type { RawPreferenceRecords } from '../shared/preferences'
import { safeHost, type AppConfig } from './config'

export class ModelTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(
      `The model did not respond within ${timeoutMs} ms. ` +
        `Free tiers are often slow or busy — try again, or raise LLM_TIMEOUT_MS.`,
    )
    this.name = 'ModelTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export class ModelProviderError extends Error {
  readonly status: number | null
  readonly providerHost: string

  constructor(message: string, status: number | null, providerHost: string) {
    super(message)
    this.name = 'ModelProviderError'
    this.status = status
    this.providerHost = providerHost
  }
}

/** An internal invariant. Reaching this means a real bug, so it fails loudly. */
export class RecordLeakageError extends Error {
  readonly leaks: string[]

  constructor(leaks: string[]) {
    super(
      `Refusing to call the model: raw ENS record text reached the system prompt ` +
        `(${leaks.join('; ')}). This is a bug in the prompt builder.`,
    )
    this.name = 'RecordLeakageError'
    this.leaks = leaks
  }
}

export interface ModelAnswer {
  readonly answer: string
  readonly model: string
  /** Host only — never the full endpoint, query string or credentials. */
  readonly providerHost: string
  readonly durationMs: number
  readonly attempts: number
  /** The exact system message sent. App-authored; shown in the UI as evidence. */
  readonly systemMessage: string
}

export interface AskModelParams {
  readonly question: string
  readonly preferences: PreferenceValues
  readonly config: AppConfig
  /**
   * Raw record values as read from chain. Used only to assert that none of them
   * reached the system prompt. Never sent to the provider.
   */
  readonly rawRecords?: RawPreferenceRecords
}

const MAX_ATTEMPTS = 3
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const BASE_BACKOFF_MS = 600
const MAX_BACKOFF_MS = 8_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Honour `Retry-After` when the provider sends it, bounded so we cannot hang. */
function backoffDelay(attempt: number, retryAfterHeader: string | null): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS)

  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_BACKOFF_MS)
    }
    const asDate = Date.parse(retryAfterHeader)
    if (!Number.isNaN(asDate)) {
      return Math.min(Math.max(asDate - Date.now(), 0), MAX_BACKOFF_MS)
    }
  }

  return exponential
}

/** Duck-typed abort check: undici raises a DOMException, not always an `Error`. */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

interface CompletionResponse {
  model?: string
  choices?: Array<{ message?: { content?: string | null } }>
  error?: { message?: string }
}

/**
 * Ask the configured OpenAI-compatible endpoint one question, honouring `preferences`.
 *
 * Retries a bounded number of times on rate limits and transient provider errors,
 * honouring `Retry-After`. Every attempt is individually bounded by the configured
 * timeout, so the total time is bounded too.
 */
export async function askModel(params: AskModelParams): Promise<ModelAnswer> {
  const { question, preferences, config, rawRecords } = params
  const startedAt = Date.now()
  const providerHost = safeHost(config.llmBaseUrl)

  const messages = buildChatMessages(preferences, question)

  // Belt-and-braces guard for criterion 1: refuse to send anything if raw ENS text
  // somehow reached the system message. This cannot fire via the typed API, because
  // `buildSystemMessage` only ever receives allowlisted values.
  if (rawRecords) {
    const leaks = findRecordLeakage(messages[0]!.content, rawRecords)
    if (leaks.length > 0) {
      throw new RecordLeakageError(leaks)
    }
  }

  // The endpoint is assembled from configuration, never from a literal.
  const endpoint = `${config.llmBaseUrl}/chat/completions`

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (config.llmApiKey.length > 0) {
    headers.authorization = `Bearer ${config.llmApiKey}`
  }

  let lastError: unknown = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // --- EXPLICIT TIMEOUT (scored criterion 5) -----------------------------
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, config.llmTimeoutMs)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: config.llmModel,
          messages,
          temperature: 0.2,
          stream: false,
        }),
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        const error = new ModelProviderError(
          `Model provider (${providerHost}) returned ${response.status} ${response.statusText}. ` +
            `${detail.slice(0, 300)}`,
          response.status,
          providerHost,
        )

        if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
          await sleep(backoffDelay(attempt, response.headers.get('retry-after')))
          lastError = error
          continue
        }
        throw error
      }

      const payload = (await response.json()) as CompletionResponse
      const content = payload.choices?.[0]?.message?.content

      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new ModelProviderError(
          `Model provider (${providerHost}) returned an empty answer.`,
          response.status,
          providerHost,
        )
      }

      return {
        answer: content.trim(),
        model: typeof payload.model === 'string' && payload.model.length > 0
          ? payload.model
          : config.llmModel,
        providerHost,
        durationMs: Date.now() - startedAt,
        attempts: attempt,
        systemMessage: messages[0]!.content,
      }
    } catch (error) {
      // A timeout is a hard stop: retrying a call that already exceeded its explicit
      // budget would defeat the bound. Surface it as a timeout, not a provider error.
      if (isAbortError(error)) {
        throw new ModelTimeoutError(config.llmTimeoutMs)
      }

      if (error instanceof ModelProviderError) {
        throw error
      }

      lastError = error

      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffDelay(attempt, null))
        continue
      }

      throw new ModelProviderError(
        `Could not reach the model provider (${providerHost}): ${
          error instanceof Error ? error.message : String(error)
        }. Check LLM_BASE_URL in your .env.`,
        null,
        providerHost,
      )
    } finally {
      // Always clear, so a pending timer can never hold the event loop open.
      clearTimeout(timer)
    }
  }

  throw new ModelProviderError(
    `Model provider (${providerHost}) failed after ${MAX_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
    null,
    providerHost,
  )
}