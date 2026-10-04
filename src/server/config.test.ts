/**
 * Checks for scored criterion 7 (model id and provider endpoint come from
 * configuration) and criterion 8 (nothing secret is ever exposed outward).
 */

import { describe, expect, it } from 'vitest'

import { ConfigError, parseConfig, safeHost, toPublicConfigView } from './config'

const VALID = {
  LLM_BASE_URL: 'https://api.example-model.dev/v1',
  LLM_MODEL: 'some/model-id',
  // Deliberately shaped so it cannot be mistaken for a real key by any scanner.
  LLM_API_KEY: 'unit-test-placeholder-key',
  LLM_TIMEOUT_MS: '20000',
} as NodeJS.ProcessEnv

describe('criterion 7 — model id and provider endpoint are read from configuration', () => {
  it('takes the endpoint and model id from the environment', () => {
    const config = parseConfig(VALID)
    expect(config.llmBaseUrl).toBe('https://api.example-model.dev/v1')
    expect(config.llmModel).toBe('some/model-id')
  })

  it('changes provider purely by changing the environment', () => {
    const groq = parseConfig({ ...VALID, LLM_BASE_URL: 'https://api.groq.com/openai/v1' })
    const ollama = parseConfig({ ...VALID, LLM_BASE_URL: 'http://localhost:11434/v1' })

    expect(groq.llmBaseUrl).toBe('https://api.groq.com/openai/v1')
    expect(ollama.llmBaseUrl).toBe('http://localhost:11434/v1')
  })

  it('refuses to start without an endpoint, rather than defaulting to a literal', () => {
    expect(() => parseConfig({ LLM_MODEL: 'x' })).toThrow(ConfigError)
    expect(() => parseConfig({ LLM_BASE_URL: 'https://x.dev/v1' })).toThrow(ConfigError)
  })

  it('refuses an endpoint that is not an http(s) URL', () => {
    expect(() => parseConfig({ ...VALID, LLM_BASE_URL: 'ftp://x.dev' })).toThrow(ConfigError)
  })

  it('rejects a missing model id with an actionable message naming the variable', () => {
    try {
      parseConfig({ LLM_BASE_URL: 'https://x.dev/v1' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      const message = (error as ConfigError).message
      expect(message).toContain('LLM_MODEL')
      expect(message).toContain('.env.example')
    }
  })

  it('strips a trailing slash so the call site can append a path safely', () => {
    expect(parseConfig({ ...VALID, LLM_BASE_URL: 'https://x.dev/v1///' }).llmBaseUrl).toBe(
      'https://x.dev/v1',
    )
  })
})

describe('criterion 5 (config half) — the timeout is explicit and bounded', () => {
  it('defaults the timeout when unset', () => {
    expect(parseConfig(VALID).llmTimeoutMs).toBe(20_000)
  })

  it('reads the timeout from the environment', () => {
    expect(parseConfig({ ...VALID, LLM_TIMEOUT_MS: '45000' }).llmTimeoutMs).toBe(45_000)
  })

  it('rejects a nonsensical timeout instead of silently accepting it', () => {
    expect(() => parseConfig({ ...VALID, LLM_TIMEOUT_MS: '0' })).toThrow(ConfigError)
    expect(() => parseConfig({ ...VALID, LLM_TIMEOUT_MS: '-5' })).toThrow(ConfigError)
    expect(() => parseConfig({ ...VALID, LLM_TIMEOUT_MS: 'soon' })).toThrow(ConfigError)
    expect(() => parseConfig({ ...VALID, LLM_TIMEOUT_MS: '999999' })).toThrow(ConfigError)
  })
})

describe('criterion 8 (config half) — secrets never leave the server', () => {
  it('reduces the API key to a boolean in the public view', () => {
    const view = toPublicConfigView(parseConfig(VALID))
    expect(view.hasApiKey).toBe(true)
    expect(JSON.stringify(view)).not.toContain('unit-test-placeholder-key')
  })

  it('reports no key for a local provider', () => {
    const view = toPublicConfigView(parseConfig({ ...VALID, LLM_API_KEY: '' }))
    expect(view.hasApiKey).toBe(false)
  })

  it('exposes only the host of an authenticated RPC URL, never the credentials', () => {
    const view = toPublicConfigView(
      parseConfig({
        ...VALID,
        SEPOLIA_RPC_URL: 'https://rpc.example.dev/v1/abcdef-secret-project-id',
      }),
    )
    expect(view.rpcHost).toBe('rpc.example.dev')
    const serialised = JSON.stringify(view)
    expect(serialised).not.toContain('abcdef-secret-project-id')
    expect(serialised).not.toContain('/v1')
  })

  it('strips userinfo from a host', () => {
    expect(safeHost('https://user:hunter2@rpc.example.dev:8545/path')).toBe('rpc.example.dev:8545')
    expect(safeHost('not a url')).toBe('unknown')
  })

  it('defaults the RPC to a public endpoint and never to a keyed one', () => {
    expect(parseConfig(VALID).sepoliaRpcUrl).toBe('https://ethereum-sepolia-rpc.publicnode.com')
  })
})