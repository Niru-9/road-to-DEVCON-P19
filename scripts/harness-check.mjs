#!/usr/bin/env node
/**
 * `npm run harness:check`
 *
 * Runs the Road To Devcon VII harness against this repo for the
 * "Stop Making Me Explain Myself" / `portable-ai-preferences` problem, and runs the local
 * deterministic gates alongside it.
 *
 * IMPORTANT — read this before trusting any output from this script.
 *
 * `loops evaluate` does NOT return a pass/fail verdict. It returns a self-contained
 * *evaluator prompt* describing the problem's brief, success criteria and weighted judging
 * criteria. Per the harness documentation, that prompt must then be executed inside the
 * project repo by an agent or human with code access, and the resulting assessment recorded
 * by hand. This script therefore:
 *
 *   1. fetches the evaluator prompt and writes it to disk, and
 *   2. runs the gates that genuinely can pass or fail on their own (typecheck, tests, secret
 *      scan), and
 *   3. prints the criteria that remain a matter of human/LLM judgement.
 *
 * It deliberately does NOT compute, infer, or print a score. A green run here means "the
 * mechanical checks passed and the evaluator prompt was retrieved", not "the submission is
 * accepted". Recorded assessments live in docs/harness-run-log.md.
 *
 * Requires: the `loops` CLI on PATH (https://www.npmjs.com/package/loopshouse), authenticated
 * via `loops auth login`.
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EVENT = 'road-to-devcon-vii'
const PROBLEM = 'portable-ai-preferences'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(REPO_ROOT, 'docs', 'harness')
const OUT_FILE = join(OUT_DIR, 'evaluator-prompt.md')

/** Criteria a machine cannot settle. Mirrors p1.md; verdicts are recorded by hand. */
const JUDGEMENT_CRITERIA = [
  '1. Prompt injection cannot reach the model as instructions',
  '2. Values are constrained to an allowlist',
  '3. Unset preferences fall back to a documented default',
  '4. The entered name is normalized before resolution',
  '5. Model calls have a timeout',
  '6. Contrasting recorded cases exist and differ observably',
  '7. Model configuration is not hardcoded',
  '8. No credentials in the repository',
  'Craft: is this a compelling, complete, demoable project?',
]

/**
 * Run a command, resolving with its output instead of throwing, so a failing gate is
 * reported rather than crashing the whole run.
 */
function run(command, args, { label } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      shell: process.platform === 'win32',
      env: process.env,
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => (stdout += d))
    child.stderr?.on('data', (d) => (stderr += d))

    child.on('error', (error) => {
      resolve({ label, command: `${command} ${args.join(' ')}`, code: null, stdout, stderr: error.message })
    })
    child.on('close', (code) => {
      resolve({ label, command: `${command} ${args.join(' ')}`, code, stdout, stderr })
    })
  })
}

function line(char = '-') {
  return char.repeat(72)
}

function heading(text) {
  console.log(`\n${text}\n${line()}`)
}

const results = []

// ---------------------------------------------------------------- prerequisites

heading('0. Prerequisites')

const version = await run('loops', ['--version'])
if (version.code === 0) {
  console.log(`loops CLI      : ${version.stdout.trim()} (on PATH)`)
} else {
  console.log('loops CLI      : NOT AVAILABLE')
  console.log('  install with: npm install -g loopshouse@0.5.0')
  console.log('  then run    : loops auth login')
  console.log('\nCannot fetch the evaluator prompt. Local gates will still run below.')
}

const auth = await run('loops', ['auth', 'status'])
if (version.code === 0) {
  const authText = (auth.stdout + auth.stderr).trim()
  console.log(`auth           : ${authText.split('\n').slice(0, 3).join(' | ') || '(no output)'}`)
  if (auth.code !== 0) {
    console.log('  not authenticated — run: loops auth login')
  }
}

// ------------------------------------------------------- 1. evaluator prompt

heading('1. Evaluator prompt (fetched, NOT executed)')

let promptRetrieved = false
if (version.code === 0 && auth.code === 0) {
  const evaluate = await run('loops', ['evaluate', '--event', EVENT, '--problem', PROBLEM])
  results.push(evaluate)

  if (evaluate.code === 0 && evaluate.stdout.trim()) {
    promptRetrieved = true
    mkdirSync(OUT_DIR, { recursive: true })
    const body = [
      `# Evaluator prompt — ${PROBLEM} (${EVENT})`,
      '',
      `Retrieved with:`,
      '',
      '```sh',
      evaluate.command,
      '```',
      '',
      'This is the raw evaluator prompt. It is not a verdict: execute it inside this repo',
      'and record the resulting assessment in `docs/harness-run-log.md`.',
      '',
      line('='),
      '',
      evaluate.stdout.trim(),
      '',
    ].join('\n')
    writeFileSync(OUT_FILE, body, 'utf8')
    console.log(`retrieved OK   : ${evaluate.stdout.trim().length} chars`)
    console.log(`written to     : docs/harness/evaluator-prompt.md`)
  } else {
    console.log(`FAILED         : exit ${evaluate.code}`)
    if (evaluate.stderr.trim()) console.log(evaluate.stderr.trim().slice(0, 500))
  }
} else {
  console.log('skipped        : `loops` unavailable or not authenticated')
}

// ---------------------------------------------------------- 2. local hard gates

heading('2. Local deterministic gates (these really do pass or fail)')

for (const [label, args] of [
  ['typecheck', ['run', 'typecheck']],
  ['tests', ['run', 'test']],
  ['secret scan', ['run', 'check:secrets']],
]) {
  process.stdout.write(`  ${label.padEnd(12)} … `)
  const result = await run('npm', args)
  results.push(result)
  const ok = result.code === 0
  console.log(ok ? 'PASS' : `FAIL (exit ${result.code})`)
  if (!ok) {
    const detail = (result.stdout + result.stderr).trim()
    console.log(
      detail
        .split('\n')
        .slice(-25)
        .map((l) => `      ${l}`)
        .join('\n'),
    )
  }
}

// -------------------------------------------------------------- 3. the summary

heading('3. Criteria that still require judgement')

for (const criterion of JUDGEMENT_CRITERIA) {
  console.log(`  [ manual ] ${criterion}`)
}

heading('Result')

const gates = results.filter((r) => r.command.startsWith('npm'))
const failed = gates.filter((r) => r.code !== 0)

console.log(`  local gates    : ${failed.length === 0 ? `PASS (${gates.length}/${gates.length})` : `FAIL (${failed.length} of ${gates.length})`}`)
console.log(`  evaluator prompt: ${promptRetrieved ? 'RETRIEVED' : 'NOT RETRIEVED'}`)
console.log(`  criterion verdicts: NOT COMPUTED BY THIS SCRIPT (by design)`)
console.log('')
console.log('  A passing run means the mechanical checks are green and the evaluator prompt was')
console.log('  fetched. It does not mean the submission is accepted. To complete the review:')
console.log('    1. open docs/harness/evaluator-prompt.md')
console.log('    2. execute it against this repo')
console.log('    3. record strengths, gaps and verdicts in docs/harness-run-log.md')
console.log('')

process.exit(failed.length === 0 ? 0 : 1)