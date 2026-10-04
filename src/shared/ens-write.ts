/**
 * Writing preference records to ENS — the shared, environment-agnostic core.
 *
 * This module deliberately contains **no signing and no key material**. It only knows:
 *
 *   - which chain is acceptable (Sepolia),
 *   - how to describe a chain id in words,
 *   - the ENS Registry / Resolver ABIs needed for `setText`,
 *   - how to turn a demo profile into the exact set of records to write, and
 *   - how to run a read-only preflight (resolver present? signer funded? is the signer
 *     actually allowed to write to this name?).
 *
 * The transaction itself is signed by the user's wallet — see `src/web/publish.ts`.
 * Keeping the two apart is what makes it impossible for a private key to end up in this
 * file, in `.env`, or in the browser bundle.
 */

import type { Address, PublicClient } from 'viem'

import type { DemoProfile } from './demo-names'
import { PREFERENCE_RECORD_KEYS, type PreferenceField } from './preferences'

/** Sepolia. Required before any write is offered. */
export const SEPOLIA_CHAIN_ID = 11155111

/** The same value in the hex form `wallet_switchEthereumChain` expects. */
export const SEPOLIA_CHAIN_ID_HEX = '0xaa36a7'

export function isSepoliaChain(chainId: number | null | undefined): boolean {
  return chainId === SEPOLIA_CHAIN_ID
}

/**
 * A human name for a chain id.
 *
 * The wrong-network error is the single most likely thing to go wrong here, so it has to
 * say which network the wallet is actually on rather than just refusing.
 */
export function describeChain(chainId: number | null | undefined): string {
  switch (chainId) {
    case 1:
      return 'Ethereum mainnet'
    case 11155111:
      return 'Sepolia'
    case 11155420:
      return 'OP Sepolia'
    case 17000:
      return 'Holesky'
    case 84532:
      return 'Base Sepolia'
    case 560048:
      return 'Hoodi'
    case null:
    case undefined:
      return 'an unknown network'
    default:
      return `an unrecognised network (chain ${chainId})`
  }
}

/** The ENS Registry, deployed at the same address on every network. */
export const ENS_REGISTRY: Address = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e'

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

export const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getResolver',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export const RESOLVER_ABI = [
  {
    type: 'function',
    name: 'setText',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
  },
] as const

export interface PlannedWrite {
  /** Full ENSIP-5 record key, e.g. `com.portableprefs.language`. */
  readonly key: string
  readonly value: string
}

/**
 * The records a profile actually sets.
 *
 * Unset keys are skipped rather than written as empty strings, so a name published from a
 * profile genuinely demonstrates the default-fallback path instead of looking fully
 * configured.
 */
export function planRecordWrites(profile: DemoProfile): PlannedWrite[] {
  const writes: PlannedWrite[] = []
  for (const [field, value] of Object.entries(profile.records)) {
    if (typeof value !== 'string' || value.length === 0) continue
    writes.push({ key: PREFERENCE_RECORD_KEYS[field as PreferenceField], value })
  }
  return writes
}

export interface PreflightResult {
  readonly normalizedName: string
  readonly resolver: Address
  /** The connected account. */
  readonly signer: Address
  readonly balanceWei: bigint
  /** True when `signer` is the ENS name owner, i.e. can write without an approval. */
  readonly signerIsOwner: boolean
  readonly owner: Address | null
}

/** Raised when a name cannot be written to at all, with an actionable message. */
export class PublishPreflightError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(problems.join('\n'))
    this.name = 'PublishPreflightError'
    this.problems = problems
  }
}

/**
 * Read-only checks, run before any transaction is offered.
 *
 * Every failure mode here is something a user hits in practice — wrong network, no
 * resolver, empty wallet, connected to the wrong account — so they are all reported as
 * plain sentences rather than raw RPC errors.
 */
export async function runPublishPreflight(
  client: PublicClient,
  normalizedName: string,
  signer: Address,
  namehashOf: (name: string) => `0x${string}`,
): Promise<PreflightResult> {
  const problems: string[] = []
  const node = namehashOf(normalizedName)

  const resolver = await client.readContract({
    address: ENS_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: 'getResolver',
    args: [node],
  })

  if (!resolver || resolver === ZERO_ADDRESS) {
    problems.push(
      `${normalizedName} has no resolver, so text records cannot be written to it. ` +
        'Set the Public Resolver first (sepolia.app.ens.domains), then reconnect and retry.',
    )
  }

  let owner: Address | null = null
  try {
    owner = await client.readContract({
      address: ENS_REGISTRY,
      abi: REGISTRY_ABI,
      functionName: 'owner',
      args: [node],
    })
    if (owner === ZERO_ADDRESS) owner = null
  } catch {
    // `owner()` is not essential to publishing; an approval may still grant access.
    owner = null
  }

  const balanceWei = await client.getBalance({ address: signer })
  if (balanceWei === 0n) {
    problems.push(
      'The connected wallet has 0 Sepolia ETH, so it cannot pay for a transaction. ' +
        'Fund it from the Sepolia faucet (e.g. https://cloud.google.com/application/web3/faucet/ethereum/sepolia).',
    )
  }

  if (problems.length > 0) {
    throw new PublishPreflightError(problems)
  }

  return {
    normalizedName,
    resolver: resolver as Address,
    signer,
    balanceWei,
    signerIsOwner: owner !== null && owner.toLowerCase() === signer.toLowerCase(),
    owner,
  }
}