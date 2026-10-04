#!/usr/bin/env node
/**
 * Scored criterion 8 — no credential appears in any tracked file.
 *
 *   npm run check:secrets
 *
 * What it does:
 *   1. Lists every git-TRACKED file and scans its contents for credential shapes.
 *   2. Asserts that `.env` (and `.env.*` other than `.env.example`) is git-ignored, so a
 *      real secret cannot be committed by accident.
 *   3. Asserts that `.env.example` holds only placeholders.
 *   4. If a built browser bundle exists in dist/web, scans that too — criterion 8 must
 *      also hold for anything shipped to the browser.
 *
 * Exit code 0 means clean, 1 means at least one finding.
 *
 * Scanning is LINE-ANCHORED. Patterns are matched against individual lines rather than
 * whole files, which keeps findings precise (correct file and line number) and lets the
 * stricter patterns require a whole line to look like a credential instead of matching
 * ordinary prose.
 *
 * This file contains the patterns it searches for, so it and the test files that
 * deliberately exercise config handling are exempt.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..')

/** Files that legitimately contain the patterns themselves. */
const SELF_EXEMPT = new Set([
  'scripts/scan-secrets.mjs',
  'src/server/config.test.ts',
  '.env.example',
])

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz',
  '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.wasm', '.keystore', '.lock',
])

/**
 * Credential shapes, each [label, RegExp], matched against a single line.
 *
 * Patterns are written to match a plausible real secret while rejecting the placeholders
 * used in .env.example. Anything containing "example", "placeholder", "replace-with",
 * "your-key" or "changeme" is treated as a placeholder and skipped.
 */
const PATTERNS = [
  ['OpenAI-style API key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['Groq API key', /\bgsk_[A-Za-z0-9]{20,}\b/],
  ['OpenRouter API key', /\bsk-or-v1-[A-Za-z0-9]{20,}\b/],
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{20,}\b/],
  ['Stripe secret key', /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/],
  ['Alchemy key', /\balchemy_[A-Za-z0-9]{20,}\b/],
  ['Infura project key', /infura\.io\/v\d\/[0-9a-f]{24,}/i],
  [
    'Hosted RPC path key',
    // The version segment is optional and excluded from the key: Alchemy serves keys at
    // `…/v2/<key>`, so a pattern anchored directly on the host and a slash would only ever
    // match the two-character `v2` and never the key behind it.
    /(?:g\.alchemy\.com|[a-z0-9-]+\.quiknode\.pro|[a-z0-9.-]*\.ankr\.com)(?:\/v\d+)?\/[A-Za-z0-9_-]{20,}/i,
  ],
  ['Private key block', /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/],
  ['Ethereum private key literal', /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/],
  // The quote is optional: the common shape is a bare HTTP header, `Authorization: Bearer …`.
  ['Bearer token literal', /["'`]?[Aa]uthorization["'`]?\s*[:=]\s*["'`]?Bearer\s+[A-Za-z0-9._-]{16,}/],
  [
    'URL with embedded credentials',
    // Both userinfo halves are restricted to characters that actually occur in RPC/API
    // credentials. An unbounded userinfo match once flagged viem's
    // `docsOrigin:"https://oxlib.sh",showVersion:!1,version:\`ox@…\`` by treating the JS
    // punctuation between two unrelated strings as `user:pass@`. Real credentialed URLs
    // (Alchemy, Infura, QuickNode, basic-auth gateways) still match.
    /\b[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9._~%+=&-]*:[A-Za-z0-9._~%+=&:-]*@[A-Za-z0-9._~%+=&:-]+/i,
  ],
  ['URL with an inline key or token query', /https?:\/\/[^\s"']*(?:apikey|api_key|[?&]key=|[?&]token=)[^\s"']*/i],
  ['Secret assigned to a variable', /\b(?:api[_-]?key|secret|password|passphrase|private[_-]?key|mnemonic)\b\s*[:=]\s*["'`]?[A-Za-z0-9+/_\-]{16,}/i],
  [
    'BIP-39-style seed phrase',
    // Either the whole line is a bare mnemonic, or a mnemonic/seed variable is assigned one.
    // The assignment form is matched explicitly because `Secret assigned to a variable` cannot
    // span the spaces between words, and the bare form is kept line-anchored so that ordinary
    // 12-word English prose in the docs is not flagged.
    /^(?:[a-z]{3,8} ){11,23}[a-z]{3,8}$|(?:mnemonic|seed[_-]?phrase)\s*[:=]\s*["'`]?(?:[a-z]{3,8} ){11,23}[a-z]{3,8}/i,
  ],
]

/** Values that are placeholders, not secrets. */
const PLACEHOLDER_VALUES = new Set([
  '',
  'replace-with-your-own-key',
  'replace-with-a-model-id',
  'your-key-here',
  'unit-test-placeholder-key',
  'test-key',
  'changeme',
  'xxx',
])

/**
 * Public constants that look like a 32-byte hex value.
 *
 * These arrive in `dist/web` because `viem` (and its `@noble/curves` dependency) is bundled
 * for the wallet-signing path. They are published curve parameters and padding sentinels,
 * never secrets.
 *
 * Two mechanisms, both deliberately narrow:
 *
 *   1. `hasShortRepeatingUnit` — a 32-byte value whose bytes are a repeating unit of at
 *      most 4 bytes. That is the shape of the EIP-2930 dummy access-list sentinels, which
 *      are `0x5792…`, `0x6492…`, `0x8010…` (a 2-byte unit) and `0x57…`, `0x64…`, `0x80…`
 *      (a 1-byte unit). A real key is a uniform random 256-bit integer; for it to repeat a
 *      4-byte unit 32 times has probability 256^-28, so this cannot hide a real key in
 *      practice. Checked structurally rather than by listing each sentinel.
 *
 *   2. `NAMED_CURVE_CONSTANTS` — secp256k1 parameters, listed by EXACT full value. A
 *      secp256k1 private key is an integer in [1, n-1]; the field prime p, the group order n
 *      and the GLV beta are all >= n or are curve coefficients, so none can be a valid key.
 *
 * Anything else that is 32 bytes of hex still fails the scan, and every match on a line is
 * examined — so an exempt constant can never mask a real key sitting next to it.
 */
const NAMED_CURVE_CONSTANTS = new Set([
  // secp256k1 field prime p — @noble/curves secp256k1
  '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f',
  // secp256k1 group order n — @noble/curves secp256k1
  '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141',
  // secp256k1 GLV endomorphism beta — @noble/curves secp256k1 `endo.beta`
  '0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee',
])

/** The 32 bytes of a `0x`-prefixed 64-hex-character literal, or null. */
function asThirtyTwoBytes(value) {
  const body = value.startsWith('0x') ? value.slice(2) : value
  if (body.length !== 64 || !/^[0-9a-fA-F]+$/.test(body)) return null
  const bytes = []
  for (let i = 0; i < body.length; i += 2) bytes.push(body.slice(i, i + 2))
  return bytes
}

/** True when all 32 bytes are a repeating unit of 1-4 bytes. */
function hasShortRepeatingUnit(bytes) {
  for (let unit = 1; unit <= 4; unit += 1) {
    let repeats = true
    for (let i = unit; i < bytes.length; i += 1) {
      if (bytes[i] !== bytes[i % unit]) {
        repeats = false
        break
      }
    }
    if (repeats) return true
  }
  return false
}

function isKnownPublicConstant(value) {
  const normalised = value.toLowerCase()
  if (NAMED_CURVE_CONSTANTS.has(normalised)) return true
  // Only the 32-byte key-literal shape is eligible for the structural rule.
  const bytes = /^0x[0-9a-f]{64}$/.test(normalised) ? asThirtyTwoBytes(normalised) : null
  return bytes !== null && hasShortRepeatingUnit(bytes)
}

function looksLikePlaceholder(value) {
  if (PLACEHOLDER_VALUES.has(value.trim())) return true
  return /example|placeholder|replace-with|your-key|your-provider|changeme|does-not-exist/i.test(
    value,
  )
}

/** `.env.example` lines that describe a variable without supplying a real value. */
function isEnvExamplePlaceholderLine(line) {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return true
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed)
  if (!match) return true
  const value = match[2].trim().replace(/^["']|["']$/g, '')
  return (
    looksLikePlaceholder(value) ||
    value.includes('<') ||
    value.includes('example.com') ||
    value.includes('example-model.dev')
  )
}

function listTrackedFiles() {
  // `--cached --others --exclude-standard` is the set of files git would commit: everything in
  // the index plus everything untracked that .gitignore does not exclude. Plain `git ls-files`
  // returns only what is already in the index, so on a fresh checkout — or a repo whose first
  // commit has not been made yet — it returns nothing and criterion 8 would "pass" without
  // reading a single file. Asking for the would-be-committed set makes the scan meaningful
  // before the first commit while staying exactly as strict afterwards.
  try {
    const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output.split('\n').map((line) => line.trim()).filter(Boolean)
  } catch {
    return null
  }
}

function listBundleFiles(dir) {
  const found = []
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      if (statSync(full).isDirectory()) walk(full)
      else found.push(relative(repoRoot, full).replace(/\\/g, '/'))
    }
  }
  walk(dir)
  return found
}

function redact(value) {
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}…${value.slice(-4)} (${value.length} chars)`
}

/**
 * Shapes so specific that a line merely *mentioning* "example" cannot excuse them.
 *
 * `looksLikePlaceholder` is applied to the whole line, which is what keeps ordinary prose in
 * the docs from being flagged. But a placeholder marker anywhere on the line also suppressed
 * a genuine secret on that same line — including a credentialed URL whose host or comment
 * contained the word "example". These four shapes are too constrained to be placeholders in
 * the first place: nobody writes `0x` plus 64 hex digits, a `/v2/<32-char>` RPC key, a
 * `user:pass@host` URL or a 12–24 word lowercase mnemonic as an example value. They ignore the
 * line-level marker and still respect `isKnownPublicConstant` and `.env.example`'s own rules.
 */
const HIGH_CONFIDENCE_LABELS = new Set([
  'Ethereum private key literal',
  'Hosted RPC path key',
  'URL with embedded credentials',
  'BIP-39-style seed phrase',
])

function scanFile(relativePath) {
  const absolute = join(repoRoot, relativePath)
  if (!existsSync(absolute) || statSync(absolute).size > 8 * 1024 * 1024) return []
  if (BINARY_EXTENSIONS.has(extname(absolute).toLowerCase())) return []

  let contents
  try {
    contents = readFileSync(absolute, 'utf8')
  } catch {
    return []
  }

  const isEnvExample = relativePath === '.env.example'
  const findings = []

  contents.split('\n').forEach((line, index) => {
    if (isEnvExample && isEnvExamplePlaceholderLine(line)) return
    const lineLooksLikePlaceholder = looksLikePlaceholder(line)

    for (const [label, pattern] of PATTERNS) {
      if (lineLooksLikePlaceholder && !HIGH_CONFIDENCE_LABELS.has(label)) continue

      // EVERY match on the line is examined, not just the first. Skipping a known-public
      // constant must not mask a real secret that appears later on the same line — which is
      // exactly what happens if you `continue` after the first match.
      const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
      let match
      while ((match = global.exec(line)) !== null) {
        if (match[0].length === 0) {
          global.lastIndex += 1
          continue
        }
        const matched = match[0].trim()
        if (isKnownPublicConstant(matched)) continue
        findings.push({
          file: relativePath,
          line: index + 1,
          label,
          sample: redact(matched),
        })
      }
    }
  })

  return findings
}

function envIsIgnored() {
  try {
    execFileSync('git', ['check-ignore', '-q', '.env'], { cwd: repoRoot, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------

const findings = []
const notes = []

const tracked = listTrackedFiles()
if (tracked === null) {
  notes.push('Could not run `git ls-files`; nothing was scanned as tracked.')
}

const filesToScan = (tracked ?? []).filter((file) => !SELF_EXEMPT.has(file))
for (const file of filesToScan) {
  findings.push(...scanFile(file))
}

// A scan that read no files has proved nothing, so it must not be able to report PASS. This
// only fires if the file set is genuinely empty, which means the gate below is vacuous.
if (filesToScan.length === 0) {
  findings.push({
    file: '(scan set)',
    line: 0,
    label: 'No files were scanned, so a PASS here would be vacuous',
    sample: 'check that `git ls-files --cached --others --exclude-standard` lists this project',
  })
}

const bundleDir = join(repoRoot, 'dist', 'web')
if (existsSync(bundleDir)) {
  const bundleFiles = listBundleFiles(bundleDir)
  for (const file of bundleFiles) {
    findings.push(...scanFile(file))
  }
  notes.push(`Scanned ${bundleFiles.length} built browser bundle file(s) in dist/web.`)
} else {
  notes.push('No dist/web build present, so no browser bundle was scanned (run `npm run build`).')
}

if (!envIsIgnored()) {
  findings.push({
    file: '.gitignore',
    line: 0,
    label: '`.env` is not git-ignored, so a real secret could be committed',
    sample: 'add `.env` to .gitignore',
  })
}

if (existsSync(join(repoRoot, '.env'))) {
  notes.push('A local .env exists and is correctly git-ignored (its contents were not scanned).')
}

// ---------------------------------------------------------------------------

console.log('')
console.log('Tracked-file credential scan (scored criterion 8)')
console.log('='.repeat(72))
console.log(
  `would-be-committed files scanned : ${filesToScan.length}${tracked === null ? ' (not a git repository)' : ''}`,
)
for (const note of notes) console.log(`note: ${note}`)
console.log(`patterns checked         : ${PATTERNS.length}`)
console.log(`exempt files             : ${[...SELF_EXEMPT].join(', ')}`)
console.log('')

if (findings.length === 0) {
  console.log('RESULT: PASS — no credential, private key or authenticated URL found in tracked files.')
  console.log('')
  process.exit(0)
}

console.log(`RESULT: FAIL — ${findings.length} finding(s):`)
console.log('')
for (const finding of findings) {
  const where = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file
  console.log(`  ${where}`)
  console.log(`    ${finding.label}`)
  console.log(`    ${finding.sample}`)
}
console.log('')
process.exit(1)