# Submission report — P1 "Stop Making Me Explain Myself" (Portable AI Preferences)

Prepared from observed command output only. Every row below was produced by a command listed in
[Checks actually run](#checks-actually-run). Nothing here is an official score: `loops evaluate`
returns an evaluator *prompt*, not a verdict, and this repository's `npm run harness:check` says of
itself that it computes no score.

## Target repository

- Project folder: `p1/`
- Remote: `https://github.com/Niru-9/road-to-DEVCON-P19`
- Remote state when checked: **empty** (`git ls-remote` → 0 refs), so no remote history is at risk.

## The eight scored checks, and what was actually observed

| # | Check (`p1.md`) | Observed | Evidence |
| --- | --- | --- | --- |
| 1 | No ENS record value is interpolated into the system prompt (20) | **PASS** | `buildSystemMessage(values: PreferenceValues)` takes only closed literal unions — `src/shared/prompt.ts:98`; the question is a separate `user` message — `src/shared/prompt.ts:127`; a second guard scans the built prompt for record substrings and throws — `src/shared/prompt.ts:144`. Suite `criterion 1 — no ENS record value is interpolated into the system prompt` (`src/shared/preferences.test.ts`) and `criterion 1 — the request carries a separate system and user message` (`src/server/llm.test.ts`). Re-asserted on every recorded run: `npm run record` → `no raw record text appears in any system prompt`. |
| 2 | Each preference value is checked against an allowlist (12) | **PASS** | Five closed lists — `src/shared/preferences.ts:59` and following; `resolvePreferences()` is the only path from a record to an effective value — `src/shared/preferences.ts:389`. Suite `criterion 2 — each preference value is checked against an allowlist`. The `hostile.eth` recorded case shows four out-of-allowlist values discarded in a real run. |
| 3 | An unset record falls back to a named default (10) | **PASS** | `PREFERENCE_DEFAULTS` names all five — `src/shared/preferences.ts:99`; the `minimal.eth` recorded case returns 200 with four defaults and every preference labelled `source: default`. Suite `criterion 3 — an unset record falls back to a named default`. |
| 4 | The entered name is normalized before resolution (8) | **PASS** | `normalizeEnsName()` (ENSIP-15 `normalize`) is the only way a name enters the module — `src/server/ens.ts:72`, applied at `src/server/ens.ts:228` before any `getEnsText` — `src/server/ens.ts:155`. Suite `criterion 4 — the entered name is normalized before resolution`. |
| 5 | The model request has an explicit timeout (7) | **PASS** | Per-attempt `AbortController` + `setTimeout(config.llmTimeoutMs)`, cleared in `finally` — `src/server/llm.ts:163-166`. Suites `criterion 5 — the model request has an explicit timeout` (including *aborts a hung request*, *does not retry after a timeout*) and `criterion 5 (config half)`. |
| 6 | Recorded cases pair one question with two or more preference sets, each with a stated expected property (10) | **PASS (now with the expectation stated)** | `docs/recorded-cases.md` / `.json`, regenerated this session by `npm run record`: 1 question sent byte-for-byte identically under **4** preference sets, 4 pairwise-distinct system prompts, and each case now declares its expected property (`expected`: language, answer length with a word bound, reading level, format) *before* the model call, plus a mechanical measurement of what came back (`observed`). Previously the cases stated no expected property, which is an explicit fail condition — fixed, see [Fix made this session](#fix-made-this-session). |
| 7 | Model id and provider endpoint are read from configuration (5) | **PASS** | `llmBaseUrl` / `llmModel` / `llmTimeoutMs` come from env — `src/server/config.ts:111-114`; the call site reads config only — `src/server/llm.ts:169-178`. Suites `criterion 7 — model id and provider endpoint are read from configuration` and `criterion 7 — endpoint and model id come from configuration`. |
| 8 | No credential appears in any tracked file (8) | **PASS** | `npm run check:secrets` → `RESULT: PASS`, 36 tracked-file candidates, 17 patterns, plus the 5 built browser bundle files in `p1/dist/web`. Suite `criterion 8 (config half) — secrets never leave the server`. `.env` exists locally and is git-ignored; `.env.example` is placeholders only. |

**8 of 8 checks pass on local evidence. No official numeric score is claimed.**

## Checks actually run

| Check | Command | Observed result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | clean, no output |
| Tests | `npm run test` | **118 passed / 118**, 6 files, 7.6 s |
| Secret scan | `npm run check:secrets` | **PASS** — 36 files, 17 patterns, 5 bundle files scanned |
| Chained gate | `npm run check` | **exit 0** |
| Repo-local harness wrapper | `npm run harness:check` | **PASS (3/3)** — typecheck, tests, secret scan; evaluator prompt retrieved (9 461 chars); prints `criterion verdicts: NOT COMPUTED BY THIS SCRIPT (by design)` |
| Production build | `npm run build` | **PASS** — built in 6.69 s into `p1/dist/web` (166 kB JS / 6.1 kB CSS) |
| Criterion 6 recording | `ALLOW_DEMO_FIXTURES=true npm run record` | **PASS** — 4/4 profiles, 4 distinct system prompts, every case states its expected property |

Not run this session, because nothing in the release path depended on them: manual UI review, the
264-read live ENS probe, and a hosted-provider model run. The harness's full stress process is not
part of this project's documented gates.

## Fix made this session

**Criterion 6 stated no expected property.** The recorded cases showed preferences, prompts and
answers, but no case declared what the answer was *expected* to look like — and `p1.md` lists
"cases state no expected property" as a fail condition. The earlier harness report had already
flagged this as the one criterion only partially met.

- Cause: `scripts/record-cases.ts` recorded `answer` but had no expectation field, so the artifact
  described the run instead of committing to an outcome.
- Fix: added an `EXPECTED` table keyed by profile, declared in the script before any model call
  (`language`, `length`, `reading`, `format`, `maxWords` mirroring the app-authored bounds in
  `prompt.ts`, and a one-line statement), plus `observeAnswer()` which measures the returned text
  (word count, sentence count, bullet lines, accented words, within-bound boolean). Both are written
  into `docs/recorded-cases.json` and rendered as a table plus a per-case section in
  `docs/recorded-cases.md`. The measurement is reported, not asserted: whether a model provider
  obeys a style rule is a property of that provider, not of this application.
- Nothing was weakened: the question-identity, prompt-distinctness, byte-exact-prompt and
  no-leakage assertions are unchanged, and the run still exits 1 on any of them.
- Rerun: `npm run record` → `RESULT: PASS` with 4/4 recorded and every expectation printed;
  `npm run check` → **exit 0**, 118 tests, secret scan PASS; `npm run build` → PASS.

## What the recorded evidence now shows, honestly

| Case | Expected | Measured on the returned text |
| --- | --- | --- |
| `ana.eth` | `pt`, short (≤45 words), simple, bullets | 15 words, **within bound**, 3 accented words (Portuguese), **0 bullet lines** |
| `kai.eth` | `en`, detailed, technical, plain prose | 157 words, 7 sentences, two paragraphs, no accents |
| `minimal.eth` | `pt` (only record set), brief (≤90), plain — four defaults | 23 words, within bound, 5 accented words |
| `hostile.eth` | all five defaults (`en`, brief ≤90, plain, no tables/jargon) | 29 words, within bound, no accents, no trace of the injected text |

The one declared property the configured local 3B model did not obey is `format=bullets` on
`ana.eth`. That is stated and measured rather than hidden. `qwen3:4b` was probed and returns an
empty `content` field (reasoning consumes the budget), so no stronger local model was available;
the intended remedy is a stronger `LLM_BASE_URL` / `LLM_MODEL`. The application's own contribution
— the exact system prompt per profile — is asserted byte-for-byte by the recording script.

## Still NOT VERIFIED — blocked by ENS setup

| Requirement | Status | Why |
| --- | --- | --- |
| "Set those records on at least two Sepolia ENS names with clearly different preferences" | **NOT VERIFIED / BLOCKED BY ENS SETUP** | No ENS text record is published for any demo name. `publishedOnChain: false` on all four profiles in `src/shared/demo-names.ts`, and the recorded artifact labels every case "simulated, not on chain". Publishing requires a funded Sepolia wallet and a MetaMask signature, which is out of scope for this session. |
| Success criterion "Ana types her ENS name once, and every answer arrives in short Portuguese sentences" against live chain data | **PARTIAL** | Verified end-to-end against the labelled sample profiles and against a stubbed JSON-RPC resolver in `src/server/api.test.ts`; the on-chain half is unproven. Any real name typed today resolves to the five named defaults, because no real name carries these records. |
| Official scored evaluation / numeric points | **not claimed** | `loops evaluate --event road-to-devcon-vii --problem portable-ai-preferences` returns an evaluator prompt, not a verdict. |

No ENS record was published and no transaction was sent in this session. The root `.env` was not
touched. No credential was printed, requested or written to a tracked file.

## Status

**Ready for repository preparation**, with one honest limitation attached: the code, tests, gates,
build and recorded cases are green and self-consistent, and the brief's *publishing* requirement is
outstanding because it needs ENS setup that is not available here. Submitting the repository does
not misrepresent that state — the README and this report both say the profiles are simulated.

Known, deliberately unfixed: `npm install` reports audit findings in the transitive tree; not
force-fixed, because that would move versions across the `viem` / `zod` trees the app depends on.
