/**
 * MetaMask / EIP-1193 wallet access for the browser.
 *
 * Two rules shape this module:
 *
 *   1. **No key material, ever.** The wallet holds the key and does the signing. This file
 *      only asks the wallet which account and chain it is on, and asks it to switch
 *      networks. There is no code path here that reads, accepts, stores or transmits a
 *      private key or seed phrase, and `requestAccounts` is the only way an address is
 *      obtained.
 *   2. **Nothing touches `window` at import time.** The provider is injected, so the
 *      whole module is unit-testable in Node against a fake wallet.
 */

import { describeChain, isSepoliaChain, SEPOLIA_CHAIN_ID, SEPOLIA_CHAIN_ID_HEX } from '../shared/ens-write'

/** The subset of EIP-1193 this app uses. */
export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>
  on?(event: string, listener: (...args: unknown[]) => void): void
  removeListener?(event: string, listener: (...args: unknown[]) => void): void
}

/** The subset of EIP-1193 error shape we classify. */
interface ProviderErrorLike {
  code?: unknown
  message?: unknown
}

export type WalletFailureReason =
  | 'no-provider'
  | 'user-rejected'
  | 'chain-not-added'
  | 'wrong-network'
  | 'disconnected'
  | 'rpc-error'

/**
 * A wallet problem, already phrased so the UI can show it directly.
 *
 * The three cases the user actually hits — disconnected, wrong network, rejected the
 * signature — are deliberately distinct rather than collapsed into "something went wrong",
 * because the fix is different in each case.
 */
export class WalletError extends Error {
  readonly reason: WalletFailureReason

  constructor(reason: WalletFailureReason, message: string) {
    super(message)
    this.name = 'WalletError'
    this.reason = reason
  }
}

/** Return the injected wallet, or null if the browser has none. */
export function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === 'undefined') return null
  const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum
  return injected ?? null
}

export function requireInjectedProvider(): Eip1193Provider {
  const provider = getInjectedProvider()
  if (provider === null) {
    throw new WalletError(
      'no-provider',
      'No browser wallet detected. Install MetaMask to publish records. Reading preferences needs no wallet.',
    )
  }
  return provider
}

/** Read a chain id as a number from the `0x…` hex form wallets return. */
export function parseChainId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 16)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Turn any thrown value into a `WalletError` with an actionable message.
 *
 * EIP-1193 defines 4001 as "user rejected request" and 4902 as "chain not added". Both are
 * normal outcomes, not bugs, so they get their own wording instead of a raw code.
 */
export function classifyWalletError(error: unknown, context: string): WalletError {
  if (error instanceof WalletError) return error

  const candidate = (error ?? {}) as ProviderErrorLike
  const code = typeof candidate.code === 'number' ? candidate.code : null
  const rawMessage = typeof candidate.message === 'string' ? candidate.message : String(error)

  if (code === 4001) {
    return new WalletError('user-rejected', `${context}: rejected in your wallet. Nothing was signed or sent.`)
  }
  if (code === 4902) {
    return new WalletError(
      'chain-not-added',
      `${context}: your wallet does not have Sepolia yet. Add it and retry.`,
    )
  }
  // Several wallets report a user rejection with -32000 plus this marker in the message.
  if (code === -32000 && /rejected|denied|cancel/i.test(rawMessage)) {
    return new WalletError('user-rejected', `${context}: rejected in your wallet. Nothing was signed or sent.`)
  }

  return new WalletError('rpc-error', `${context}: ${rawMessage}`)
}

export interface WalletConnection {
  readonly address: `0x${string}`
  readonly chainId: number
  /** True only when the wallet is on Sepolia. Writes stay disabled otherwise. */
  readonly onSepolia: boolean
  /** Present when not on Sepolia, explaining what to do about it. */
  readonly networkError: string | null
}

/**
 * Connect and report the current account and chain.
 *
 * Note this does **not** require Sepolia to succeed: connecting on mainnet is legitimate
 * and lets the UI explain the problem. Only `onSepolia` gates writes.
 */
export async function connectWallet(provider: Eip1193Provider): Promise<WalletConnection> {
  let accounts: readonly string[]
  try {
    accounts = (await provider.request({ method: 'eth_requestAccounts' })) as readonly string[]
  } catch (error: unknown) {
    throw classifyWalletError(error, 'Connect wallet')
  }

  const address = accounts[0]
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new WalletError(
      'disconnected',
      'Your wallet returned no account. Unlock it and connect again.',
    )
  }

  const chainId = parseChainId(await provider.request({ method: 'eth_chainId' }))
  const onSepolia = isSepoliaChain(chainId)

  return {
    address: address as `0x${string}`,
    chainId: chainId ?? -1,
    onSepolia,
    networkError: onSepolia
      ? null
      : `Your wallet is on ${describeChain(chainId)}. Switch it to Sepolia to publish records — reading preferences works on any network.`,
  }
}

/**
 * Ask the wallet to move to Sepolia, adding the chain if it does not have it.
 *
 * This is a wallet-side permission prompt like any other; it never touches key material.
 */
export async function switchToSepolia(provider: Eip1193Provider): Promise<void> {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
    })
  } catch (error: unknown) {
    const classified = classifyWalletError(error, 'Switch to Sepolia')
    if (classified.reason !== 'chain-not-added') throw classified

    try {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: SEPOLIA_CHAIN_ID_HEX,
            chainName: 'Sepolia',
            nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
            blockExplorerUrls: ['https://sepolia.etherscan.io'],
          },
        ],
      })
    } catch (addError: unknown) {
      throw classifyWalletError(addError, 'Add Sepolia to your wallet')
    }
  }
}

/** Account/chain/disconnect events, so the UI never shows a stale address. */
export interface WalletEventHandlers {
  onAccountsChanged(accounts: readonly string[]): void
  onChainChanged(chainIdHex: string): void
  onDisconnected(): void
}

/** Subscribe to wallet events. Returns an unsubscribe function. */
export function subscribeToWallet(
  provider: Eip1193Provider,
  handlers: WalletEventHandlers,
): () => void {
  const onAccounts = (...args: unknown[]) => {
    handlers.onAccountsChanged((args[0] ?? []) as readonly string[])
  }
  const onChain = (...args: unknown[]) => {
    const value = args[0]
    handlers.onChainChanged(typeof value === 'string' ? value : SEPOLIA_CHAIN_ID_HEX)
  }
  const onDisconnect = () => {
    handlers.onDisconnected()
  }

  provider.on?.('accountsChanged', onAccounts)
  provider.on?.('chainChanged', onChain)
  provider.on?.('disconnect', onDisconnect)

  return () => {
    provider.removeListener?.('accountsChanged', onAccounts)
    provider.removeListener?.('chainChanged', onChain)
    provider.removeListener?.('disconnect', onDisconnect)
  }
}

/** Shorten an address for display without losing the recognisable ends. */
export function shortenAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

/**
 * A warning to show when the connected account does not appear to own the name.
 *
 * Preflight only *observes* ownership; it cannot tell whether the owner has granted resolver
 * access to this account, so this is phrased as a likely outcome rather than a blocker.
 * Returns `null` when the account owns the name.
 *
 * It lives here, not in `publish.ts`, because it is pure string formatting with no signing
 * concern: keeping it out of the module that statically imports `viem` means it can be
 * imported — and tested — without pulling the whole viem bundle in.
 */
export function describeOwnershipWarning(
  name: string,
  signer: string,
  signerIsOwner: boolean,
): string | null {
  if (signerIsOwner) return null
  return (
    `${signer} does not appear to own ${name}. The write will most likely revert unless the ` +
    'owner has granted this account resolver access.'
  )
}

export { SEPOLIA_CHAIN_ID }