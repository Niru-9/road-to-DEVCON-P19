/**
 * Signing preference-record writes with the user's wallet.
 *
 * Signing happens entirely inside MetaMask: this module builds the `setText` calldata and
 * hands it to the wallet, which shows its own confirmation prompt. No private key exists in
 * this process at any point.
 *
 * Note the transport: both the public client and the wallet client are built on
 * `custom(provider)`, i.e. the wallet's *own* RPC. That is deliberate — it means this module
 * needs no RPC URL of its own, so no endpoint (and therefore no API key embedded in one)
 * can end up in the browser bundle. Read-only verification after writing is done through
 * this app's own API instead, which holds the RPC URL server-side.
 */

import { createPublicClient, createWalletClient, custom, numberToHex } from 'viem'
import type { Address, PublicClient, WalletClient } from 'viem'
import { sepolia } from 'viem/chains'
import { namehash } from 'viem/ens'

import {
  ENS_REGISTRY,
  REGISTRY_ABI,
  RESOLVER_ABI,
  runPublishPreflight,
  type PlannedWrite,
  type PreflightResult,
} from '../shared/ens-write'
import { classifyWalletError, type Eip1193Provider } from './wallet'

export function createWalletPublicClient(provider: Eip1193Provider): PublicClient {
  return createPublicClient({ chain: sepolia, transport: custom(provider) })
}

export function createWalletSigner(provider: Eip1193Provider): WalletClient {
  return createWalletClient({ chain: sepolia, transport: custom(provider) })
}

export type WriteOutcome = 'confirmed' | 'rejected' | 'failed'

export interface WriteResult {
  readonly key: string
  readonly value: string
  readonly outcome: WriteOutcome
  readonly txHash: `0x${string}` | null
  /** Human-readable explanation, present unless `outcome === 'confirmed'`. */
  readonly message: string | null
  readonly gasUsed: bigint | null
}

export interface PublishProgress {
  (update: { key: string; phase: 'sent' | 'settled'; result?: WriteResult }): void
}

function toWriteResult(write: PlannedWrite): WriteResult {
  return { key: write.key, value: write.value, outcome: 'failed', txHash: null, message: null, gasUsed: null }
}

/**
 * Run the read-only preflight against the wallet's own RPC.
 *
 * Called before the write button is enabled, so a name with no resolver or an unfunded
 * wallet is reported before any signature is ever requested.
 */
export async function preflightPublish(
  provider: Eip1193Provider,
  normalizedName: string,
  signer: Address,
): Promise<PreflightResult> {
  const client = createWalletPublicClient(provider)
  return runPublishPreflight(
    client as PublicClient,
    normalizedName,
    signer,
    namehash as (name: string) => `0x${string}`,
  )
}

/**
 * Write each record, one transaction each, waiting for confirmation before the next.
 *
 * Sequential on purpose: MetaMask can only reliably track one in-flight request at a time,
 * and a partial publish is far easier to reason about when each step is confirmed.
 *
 * A rejection is recorded per record and does not abort the remaining ones, so the caller
 * always learns exactly what landed and what did not.
 */
export async function publishRecords(options: {
  provider: Eip1193Provider
  normalizedName: string
  signer: Address
  writes: readonly PlannedWrite[]
  onProgress?: PublishProgress
}): Promise<WriteResult[]> {
  const { provider, normalizedName, signer, writes, onProgress } = options

  const publicClient = createWalletPublicClient(provider)
  const walletClient = createWalletSigner(provider)
  const node = namehash(normalizedName)

  const preflight = await runPublishPreflight(
    publicClient as PublicClient,
    normalizedName,
    signer,
    namehash as (name: string) => `0x${string}`,
  )

  const results: WriteResult[] = []

  for (const write of writes) {
    let hash: `0x${string}` | null = null
    try {
      // `walletClient.writeContract` sends eth_sendTransaction, which is what makes MetaMask
      // show its confirmation sheet. Nothing is signed by this code.
      hash = await walletClient.writeContract({
        account: signer,
        address: preflight.resolver,
        abi: RESOLVER_ABI,
        functionName: 'setText',
        args: [node, write.key, write.value],
        chain: sepolia,
      })
      onProgress?.({ key: write.key, phase: 'sent' })

      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      if (receipt.status === 'reverted') {
        results.push({
          ...toWriteResult(write),
          outcome: 'failed',
          txHash: hash,
          message: revertedMessage(normalizedName, signer, preflight.signerIsOwner),
        })
        continue
      }

      results.push({
        ...toWriteResult(write),
        outcome: 'confirmed',
        txHash: hash,
        message: null,
        gasUsed: receipt.gasUsed,
      })
    } catch (error: unknown) {
      const classified = classifyWalletError(error, `Set ${write.key}`)
      results.push({
        ...toWriteResult(write),
        outcome: classified.reason === 'user-rejected' ? 'rejected' : 'failed',
        txHash: hash,
        message: classified.message,
      })
    }

    const last = results[results.length - 1]
    if (last !== undefined) onProgress?.({ key: write.key, phase: 'settled', result: last })
  }

  return results
}

/**
 * Explain a reverted `setText`.
 *
 * The overwhelmingly common cause is that the connected account is not the name's owner and
 * has not been granted resolver access, which is worth saying plainly rather than surfacing
 * as a bare "execution reverted".
 */
function revertedMessage(name: string, signer: Address, signerIsOwner: boolean): string {
  if (!signerIsOwner) {
    return (
      `The transaction reverted. Your connected account ${signer} is not the owner of ${name}, ` +
      'so it cannot write its records. Connect the owning account, or have the owner grant ' +
      'this account resolver access.'
    )
  }
  return `The transaction reverted even though ${signer} owns ${name}. Check the record key and value are as expected.`
}

/** Numeric chain id as the hex string wallets use, for readability in logs. */
export function chainIdToHex(chainId: number): `0x${string}` {
  return numberToHex(chainId)
}

export { ENS_REGISTRY, REGISTRY_ABI }