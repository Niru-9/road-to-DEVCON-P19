/**
 * The wallet layer decides what the user is told when something goes wrong, so it is the
 * part most worth testing: a wrong-network message, a rejection and a disconnect must stay
 * distinguishable, and none of them may ever involve a key.
 *
 * A fake EIP-1193 provider is used throughout. No real wallet, no network, no `window`.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEMO_PROFILES, getDemoProfile } from '../shared/demo-names'
import {
  describeChain,
  isSepoliaChain,
  planRecordWrites,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_CHAIN_ID_HEX,
  ZERO_ADDRESS,
} from '../shared/ens-write'
import {
  classifyWalletError,
  connectWallet,
  getInjectedProvider,
  parseChainId,
  requireInjectedProvider,
  shortenAddress,
  subscribeToWallet,
  switchToSepolia,
  WalletError,
  type Eip1193Provider,
} from './wallet'

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678'
const OTHER_ADDRESS = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'

interface FakeOptions {
  accounts?: readonly string[]
  chainIdHex?: string
  /** method -> error to throw */
  throwFor?: Record<string, { code?: number; message?: string }>
}

function fakeProvider(options: FakeOptions = {}) {
  const accounts = options.accounts ?? [ADDRESS]
  const chainIdHex = options.chainIdHex ?? SEPOLIA_CHAIN_ID_HEX
  const throwFor = options.throwFor ?? {}
  const calls: { method: string; params?: unknown }[] = []
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()

  const provider: Eip1193Provider = {
    async request({ method, params }) {
      calls.push({ method, params })
      const failure = throwFor[method]
      if (failure !== undefined) {
        const error = new Error(failure.message ?? 'provider error') as Error & { code?: number }
        if (failure.code !== undefined) error.code = failure.code
        throw error
      }
      if (method === 'eth_requestAccounts') return accounts
      if (method === 'eth_accounts') return accounts
      if (method === 'eth_chainId') return chainIdHex
      return null
    },
    on(event, listener) {
      const existing = listeners.get(event) ?? []
      existing.push(listener)
      listeners.set(event, existing)
    },
    removeListener(event, listener) {
      const existing = listeners.get(event) ?? []
      listeners.set(
        event,
        existing.filter((candidate) => candidate !== listener),
      )
    },
  }

  return {
    provider,
    calls,
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
    listenerCount(event: string) {
      return (listeners.get(event) ?? []).length
    },
  }
}

describe('Sepolia is checked before any write is possible', () => {
  it('recognises the Sepolia chain id in both forms', () => {
    expect(isSepoliaChain(SEPOLIA_CHAIN_ID)).toBe(true)
    expect(parseChainId('0xaa36a7')).toBe(SEPOLIA_CHAIN_ID)
  })

  it('rejects every other chain, including mainnet', () => {
    expect(isSepoliaChain(1)).toBe(false)
    expect(isSepoliaChain(11155420)).toBe(false)
    expect(isSepoliaChain(null)).toBe(false)
    expect(isSepoliaChain(undefined)).toBe(false)
  })

  it('names the actual network in the wrong-network message', () => {
    expect(describeChain(1)).toBe('Ethereum mainnet')
    expect(describeChain(SEPOLIA_CHAIN_ID)).toBe('Sepolia')
    expect(describeChain(31337)).toContain('31337')
    expect(describeChain(null)).toBe('an unknown network')
  })

  it('parses hex and numeric chain ids, and gives up honestly on junk', () => {
    expect(parseChainId('0x1')).toBe(1)
    expect(parseChainId(1)).toBe(1)
    expect(parseChainId('not-hex')).toBeNull()
    expect(parseChainId(undefined)).toBeNull()
  })
})

describe('the three failure modes stay distinguishable', () => {
  it('reports a rejection in the wallet as a rejection, not a failure', async () => {
    const { provider } = fakeProvider({
      throwFor: { eth_requestAccounts: { code: 4001, message: 'User rejected the request.' } },
    })

    const error = await connectWallet(provider).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(WalletError)
    expect((error as WalletError).reason).toBe('user-rejected')
    expect((error as WalletError).message).toMatch(/rejected/i)
    // Nothing was signed: the rejection is reported, not retried around.
    expect((error as WalletError).message).toMatch(/Nothing was signed or sent/)
  })

  it('treats -32000 "denied" as a rejection too', () => {
    const error = classifyWalletError({ code: -32000, message: 'User denied transaction signature' }, 'Set record')
    expect(error.reason).toBe('user-rejected')
  })

  it('reports being on the wrong network, and still allows the connection', async () => {
    const { provider } = fakeProvider({ chainIdHex: '0x1' })

    const connection = await connectWallet(provider)

    expect(connection.address).toBe(ADDRESS)
    expect(connection.chainId).toBe(1)
    expect(connection.onSepolia).toBe(false)
    expect(connection.networkError).toMatch(/Ethereum mainnet/)
    expect(connection.networkError).toMatch(/reading preferences works on any network/i)
  })

  it('reports a disconnected or locked wallet', async () => {
    const { provider } = fakeProvider({ accounts: [] })
    const error = await connectWallet(provider).catch((e: unknown) => e)
    expect((error as WalletError).reason).toBe('disconnected')
    expect((error as WalletError).message).toMatch(/Unlock it/i)
  })

  it('reports a missing wallet without pretending it is a rejection', () => {
    // No `window` in this environment, so this is the no-provider path.
    expect(getInjectedProvider()).toBeNull()
    const error = (() => {
      try {
        requireInjectedProvider()
        return undefined
      } catch (e: unknown) {
        return e as WalletError
      }
    })()
    expect(error?.reason).toBe('no-provider')
    expect(error?.message).toMatch(/Reading preferences needs no wallet/i)
  })

  it('passes an unrelated RPC error through with its own text', () => {
    const error = classifyWalletError({ code: -32603, message: 'internal error' }, 'Connect wallet')
    expect(error.reason).toBe('rpc-error')
    expect(error.message).toContain('internal error')
  })

  it('does not re-wrap a WalletError', () => {
    const original = new WalletError('user-rejected', 'already phrased')
    expect(classifyWalletError(original, 'Connect wallet')).toBe(original)
  })
})

describe('switching networks goes through the wallet', () => {
  it('asks the wallet to switch straight to Sepolia when it already knows it', async () => {
    const { provider, calls } = fakeProvider()

    await switchToSepolia(provider)

    expect(calls).toContainEqual({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
    })
    expect(calls.map((c) => c.method)).not.toContain('wallet_addEthereumChain')
  })

  it('adds Sepolia when the wallet reports 4902', async () => {
    const { provider, calls } = fakeProvider({
      throwFor: {
        wallet_switchEthereumChain: { code: 4902, message: 'Unrecognized chain ID' },
      },
    })

    await switchToSepolia(provider)

    const add = calls.find((c) => c.method === 'wallet_addEthereumChain')
    expect(add).toBeDefined()
    const params = add?.params as { chainId: string }[]
    expect(params[0]?.chainId).toBe(SEPOLIA_CHAIN_ID_HEX)
  })

  it('surfaces a refusal to add the chain', async () => {
    const { provider } = fakeProvider({
      throwFor: {
        wallet_switchEthereumChain: { code: 4902 },
        wallet_addEthereumChain: { code: 4001, message: 'User rejected' },
      },
    })

    const error = await switchToSepolia(provider).catch((e: unknown) => e)
    expect((error as WalletError).reason).toBe('user-rejected')
    expect((error as WalletError).message).toMatch(/Add Sepolia/)
  })

  it('reports a rejection of the switch itself', async () => {
    const { provider } = fakeProvider({
      throwFor: { wallet_switchEthereumChain: { code: 4001 } },
    })
    const error = await switchToSepolia(provider).catch((e: unknown) => e)
    expect((error as WalletError).reason).toBe('user-rejected')
  })
})

describe('the displayed address cannot go stale', () => {
  it('subscribes to account, chain and disconnect events, and unsubscribes cleanly', () => {
    const fake = fakeProvider()
    const seen: string[] = []

    const unsubscribe = subscribeToWallet(fake.provider, {
      onAccountsChanged: (accounts) => seen.push(`accounts:${accounts.length}`),
      onChainChanged: (chainId) => seen.push(`chain:${chainId}`),
      onDisconnected: () => seen.push('disconnected'),
    })

    expect(fake.listenerCount('accountsChanged')).toBe(1)
    fake.emit('accountsChanged', [])
    fake.emit('accountsChanged', [OTHER_ADDRESS])
    fake.emit('chainChanged', '0x1')
    fake.emit('disconnect')

    // An empty accounts array is how wallets signal "locked / disconnected", and it must
    // reach the UI so the address cannot linger.
    expect(seen).toEqual(['accounts:0', 'accounts:1', 'chain:0x1', 'disconnected'])

    unsubscribe()
    expect(fake.listenerCount('accountsChanged')).toBe(0)
    expect(fake.listenerCount('chainChanged')).toBe(0)
    expect(fake.listenerCount('disconnect')).toBe(0)
  })

  it('shortens an address without mangling it', () => {
    expect(shortenAddress(ADDRESS)).toBe('0x1234…5678')
    expect(shortenAddress('0xabc')).toBe('0xabc')
  })
})

describe('what gets written is derived from the profile, never from a flag', () => {
  it('plans exactly the records the profile sets, with full namespaced keys', () => {
    const ana = getDemoProfile('ana')!
    const plan = planRecordWrites(ana)

    expect(plan.map((w) => w.key)).toEqual([
      'com.portableprefs.language',
      'com.portableprefs.length',
      'com.portableprefs.reading',
      'com.portableprefs.format',
      'com.portableprefs.avoid',
    ])
    expect(plan.find((w) => w.key === 'com.portableprefs.language')?.value).toBe('pt')
  })

  it('skips unset records so the name still demonstrates the default path', () => {
    const minimal = getDemoProfile('minimal')!
    const plan = planRecordWrites(minimal)

    expect(plan).toHaveLength(1)
    expect(plan[0]?.key).toBe('com.portableprefs.language')
    // Crucially, nothing that would blank a record on chain.
    expect(plan.some((w) => w.value === '')).toBe(false)
  })

  it('would write the injection attempt verbatim, which is why reads validate', () => {
    // The hostile profile is not sanitised on the way out. Sanitisation happens on READ, and
    // the app's own tests prove those values cannot reach the prompt. Writing raw is correct:
    // the owner is allowed to put anything in their own records.
    const hostile = getDemoProfile('hostile')!
    const plan = planRecordWrites(hostile)
    const language = plan.find((w) => w.key === 'com.portableprefs.language')

    expect(language?.value).toMatch(/IGNORE ALL PREVIOUS INSTRUCTIONS/)
    expect(ZERO_ADDRESS).toMatch(/^0x0{40}$/)
  })

  it('covers every profile without producing an empty plan', () => {
    for (const profile of DEMO_PROFILES) {
      expect(planRecordWrites(profile).length).toBeGreaterThan(0)
    }
  })
})

describe('no key material anywhere in this path', () => {
  /**
   * A structural guard rather than a behavioural one: the publishing path must have no way
   * to accept a key even by accident. This reads the actual sources, so it fails if someone
   * later adds a `privateKey` parameter or a `walletClient` account literal.
   */
  function readSource(relativePath: string): string {
    return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), relativePath), 'utf8')
  }

  const publishSources = ['wallet.ts', 'publish.ts'] as const

  it('neither wallet module mentions a key, a seed phrase or a mnemonic', () => {
    for (const file of publishSources) {
      const source = readSource(file)
      // Comments are allowed to say "no private key" — only code identifiers are checked.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect(code, `${file} must not handle key material`).not.toMatch(
        /privateKey|privKey|mnemonic|seedPhrase|secretKey/i,
      )
    }
  })

  it('signs only through the wallet, never by supplying an account with a key', () => {
    const code = readSource('publish.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    expect(code).toContain('walletClient.writeContract')
    // No `privateKeyToAccount`, no local account construction.
    expect(code).not.toMatch(/privateKeyToAccount|createWalletClient\(\{[^}]*account:/)
  })

  it('builds its clients on the wallet transport, so no RPC URL enters the bundle', () => {
    const code = readSource('publish.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    expect(code).toContain('custom(provider)')
    // Any literal http(s) endpoint in this module would land in the browser bundle.
    expect(code).not.toMatch(/https?:\/\//)
  })

  it('never mentions a private key or seed phrase in user-facing text', async () => {
    const { provider } = fakeProvider({ chainIdHex: '0x1' })
    const connection = await connectWallet(provider)

    const userFacing = [connection.networkError ?? ''].join(' ')
    expect(userFacing).not.toMatch(/private key|seed phrase|mnemonic/i)
  })
})

describe('the preflight ownership result reaches the user', () => {
  const signer = '0x1234567890AbcdEF1234567890aBcdef12345678' as const

  it('says nothing when the connected account owns the name', async () => {
    const { describeOwnershipWarning } = await import('./wallet')
    expect(describeOwnershipWarning('ana.eth', signer, true)).toBeNull()
  })

  it('warns, naming the account and the name, when ownership does not match', async () => {
    const { describeOwnershipWarning } = await import('./wallet')
    const warning = describeOwnershipWarning('ana.eth', signer, false)

    expect(warning).not.toBeNull()
    expect(warning).toContain(signer)
    expect(warning).toContain('ana.eth')
  })

  it('does not present the warning as a hard stop, since resolver access can be granted', async () => {
    const { describeOwnershipWarning } = await import('./wallet')
    const warning = describeOwnershipWarning('ana.eth', signer, false) ?? ''

    // A user who has been granted access must not be told they are blocked.
    expect(warning).not.toMatch(/cannot|will not be able|blocked/i)
    expect(warning).toMatch(/most likely revert/i)
  })

  it('is rendered by the publish panel rather than discarded', () => {
    const code = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'main.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    // The preflight result must be consumed, not awaited and thrown away.
    expect(code).toContain('describeOwnershipWarning')
    expect(code).toContain('setPublishWarning(')
  })
})