/**
 * The browser UI.
 *
 * Deliberate constraints, all of which are acceptance criteria:
 *
 *   - This bundle holds NO credential. No API key, no provider endpoint, no RPC URL.
 *     Everything sensitive is fetched per-request from this app's own `/api/*` routes.
 *     (criterion 8)
 *   - Read-only lookups never require a wallet. `Connect` is optional for reading; it is
 *     required only to PUBLISH records, which is the one thing that spends gas.
 *   - Publishing is signed by MetaMask. No key material exists in this bundle, in `.env`,
 *     or anywhere else in this repository — the wallet holds it and does the signing.
 *   - The "system message" is shown to the user verbatim, so it is inspectable that only
 *     app-authored literals and allowlisted values are in it. (criterion 1)
 *   - Sample profiles are labelled SIMULATED wherever they appear, because they are not
 *     chain data.
 */

import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import './styles.css'

import { planRecordWrites } from '../shared/ens-write'
import { getDemoProfile } from '../shared/demo-names'
import {
  connectWallet,
  describeOwnershipWarning,
  getInjectedProvider,
  shortenAddress,
  subscribeToWallet,
  switchToSepolia,
  WalletError,
  type WalletConnection,
} from './wallet'

// ---------------------------------------------------------------------------
// Types mirroring the server response shapes
// ---------------------------------------------------------------------------

interface PreferenceView {
  field: string
  recordKey: string
  displayValue: string
  source: 'record' | 'default'
  fallbackReason?: string
  appliedDefault: string
  defaultLabel: string
  discardedTokens?: readonly string[]
}

interface ResolvedSource {
  kind: 'ens' | 'sample'
  ensName: string
  address: string | null
  nameResolved: boolean
  readFailures: readonly string[]
  records: Readonly<Record<string, string | null>>
  recordStatus: Readonly<Record<string, string | null>>
  preferences: readonly PreferenceView[]
  fromRecordCount: number
  defaultCount: number
}

interface PublicConfigView {
  model: string
  providerHost: string
  rpcHost: string
  timeoutMs: number
  hasApiKey: boolean
  allowDemoFixtures: boolean
  port: number
}

interface HealthResponse {
  ok: boolean
  chain: string
  chainId: number
  config: PublicConfigView
  preferenceNamespace: Readonly<Record<string, string>>
}

interface SampleProfile {
  id: string
  ensName: string
  title: string
  persona: string
  publishedOnChain: boolean
  demonstrates: string
  records: Readonly<Record<string, string>>
}

interface SamplesResponse {
  notice: string
  publishedOnChain: boolean
  profiles: readonly SampleProfile[]
}

interface AskResponse {
  answer: string
  model: string
  providerHost: string
  durationMs: number
  attempts: number
  systemMessage: string
  question: string
  source: ResolvedSource
  notice?: string
}

interface ApiError {
  error: { code: string; message: string; detail?: unknown }
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function callApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await response.text()
  let parsed: unknown
  try {
    parsed = text.length > 0 ? JSON.parse(text) : {}
  } catch {
    throw new ApiFailure(
      `The server returned a non-JSON response (HTTP ${response.status}).`,
      'BAD_RESPONSE',
    )
  }

  if (!response.ok) {
    const failure = parsed as ApiError
    throw new ApiFailure(
      failure?.error?.message ?? `Request failed with HTTP ${response.status}.`,
      failure?.error?.code ?? 'HTTP_ERROR',
    )
  }

  return parsed as T
}

class ApiFailure extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'ApiFailure'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'
  children: React.ReactNode
}) {
  return <span className={`badge ${tone === 'neutral' ? '' : tone}`}>{children}</span>
}

function Note({ tone, children }: { tone: 'info' | 'warn' | 'error'; children: React.ReactNode }) {
  return <div className={`note ${tone}`}>{children}</div>
}

function PreferenceGrid({ source }: { source: ResolvedSource }) {
  return (
    <div className="pref-grid">
      {source.preferences.map((preference) => (
        <div
          key={preference.field}
          className={`pref ${preference.source === 'record' ? 'record' : ''}`}
        >
          <div className="k">{preference.recordKey}</div>
          <div className="v">{preference.displayValue}</div>
          <div className="src">
            {preference.source === 'record' ? (
              'from ENS record'
            ) : (
              <>default — {preference.defaultLabel}</>
            )}
          </div>
          {preference.fallbackReason ? (
            <div className="src">
              ignored “{preference.fallbackReason.length > 48
                ? `${preference.fallbackReason.slice(0, 48)}…`
                : preference.fallbackReason}”
            </div>
          ) : null}
          {preference.discardedTokens && preference.discardedTokens.length > 0 ? (
            <div className="src">
              dropped not-allowed: {preference.discardedTokens.join(', ')}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function SourceSummary({ source }: { source: ResolvedSource }) {
  return (
    <div className="meta">
      <span>
        {source.fromRecordCount} from record · {source.defaultCount} default
      </span>
      <span>
        {source.fromRecordCount}/{source.preferences.length} preferences read from{' '}
        {source.kind === 'ens' ? 'Sepolia' : 'sample records'}
      </span>
      {source.address ? <span>address {source.address}</span> : null}
      {source.readFailures.length > 0 ? (
        <span>read failures: {source.readFailures.join(', ')}</span>
      ) : null}
    </div>
  )
}

/**
 * A resolver that reverts is NOT the same as a record the owner never set. Both fall back to
 * the named default, but silently showing a default for a failed read would hide a real
 * problem, so it is called out.
 */
function ReadFailureWarning({ source }: { source: ResolvedSource }) {
  if (source.kind !== 'ens' || source.readFailures.length === 0) return null
  return (
    <div style={{ marginTop: 12 }}>
      <Note tone="warn">
        <strong>{source.readFailures.length} record read(s) failed on chain</strong> —{' '}
        {source.readFailures.join(', ')}. The named defaults are shown below because the read
        errored, <em>not</em> because the owner left them unset. The values below may therefore
        be wrong. Check that {source.ensName} has a working resolver.
      </Note>
    </div>
  )
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)

  const [samples, setSamples] = useState<SamplesResponse | null>(null)

  const [name, setName] = useState('')
  const [resolved, setResolved] = useState<ResolvedSource | null>(null)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)

  const [selectedProfile, setSelectedProfile] = useState<string | null>(null)
  const [question, setQuestion] = useState(
    'Explain how a Merkle proof proves membership of a transaction.',
  )
  const [answer, setAnswer] = useState<AskResponse | null>(null)
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)

  const [account, setAccount] = useState<string | null>(null)
  const [walletChain, setWalletChain] = useState<WalletConnection | null>(null)
  const [walletError, setWalletError] = useState<string | null>(null)
  const [walletBusy, setWalletBusy] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishResults, setPublishResults] = useState<
    readonly { key: string; outcome: string; txHash: string | null; message: string | null }[]
  >([])
  const [publishWarning, setPublishWarning] = useState<string | null>(null)
  const walletProvider = useRef(getInjectedProvider())

  useEffect(() => {
    let cancelled = false
    void callApi<HealthResponse>('/api/health')
      .then((value) => {
        if (!cancelled) setHealth(value)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setHealthError(
            error instanceof Error ? error.message : 'Could not reach the API server.',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void callApi<SamplesResponse>('/api/demo/profiles')
      .then((value) => {
        if (!cancelled) setSamples(value)
      })
      .catch(() => {
        if (!cancelled) setSamples(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const onLookup = useCallback(async () => {
    const trimmed = name.trim()
    if (trimmed.length === 0) return
    setResolving(true)
    setResolveError(null)
    setAnswer(null)
    try {
      // The server normalizes (ENSIP-15) before any resolution call.
      const source = await callApi<ResolvedSource>('/api/preferences/resolve', { name: trimmed })
      setResolved(source)
    } catch (error: unknown) {
      setResolved(null)
      setResolveError(error instanceof Error ? error.message : String(error))
    } finally {
      setResolving(false)
    }
  }, [name])

  const onAsk = useCallback(async () => {
    const trimmedQuestion = question.trim()
    if (trimmedQuestion.length === 0) return
    setAsking(true)
    setAskError(null)
    try {
      const payload: Record<string, string> =
        selectedProfile !== null
          ? { profileId: selectedProfile, question: trimmedQuestion }
          : { name: name.trim(), question: trimmedQuestion }

      const result = await callApi<AskResponse>('/api/ask', payload)
      setAnswer(result)
      setResolved(result.source)
    } catch (error: unknown) {
      setAnswer(null)
      setAskError(error instanceof Error ? error.message : String(error))
    } finally {
      setAsking(false)
    }
  }, [name, question, selectedProfile])

  /**
   * Connect for the purpose of PUBLISHING.
   *
   * Reading preferences never needs this. Connecting does not require Sepolia — that is
   * reported separately, because "wrong network" has a different fix from "not connected".
   */
  const onConnectForPublish = useCallback(async () => {
    const provider = walletProvider.current
    if (provider === null) {
      setWalletError(
        'No browser wallet detected. Install MetaMask to publish records. Reading preferences needs no wallet.',
      )
      return
    }
    setWalletBusy(true)
    setWalletError(null)
    try {
      const connection = await connectWallet(provider)
      setWalletChain(connection)
      setAccount(connection.address)
    } catch (error: unknown) {
      setWalletChain(null)
      setAccount(null)
      setWalletError(
        error instanceof WalletError ? error.message : 'Could not connect to your wallet.',
      )
    } finally {
      setWalletBusy(false)
    }
  }, [])

  const onSwitchToSepolia = useCallback(async () => {
    const provider = walletProvider.current
    if (provider === null) return
    setWalletBusy(true)
    setWalletError(null)
    try {
      await switchToSepolia(provider)
      // Re-read the chain rather than assuming the switch worked.
      const connection = await connectWallet(provider)
      setWalletChain(connection)
      setAccount(connection.address)
    } catch (error: unknown) {
      setWalletError(error instanceof WalletError ? error.message : 'Could not switch networks.')
    } finally {
      setWalletBusy(false)
    }
  }, [])

  // Keep the shown address and chain honest: wallets change accounts and networks without
  // warning, and a stale address is how you sign with the wrong one.
  useEffect(() => {
    const provider = walletProvider.current
    if (provider === null) return

    return subscribeToWallet(provider, {
      onAccountsChanged: (accounts) => {
        const next = accounts[0] ?? null
        setAccount(next)
        if (next === null) {
          setWalletChain(null)
          setWalletError('Your wallet disconnected or locked. Reconnect to publish.')
        }
      },
      onChainChanged: () => {
        void connectWallet(provider)
          .then((connection) => {
            setWalletChain(connection)
            setAccount(connection.address)
          })
          .catch(() => {
            setWalletChain(null)
          })
      },
      onDisconnected: () => {
        setAccount(null)
        setWalletChain(null)
        setWalletError('Your wallet disconnected. Reconnect to publish.')
      },
    })
  }, [])

  const onPublish = useCallback(async () => {
    const provider = walletProvider.current
    const profile = selectedProfile !== null ? getDemoProfile(selectedProfile) : undefined
    if (provider === null || profile === undefined || walletChain === null) return

    setPublishing(true)
    setWalletError(null)
    setPublishWarning(null)
    setPublishResults([])
    try {
      // viem is only needed to actually publish, and it is a large dependency, so the signing
      // module is loaded on demand. Reading preferences never pulls it into the page at all.
      const { preflightPublish, publishRecords } = await import('./publish')

      // Preflight first, so a missing resolver or an empty wallet is reported before any
      // signature is requested. A missing resolver or no balance throws and is shown as an
      // error; not owning the name is only a warning, because the owner may have granted this
      // account resolver access, so it is surfaced rather than treated as fatal.
      const preflight = await preflightPublish(provider, profile.ensName, walletChain.address)
      setPublishWarning(
        describeOwnershipWarning(profile.ensName, walletChain.address, preflight.signerIsOwner),
      )

      const results = await publishRecords({
        provider,
        normalizedName: profile.ensName,
        signer: walletChain.address,
        writes: planRecordWrites(profile),
      })

      setPublishResults(
        results.map((r) => ({
          key: r.key,
          outcome: r.outcome,
          txHash: r.txHash,
          message: r.message,
        })),
      )

      // Re-read through the app's own API, which holds the RPC URL server-side.
      setResolved(null)
      setAnswer(null)
    } catch (error: unknown) {
      setWalletError(error instanceof Error ? error.message : String(error))
    } finally {
      setPublishing(false)
    }
  }, [selectedProfile, walletChain])

  const activeLabel =
    selectedProfile !== null
      ? `sample profile ${selectedProfile}`
      : name.trim().length > 0
        ? name.trim()
        : 'a name'

  return (
    <div className="wrap">
      <header className="masthead">
        <div>
          <h1>Portable AI Preferences</h1>
          <p>
            Assistant preferences stored as ENS text records on Sepolia, validated against a closed
            allowlist, and applied to a model call without letting a record become an instruction.
          </p>
        </div>
        <div className="badges">
          {health ? (
            <>
              <Badge tone="accent">
                {health.chain} · {health.chainId}
              </Badge>
              <Badge>{health.config.model}</Badge>
              <Badge>timeout {health.config.timeoutMs} ms</Badge>
              <Badge tone={health.config.hasApiKey ? 'ok' : 'warn'}>
                key {health.config.hasApiKey ? 'server-side' : 'none needed'}
              </Badge>
            </>
          ) : (
            <Badge tone="warn">API offline</Badge>
          )}
          {account && walletChain?.onSepolia ? (
            <Badge tone="ok">wallet {shortenAddress(account)} · Sepolia</Badge>
          ) : account ? (
            <Badge tone="warn">wallet {shortenAddress(account)} · wrong network</Badge>
          ) : (
            <button className="secondary" onClick={() => void onConnectForPublish()} type="button">
              {walletBusy ? 'Connecting…' : 'Connect wallet to publish'}
            </button>
          )}
        </div>
      </header>

      {healthError ? (
        <Note tone="error">
          The API is not reachable: {healthError}. Start it with <code>npm start</code>, then reload.
        </Note>
      ) : null}

      {/* ------------------------------------------------------- step 1 */}
      <section className="card">
        <div className="card-head">
          <h2>1 · Look up a name</h2>
          <p>
            Normalized with ENSIP-15, then read from Sepolia. Read-only — no wallet, no signature, no
            cost.
          </p>
        </div>
        <div className="card-body">
          <div className="row">
            <label className="field grow">
              <span>ENS name</span>
              <input
                type="text"
                value={name}
                placeholder="ana.eth"
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => {
                  setName(event.target.value)
                  setSelectedProfile(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void onLookup()
                }}
              />
            </label>
            <button type="button" onClick={() => void onLookup()} disabled={resolving || name.trim().length === 0}>
              {resolving ? 'Reading…' : 'Read preferences'}
            </button>
          </div>

          {resolveError ? <Note tone="error">{resolveError}</Note> : null}

          {resolved && resolved.kind === 'ens' ? (
            <>
              <hr className="sep" />
              <PreferenceGrid source={resolved} />
              <SourceSummary source={resolved} />
              <ReadFailureWarning source={resolved} />
              {resolved.preferences.length === resolved.defaultCount ? (
                <div style={{ marginTop: 12 }}>
                  <Note tone="info">
                    No preference records were found for <strong>{resolved.ensName}</strong>, so every
                    preference fell back to its named default. That is the designed behaviour, not an
                    error.
                  </Note>
                </div>
              ) : null}
              <details>
                <summary>Raw records read from chain</summary>
                <pre className="dump">{JSON.stringify(resolved.records, null, 2)}</pre>
              </details>
            </>
          ) : null}
        </div>
      </section>

      {/* ------------------------------------------------------- step 2 */}
      {samples && samples.profiles.length > 0 ? (
        <section className="card">
          <div className="card-head">
            <h2>2 · Or try a labelled sample profile</h2>
            <p>{samples.notice}</p>
          </div>
          <div className="card-body">
            {!samples.publishedOnChain ? (
              <Note tone="warn">
                <strong>These profiles are not published on Sepolia.</strong> They are simulated record
                sets so the flow and the recorded cases are reproducible without a funded wallet. A
                real ENS name above is always read live from chain.
              </Note>
            ) : null}
            <div className="samples">
              {samples.profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  className="sample"
                  aria-pressed={selectedProfile === profile.id}
                  onClick={() => {
                    setSelectedProfile(selectedProfile === profile.id ? null : profile.id)
                    setAnswer(null)
                    setAskError(null)
                  }}
                >
                  <span className="n">
                    {profile.ensName}
                    {profile.publishedOnChain ? '' : ' · simulated'}
                  </span>
                  <span className="d">{profile.persona}</span>
                  <span className="d">{profile.demonstrates}</span>
                </button>
              ))}
            </div>
            {selectedProfile !== null ? (
              <div style={{ marginTop: 12 }}>
                <button className="link" type="button" onClick={() => setSelectedProfile(null)}>
                  Clear selection and use the name above
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------- step 3 */}
      <section className="card">
        <div className="card-head">
          <h2>3 · Ask something</h2>
          <p>
            Using <strong>{activeLabel}</strong>. The question is sent as a separate{' '}
            <code>user</code> message; record values only ever select app-authored wording.
          </p>
        </div>
        <div className="card-body">
          <label className="field">
            <span>Your question</span>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask anything…"
            />
          </label>

          <div className="row">
            <button
              type="button"
              onClick={() => void onAsk()}
              disabled={
                asking ||
                question.trim().length === 0 ||
                (selectedProfile === null && name.trim().length === 0)
              }
            >
              {asking ? 'Asking…' : 'Ask with these preferences'}
            </button>
            {health ? (
              <span className="small muted">
                {health.config.model} @ {health.config.providerHost} · aborts after{' '}
                {health.config.timeoutMs} ms
              </span>
            ) : null}
          </div>

          {askError ? (
            <div style={{ marginTop: 14 }}>
              <Note tone="error">{askError}</Note>
            </div>
          ) : null}

          {answer ? (
            <div style={{ marginTop: 18 }}>
              {answer.notice ? <Note tone="warn">{answer.notice}</Note> : null}
              <div className="answer">{answer.answer}</div>
              <div className="meta">
                <span>{answer.durationMs} ms</span>
                <span>
                  {answer.attempts} attempt{answer.attempts === 1 ? '' : 's'}
                </span>
                <span>{answer.model}</span>
                <span>{answer.source.ensName}</span>
              </div>

              <hr className="sep" />
              <PreferenceGrid source={answer.source} />
              <SourceSummary source={answer.source} />
              <ReadFailureWarning source={answer.source} />

              <details>
                <summary>
                  Inspect the system message and user message actually sent (no record text in it)
                </summary>
                <pre className="dump">
                  {JSON.stringify(
                    [
                      { role: 'system', content: answer.systemMessage },
                      { role: 'user', content: answer.question },
                    ],
                    null,
                    2,
                  )}
                </pre>
              </details>
              <details>
                <summary>Raw records used for this answer</summary>
                <pre className="dump">{JSON.stringify(answer.source.records, null, 2)}</pre>
              </details>
            </div>
          ) : null}
        </div>
      </section>

      {/* -------------------------------------------- step 4: publish via wallet */}
      {samples && samples.profiles.length > 0 ? (
        <section className="card">
          <div className="card-head">
            <h2>4 · Publish a profile&apos;s records with your wallet</h2>
            <p>
              Signed by MetaMask on <strong>Sepolia</strong>. This is the only action here that spends
              gas. No private key or seed phrase is ever requested, stored, or transmitted by this
              app.
            </p>
          </div>
          <div className="card-body">
            <Note tone="info">
              Reading preferences never needs a wallet. Connecting is only needed to publish. If you
              would rather not spend gas, the sample profiles above work without publishing.
            </Note>

            <div className="row" style={{ marginTop: 14 }}>
              {account === null ? (
                <button type="button" onClick={() => void onConnectForPublish()} disabled={walletBusy}>
                  {walletBusy ? 'Connecting…' : 'Connect MetaMask'}
                </button>
              ) : (
                <>
                  <span className="small">
                    Connected as <code>{account}</code>
                  </span>
                  <button className="secondary" type="button" onClick={() => void onSwitchToSepolia()} disabled={walletBusy}>
                    {walletBusy ? 'Switching…' : 'Switch to Sepolia'}
                  </button>
                </>
              )}
            </div>

            {walletChain && !walletChain.onSepolia ? (
              <div style={{ marginTop: 14 }}>
                <Note tone="error">{walletChain.networkError}</Note>
              </div>
            ) : null}

            {walletError ? (
              <div style={{ marginTop: 14 }}>
                <Note tone="error">{walletError}</Note>
              </div>
            ) : null}

            {account !== null && walletChain?.onSepolia ? (
              <div style={{ marginTop: 14 }}>
                <PublishPanel
                  selectedProfile={selectedProfile}
                  publishing={publishing}
                  results={publishResults}
                  warning={publishWarning}
                  onPublish={() => void onPublish()}
                />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <p className="small muted">
        Preference record keys are namespaced under{' '}
        {health ? Object.values(health.preferenceNamespace)[0]?.split('.')[0] : 'com.portableprefs'}.
        Values outside the allowlist are discarded, not forwarded. No wallet signature is required
        for any read on this page.
      </p>
    </div>
  )
}

/**
 * The publish controls, rendered only once the wallet is connected AND on Sepolia.
 *
 * The guard is deliberately in the parent as well as here, so an unexpected state cannot
 * leave an enabled button that would fail confusingly.
 */
function PublishPanel({
  selectedProfile,
  publishing,
  results,
  warning,
  onPublish,
}: {
  selectedProfile: string | null
  publishing: boolean
  results: readonly { key: string; outcome: string; txHash: string | null; message: string | null }[]
  warning: string | null
  onPublish: () => void
}) {
  const profile = selectedProfile !== null ? getDemoProfile(selectedProfile) : undefined

  if (profile === undefined) {
    return (
      <Note tone="info">
        Select a sample profile above to choose which record set to publish.
      </Note>
    )
  }

  const writes = planRecordWrites(profile)

  return (
    <div>
      <div className="small muted">
        Publishing <strong>{profile.ensName}</strong> · {writes.length} record
        {writes.length === 1 ? '' : 's'} · one transaction each, each settled before the next
      </div>
      <pre className="dump">{writes.map((w) => `${w.key} = ${JSON.stringify(w.value)}`).join('\n')}</pre>
      {warning !== null ? (
        <Note tone="warn">{warning}</Note>
      ) : null}
      <button type="button" onClick={onPublish} disabled={publishing}>
        {publishing ? 'Waiting for wallet…' : `Publish ${writes.length} records to ${profile.ensName}`}
      </button>

      {results.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <div className="pref-grid">
            {results.map((r) => (
              <div key={r.key} className={`pref ${r.outcome === 'confirmed' ? 'record' : ''}`}>
                <div className="k">{r.key}</div>
                <div className="v">
                  {r.outcome === 'confirmed' ? 'confirmed' : r.outcome === 'rejected' ? 'rejected by you' : 'failed'}
                </div>
                <div className="src">
                  {r.txHash ? (
                    <a
                      href={`https://sepolia.etherscan.io/tx/${r.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortenAddress(r.txHash)}
                    </a>
                  ) : (
                    'no transaction sent'
                  )}
                </div>
                {r.message ? <div className="src">{r.message}</div> : null}
              </div>
            ))}
          </div>
          {results.every((r) => r.outcome === 'confirmed') ? (
            <div style={{ marginTop: 12 }}>
              <Note tone="info">
                All {results.length} records are on chain. Read them back by entering{' '}
                <strong>{profile.ensName}</strong> in step 1 — that path is a live ENS read.
              </Note>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <Note tone="warn">
                Some records were not written. Nothing was silently skipped: each one above says
                why. You can retry — writing the same value again is harmless.
              </Note>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}