# action.md — P1 "Portable AI Preferences" (Road To Devcon VII)

Persistent handoff log for this repository. Source of truth for cross-session continuity.
Status legend: `TODO` / `IN_PROGRESS` / `DONE` / `BLOCKED` / `FAILED`

## Problem

Build the P1 MVP only: **Portable AI Preferences** — "Stop Making Me Explain Myself".

A user enters their ENS name once. The app normalizes it with ENSIP-15, reads documented
preference text records from **Sepolia** ENS, validates every value against a strict allowlist,
substitutes explicit named defaults for unset/empty/unsupported records, maps only validated
enum values to **app-authored** instruction fragments, and calls a configured OpenAI-compatible
model endpoint with a **separate system message and separate user message** and an **explicit
timeout**. Raw ENS record content must never reach the system instruction.

Deliverable: a public-ready repo with the assistant, the documented preference format, the
Sepolia names tested, and recorded example cases.

## Goal

Ship a complete, professional, demo-ready P1 MVP that satisfies **all 8 scored checks in
`p1.md`** (80 points), verified with the Agent Harness as the primary acceptance/stress test,
plus deterministic local checks and a documented evidence trail.

## The 8 scored acceptance criteria (from `p1.md`)

| # | Criterion | Pts |
|---|-----------|-----|
| 1 | No ENS record value is interpolated into the system prompt | 20 |
| 2 | Each preference value is checked against an allowlist | 12 |
| 3 | An unset record falls back to a named default | 10 |
| 4 | The entered name is normalized before resolution | 8 |
| 5 | The model request has an explicit timeout | 7 |
| 6 | Recorded cases pair one question with 2+ preference sets | 10 |
| 7 | Model id and provider endpoint are read from configuration | 5 |
| 8 | No credential appears in any tracked file | 8 |

## Constraints

- Work in this repository only. Do **not** start P2 or P3 here.
- Never place credentials, API keys, private keys, or authenticated RPC URLs in tracked
  files or browser bundles. Ignore local `.env`; commit placeholder-only `.env.example`.
- Never ask the user to paste secrets into chat.
- Read-only ENS lookup must work **without** a connected wallet. MetaMask is optional.
- Only run harness commands that the installed harness actually documents.
- Never claim a check passed unless harness output confirms it.

## Target architecture (smallest sensible, from `plan.md`)

- TypeScript, Node 22, Vite + React single-screen UI, small TypeScript API server.
- `viem` for ENSIP-15 `normalize()` + Sepolia `getEnsText()`.
- `zod` for validation at boundaries.
- One OpenAI-compatible chat API configured purely by env vars, server-side only.
- `docs/problem-statement.md` (copy of `p1.md`), `docs/preference-format.md`,
  `docs/acceptance-checklist.md`, `docs/harness-run-log.md`, `docs/demo-names.md`,
  `cases/recorded-cases.json`, README with setup/run/test/demo + limitations.

---

## Task log

### T0 — Session bootstrap and environment verification
- **Status:** `DONE`
- **Description:** Read `p1.md` + `plan.md`; verify Node/git; inventory repo files.
- **Intended outcome:** Environment known, task list created, `action.md` exists.
- **Progress:**
  - Read `p1.md` (112 lines) and `plan.md` (262 lines, contains duplicated P1 section).
  - `node -v` → `v22.22.0` — satisfies "≥20.12", and is 22 LTS as preferred. ✅
  - `npm -v` → `11.6.2`. `git --version` → `2.51.0.windows.1`.
  - Repo inventory at start: only `p1.md`, `p2.md`, `p3.md`, `plan.md`. No source code,
    no `package.json`, no git repo, no `.env`, no `action.md`.
  - Conclusion: no existing project stack to preserve → choose the smallest sensible
    stack described above.

- Conclusion: no existing project stack to preserve → choose the smallest sensible
    stack described above.
  - **Verification:** `node -v` → `v22.22.0`; `Get-ChildItem -Force` → only the 4 `.md`
    task files. **Observed result:** environment confirmed, no stack present.

### T1 — Install and sign in to the Agent Harness
- **Status:** `DONE`
- **Description:** Run `npx loopshouse add road-to-devcon-vii` from repo root; complete browser sign-in.
- **Intended outcome:** Harness installed + signed in, or a precise, factual BLOCKED record of why not.
- **Commands and observed results:**
  - `node -v` → `v22.22.0` ✅ (≥20.12 required, 22 LTS preferred).
  - **Attempt 1** `npx --yes loopshouse add road-to-devcon-vii` → **FAILED**:
    `Could not fetch the skill` / `code: SKILL_FETCH_FAILED` / `message: fetch failed`.
  - Diagnosis: `npm view loopshouse` showed published `latest = 0.5.0`, but npx ran a
    **cached 0.4.0**. The registry and the Loops platform were both reachable
    (`loops events --event road-to-devcon-vii` returned the event), so this was a
    stale-client failure, not a network failure.
  - **Attempt 2** `npx --yes loopshouse@0.5.0 add road-to-devcon-vii --yes` → **SUCCESS**:
    `Skill ready — Road To Devcon - VII`; `loops CLI v0.5.0 installed globally`;
    wrote `.claude\skills\loops-road-to-devcon-vii\SKILL.md` and
    `.agents\skills\loops-road-to-devcon-vii\SKILL.md`;
    `Signed in as ndkindia09@gmail.com`; `authenticated: true`.
- **Verification:** `loops auth status` → `authenticated: true`,
  `email: ndkindia09@gmail.com`, `userId: 932a34dc-...`. `loops --version` → `0.5.0`
  (matches the skill frontmatter `version: 0.5.0`).
- **Note:** harness skill files were written *inside this repo* (`.agents/`, `.claude/`).
  They contain no credentials and are safe to track.
- **Credits:** `loops credits --event road-to-devcon-vii` → `{used: 0, cap: 100, remaining: 100}`.
- **Submission:** `loops project get --event road-to-devcon-vii` → `{exists: false, project: null}`.
  Expected at this stage; a compete submission is only created once a real public
  GitHub repo exists, and only with the builder's explicit approval.

### T2 — Read installed harness instructions; find documented P1 evaluation command
- **Status:** `DONE`
- **Description:** Inspect the installed skill/CLI help to find the supported evaluation command. Do not invent one.
- **Intended outcome:** Exact documented command string recorded in this log.
- **What the installed skill documents** (`.agents/skills/loops-road-to-devcon-vii/SKILL.md`, 171 lines):
  - `loops auth status`, `loops --version` — session/existence checks.
  - `loops enroll --event road-to-devcon-vii` — idempotent registration (needs
    displayName/location/ageGroup; **never invent these**, ask the builder).
  - `loops knowledge query --event road-to-devcon-vii --problem <slug> -q "<q>"` — 1 credit per query.
  - `loops project get|create|update --event road-to-devcon-vii` — the submission.
  - **`loops evaluate --event road-to-devcon-vii --problem <slug>` — free, attaches the
    project record, and is THE documented per-problem evaluation command.**
  - Confirmed event problem slugs: `portable-ai-preferences` (P1), `community-people-finder`,
    `ens-agent-router`. Event `stage: registration_open`, `eventType: compete`,
    submission deadline `2026-10-04T17:41:00.000Z` (Oct 4, 2026 11:41 PM Asia/Calcutta).
- **CRITICAL nuance about `loops evaluate` (recorded so no future session overclaims):**
  the skill states it *"Fetch[es] a self-contained evaluator prompt for one problem …
  then **execute the prompt yourself inside the project repo**"*. So it is **NOT** an
  automated pass/fail test runner and emits **no machine-readable criterion results**.
  It returns an evaluator prompt that the agent then executes to produce alignment
  feedback (verified strengths / gaps / focus). Consequence for honest reporting:
  - Criterion-level results from this command are **LLM-judged**, and must be labelled as
    "loops evaluate output", never as an automated test pass.
  - The deterministic machine-checkable evidence must come from the repo's own checks
    (`npm test` / local checks), which `plan.md` asks for anyway.
  - No `harness:check` subcommand exists; `npm run harness:check` in this repo is a
    **repo-local wrapper** that runs `loops evaluate` + local checks, and is labelled as such.

### T3 — Query the knowledge graph for `portable-ai-preferences`
- **Status:** `DONE` (queried; graph returned no evidence)
- **Description:** Use the documented knowledge query command; ask about ENS record formats and acceptance criteria.
- **Intended outcome:** Answers captured and used to confirm design details.
- **Command form** (exactly as documented in the installed skill, not invented):
  `loops knowledge query --event road-to-devcon-vii --problem portable-ai-preferences -q "<question>"`
- **4 queries run, all returned empty evidence:**
  1. `-q "What ENS text record key format and naming convention ... global keys vs reverse-dot service keys ... viem getEnsText"`
  2. `-q "scored acceptance criteria for Stop Making Me Explain Myself"`
  3. `-q "ENS text records"`
  4. `-q "viem getEnsText normalize Sepolia preferences language reading level"`
- **Verbatim result of every query:** `{"evidence":"No relevant context was retrieved for this query. Try a more specific query."}`
- **Credits:** `used: 2, remaining: 98` after the first three queries (platform counts
  differently than one-per-invocation); still ample.
- **Conclusion / consequence:** the `portable-ai-preferences` knowledge graph is **not yet
  indexed** (event started Oct 2 2026, index likely still building — the skill itself warns
  *"Problem briefs, stacks, and rubrics unlock when the event starts"*). So it provided **no
  guidance**. `p1.md`, `plan.md`, and the public ENSIP-5/ENSIP-15 specs are therefore the
  authority for record format and criteria in this build. Recorded as a real limitation.
- **Next step:** T4 — baseline `loops evaluate`.

### T4 — Baseline harness evaluation
- **Status:** `DONE`
- **Description:** Run the harness P1 evaluation on the empty repo and record actual output verbatim.
- **Intended outcome:** Baseline criterion-level results (expected: mostly failing).
- **Command:** `loops evaluate --event road-to-devcon-vii --problem portable-ai-preferences`
- **Observed:** returned the full self-contained evaluator prompt (problem brief,
  successLooksLike, 7 resources, and the weighted judging rubric). Full text + baseline
  per-criterion table recorded in **`docs/harness-run-log.md` → Run 1**.
- **Baseline result: 1/8 PASS (criterion 8 only, vacuously — no tracked files existed),
  7/8 FAIL** because no application code existed. Recorded honestly.
- **Key value of the baseline run:** the prompt carries the weighted judging rubric
  ("Problem interpretation, product judgment & code craft", 20%) and it names three
  *wrong-shaped builds that pass the public checks*: preferences living in the app's own DB
  with ENS as a login label; preferences that only change a greeting/badge while answers
  barely differ; a developer-facing tool where the user types raw record keys. Plus it
  explicitly says "Use service keys for any custom record format you invent" (ENSIP-5).
  **These 5 design constraints are now locked in** (see docs/harness-run-log.md Run 1).
- **Separately verified in the same window:** public Sepolia RPC reachable —
  `https://ethereum-sepolia-rpc.publicnode.com` → `eth_chainId = 0xaa36a7` (11155111 ✓),
  `eth_blockNumber = 0xb492a3` (11,832,483). So live ENS reads are genuinely testable.
- **Git:** `git init` done in `N:\dev8`; `user.name = Niru-9`,
  `user.email = ndkindia09@gmail.com`. Nothing committed yet.

### T5 — Repo skeleton + config hygiene
- **Status:** `IN_PROGRESS`
- **Description:** git init, `.gitignore` (`.env`, build output), placeholder `.env.example`, TS/Vite/Express skeleton, `docs/`.
- **Intended outcome:** `npm install` succeeds; dev server boots with actionable config errors.
- **Depends on:** T0
- **Progress:**
  - `package.json`, `.gitignore`, `.env.example`, `tsconfig.json`, `vite.config.ts`,
    `vitest.config.ts` written. `.env` is ignored; `.env.example` holds placeholders only.
  - `npm install` → **added 233 packages in 30s**, no errors. Resolved versions:
    viem 2.57.2, zod 3.25.76, express 4.22.3, vite 5.4.21, react 18.3.1.
  - Verified viem's real API surface from its shipped types:
    `normalize(name: string): string` (ENSIP-15, `viem/ens`) and
    `getEnsText(client, { name, key }): Promise<string | null>` (`viem/ens`).
    viem's own doc example does `getEnsText(client, { name: normalize('wevm.eth'), key })`,
    i.e. normalize-before-resolve is the library's documented pattern.
  - `src/shared/preferences.ts` — format, closed allowlists, named defaults, resolution.
  - `src/shared/prompt.ts` — system message from app-authored literals only.
  - `src/server/config.ts` — env config, `ConfigError` with actionable text, redacted view.
  - `src/server/ens.ts` — `normalizeEnsName` is the ONLY entry point for user input;
    per-key read isolation; bounded RPC timeouts.
  - `src/server/llm.ts` — explicit per-attempt `AbortController` timeout, bounded retry
    honouring `Retry-After`, separate system/user messages.
- **Local model provider found (no secrets needed):** Ollama is installed and serving at
  `http://localhost:11434/v1` with model **`qwen3:4b`**. Verified a real chat completion
  through Node `fetch`: HTTP 200, correct **UTF-8** Portuguese output. (A PowerShell
  `Invoke-RestMethod` probe showed mojibake; that was PowerShell 5.1 response decoding,
  not the model. Node returns correct `É um sistema descentralizado que registra transações…`.)
  This gives a genuinely free, key-free, OpenAI-compatible provider for real recorded cases.

### T9 — Two documented Sepolia demo names  [moved up: discovery needed a decision]
- **Status:** `IN_PROGRESS`
- **Description:** Document real Sepolia ENS names + their record keys/values; verify reads.
- **Intended outcome:** `docs/demo-names.md` with names and live read confirmation.
- **Depends on:** T6
- **Live Sepolia investigation performed (probes in `scripts/probe-*.ts`):**
  - Public RPC confirmed: `chainId 0xaa36a7` = 11155111 ✓, head ≈ 11,832,483.
  - Probed 20 candidate names through `normalize` + Universal Resolver. These **do resolve
    on Sepolia**: `demo.eth` (0xD613cb8159…), `sepolia.eth` (0x9703d9cF2F…),
    `vitalik.eth` (0xd8dA6BF269…), `wrapped.eth` (0x0cCA544b80…), `nick.eth` (0xb8c2C29ee1…),
    `name.eth` (0x3ca7c16b61…). The rest returned no address.
  - **None of them has any text records**: all five documented preference keys AND the
    standard global keys (`avatar`, `url`, `description`, `name`, `email`, `com.twitter`)
    return `null` for every one of them.
  - Diagnosed the cause rather than assuming a bug: all six names point at the **same**
    resolver `0x322B7581cA210a69c6D0e0D7c88a7688D2789Cb0`, and calling `text(bytes32,string)`
    on it directly **reverts**. So these are placeholder/vanity registrations with a
    resolver that does not implement text records. The read path is correct; Sepolia
    simply has no pre-registered names carrying text records.
- **CONSEQUENCE / BLOCKER (real, and must be reported):** the brief's *"set those records on
  at least two Sepolia ENS names"* requires a funded Sepolia wallet and a signing key.
  I have neither, and the user must not be asked to paste secrets into chat. So the two demo
  names **cannot be published by me in this session.**
- **Mitigation being built (so nothing else is blocked):**
  1. ~~`scripts/set-records.ts` — a real publisher that writes all five keys for any Sepolia
     name from a signer in the git-ignored `.env`. One command, no code change.~~
     **SUPERSEDED by T14** — this private-key publisher was deleted. Publishing is now a
     MetaMask-signed browser flow; see T14 and T9.
  2. `docs/demo-names.md` — the four intended names, their exact record payloads, and the
     exact publish command.
  3. Clearly-labelled **sample profiles** so the demo and recorded cases are reproducible
     today, with the identical validation + prompt + model pipeline, never used for a real
     ENS name and never described as live chain data.
- **Next step:** finish the publisher script + sample profiles, then wire the API routes.

### T6 — Core flow: normalize → read → validate → defaults → prompt → model call
- **Status:** `DONE`
- **Description:** ENSIP-15 normalize, Sepolia `getEnsText` reads, zod allowlists, named defaults, app-authored instruction fragments, separate user message, env-configured model id/endpoint, explicit timeout.
- **Intended outcome:** Working end-to-end ask flow in the UI.
- **Depends on:** T5
- **Code written:** `src/shared/preferences.ts` (format + validation), `src/shared/prompt.ts`
  (system message), `src/server/config.ts`, `src/server/ens.ts`, `src/server/llm.ts`,
  `src/server/index.ts` (Express API: `/api/health`, `/api/demo/profiles`,
  `/api/preferences/resolve`, `/api/ask`), `src/shared/demo-names.ts` (4 profiles).
- **Format decided (5 preferences, ENSIP-5 reverse-dot service keys, namespace
  `com.portableprefs`):** `.language` (en/pt/es/fr/de/hi), `.length` (short/brief/detailed),
  `.reading` (simple/standard/technical), `.format` (plain/bullets/steps),
  `.avoid` (comma list of tables/code/jargon/emojis/links, or `none`).
- **Local checks written and passing — `npx vitest run` → 69/69 PASS across 4 files:**
  - `src/shared/preferences.test.ts` (32) — criteria 1/2/3 + adversarial.
  - `src/server/config.test.ts` (14) — criteria 7/8 (config half).
  - `src/server/ens.test.ts` (9) — criterion 4 normalization contract.
  - `src/server/llm.test.ts` (14) — criteria 1/5/7 over real local HTTP servers.
- **Three real defects found by the tests and fixed in the source (not papered over in the tests):**
  1. `AVOID_MAX_TOKENS = 4` was smaller than the 5-token allowlist, so a record listing
     every valid token was rejected as malformed. Replaced with `AVOID_MAX_SEGMENTS = 16`,
     a DoS guard on segment count rather than a semantic limit.
  2. `avoid = "none"` (a legitimate allowlisted record value) was reported with
     `source: 'default'`. Now returns `source: 'record'` with `value: []`.
  3. `normalize('notaname')` returns `'notaname'` **without throwing**, so a root-less string
     would have reached the resolver. `normalizeEnsName` now additionally requires
     `/^.+\.[a-z]{2,}$/`. Verified behaviour table recorded in action.md.
  Also: `AbortError` detection was `instanceof Error`, but undici raises a `DOMException`;
  replaced with a duck-typed `isAbortError`.
- **Criterion 5 proven at the HTTP boundary:** the timeout test hung a real socket forever
  and observed **1217 ms elapsed for a 1200 ms bound, with exactly 1 request sent**
  (i.e. no retry past the bound).
- **Criterion 8 scanner written (`scripts/scan-secrets.mjs`, line-anchored, 17 patterns)
  and NEGATIVE-TESTED.** Planted a fake credential file and confirmed it fails with
  exit code 1 on all four planted shapes: OpenAI key, Infura project key, `0x`+64-hex
  private key, and `PRIVATE_KEY=` assignment. Then removed it and confirmed
  `RESULT: PASS`, exit code 0. A scanner that cannot fail proves nothing, so this
  negative test matters. First version had 4 false positives (a doc comment with a
  `user:pass@host` example, and a mnemonic regex that matched ordinary prose) —
  fixed by rewriting the comment and making the mnemonic pattern require a whole line
  to be exactly 12–24 bare lowercase words.
- **`npx tsc --noEmit` → clean.**
- **Committed:** `9c9f8ea` "P1 scaffold: ENSIP-15 normalize, allowlisted preferences with
  named defaults, app-authored prompt, bounded model call". 29 tracked files.
  `.env` confirmed absent from the index (git-ignored).
- **Next step:** T7 — build the UI, then run the API end to end against the local provider.

### T7 — Browser UI (no wallet required to read)
- **Status:** `DONE`
- **Description:** Single-screen UI: look up a name, see effective preferences with per-field
  provenance, pick a labelled sample profile, ask a question, inspect the exact messages sent.
- **Intended outcome:** A reviewer can exercise every criterion from the browser without a wallet,
  a funded key, or reading the source.
- **Depends on:** T5, T6
- **Code written:** `src/web/index.html`, `src/web/main.tsx`, `src/web/styles.css`.
  `vite.config.ts` builds it to `dist/web` and proxies `/api` to the server in dev.
- **`npm run build` → OK.** 30 modules, `dist/web/assets/index-*.js` 152 kB (49 kB gzip),
  CSS 6.1 kB.
- **Design decisions:**
  - Deliberately NOT a wallet-first dApp. ENS reads are `eth_call`s, so they need no wallet.
    `Connect wallet` is an optional convenience and no transaction is ever signed.
  - Every preference tile shows its `source` (`from ENS record` vs `default — <label>`), plus
    the rejected value and any discarded not-allowed tokens, so criteria 2 and 3 are visible
    rather than asserted.
  - The exact `system` + `user` message pair is shown in a disclosure under each answer, and the
    raw records are shown separately beside it. That makes criterion 1 inspectable by eye: the
    prompt visibly contains only fixed sentences, never record text.
  - Sample profiles are labelled `simulated` in the UI and carry a warning banner, because they
    are not chain data.
- **Criterion 8 verified on the built artefact, not just the source.** Independently searched the
  minified bundle for `sk-`, `api_key`, `11434`, `qwen3`, `sepolia-rpc`, `publicnode`,
  `LLM_API_KEY`, `SEPOLIA_RPC` → **no matches**. The bundle has no model endpoint, no RPC URL and
  no key; it only calls this app's own `/api/*` routes. `scripts/scan-secrets.mjs` also scans
  `dist/web` automatically once a build exists.
- **Fixed a real type error while adding this:** `Harness.setMode` in `llm.test.ts` had been
  bolted on with a spread + `as any` + return-type cast, so `tsc` could not see it (13 errors).
  Replaced with a properly declared `setMode` on the `Harness` interface. `tsc` now clean.

### T8 — Recorded contrasting cases
- **Status:** `DONE`
- **Description:** One identical question sent under every profile, with recorded prompts/answers
  and assertions that the differences match the stored values.
- **Intended outcome:** Criterion 10 evidence that is regenerable rather than hand-written.
- **Depends on:** T6
- **Code written:** `scripts/record-cases.ts` (`npm run record`). It boots the real Express app on
  an ephemeral port and drives it over real HTTP, so the recording is what a user would get.
- **Observed run** (`LLM_TIMEOUT_MS=300000 npm run record`, local `qwen3:4b` via Ollama):
  - `ana.eth` 45521 ms, `kai.eth` 18429 ms, `minimal.eth` 18051 ms, `hostile.eth` 16893 ms
  - **4 distinct system prompts across 4 profiles. RESULT: PASS.**
  - Written to `docs/recorded-cases.md` and `docs/recorded-cases.json`.
- **Observed evidence highlights:**
  - `ana.eth` → European Portuguese, 45-word cap, simple language, bulleted, no tables/code.
  - `kai.eth` → English, detailed paragraphs, technical vocabulary, plain prose. Same question,
    visibly different output. This is criterion 6.
  - `minimal.eth` (only `language` set) → other four fall back to their **named** defaults
    (`brief`, `standard`, `plain`, no restrictions). Criterion 3.
  - `hostile.eth` → all four injection payloads rejected and defaulted; `avoid` kept only the two
    allowlisted tokens (`tables, jargon`) and **discarded `rm -rf /`**. Criteria 1 and 2.
- **One assertion I wrote was wrong and had to be replaced.** It checked that the system prompt
  *contains* the raw allowlist tokens (`en`, `standard`, …). That is unreliable: `'en'` matches as
  a substring of "answer"/"language" and `'plain'` appears in several unrelated fragments, so two
  profiles passed by accident while two genuinely-correct profiles failed. Replaced with a much
  stronger invariant: the server's returned `systemMessage` must be **byte-identical** to
  `buildSystemMessage(resolvePreferences(records))` recomputed independently in the script, with
  the first differing line reported on failure. That catches insertion, reordering and
  interpolation of anything extra, rather than checking for the presence of a few words.
- **Encoding verified, not assumed.** The PowerShell console renders UTF-8 incorrectly, so the
  Portuguese answer looked like mojibake on screen. Checked the file bytes directly: the recorded
  answer contains U+00E7 and U+00E3, contains no U+00C3 double-encoding, and the markdown contains
  a correct U+2014 with no U+FFFD replacement characters. The files are fine; only the terminal
  display is lossy.

### T7 — UI polish + read-only-without-wallet path
- **Status:** `DONE` — superseded and delivered by "T7 — Browser UI" above. The UI reads
  preferences with no wallet: `Connect wallet` is optional, only prefills a name, and no
  transaction is ever signed. Loading / error / empty / partial states are implemented
  (`healthError`, `resolveError`, `askError`, the all-defaults notice, the read-failure warning).

### T8 — Failure and adversarial handling
- **Status:** `DONE`
- **Delivered by:**
  - **Unset** → named default. Recorded via `minimal.eth`.
  - **Empty / whitespace** → rejected as malformed, default applies (tested).
  - **Malformed** → rejected, default applies (tested).
  - **Prompt injection in records** → `hostile.eth` profile plus adversarial tests in
    `src/shared/preferences.test.ts`; all four injected fields default, `avoid` drops
    `rm -rf /`, and no injection text reaches the prompt.
  - **RPC failure** → per-key isolation so one reverting key cannot abort the other four.
  - **Model timeout / 429 / 500** → explicit abort, bounded retry, `ModelTimeoutError` and
    `ModelProviderError` mapped to 504/502 with actionable messages (tested over real HTTP).
  - **Oversized input** → name ≤ 200, question ≤ 2000, body ≤ 64 kB, `avoid` ≤ 16 segments.
  - **Resolver revert vs unset record** — distinguished. See T13.

### T14 — Publish records via MetaMask signing (replaces the private-key publisher)
- **Status:** DONE
- **Requested change (user):** P1 record publishing must sign with the user's **MetaMask**
  wallet on **Sepolia**. Do **not** use or request `PUBLISHER_PRIVATE_KEY`; do **not** store a
  wallet private key in `.env`; never request a seed phrase or private key.
- **Required behaviour:**
  - Connect MetaMask and verify the chain is Sepolia **before** any write is enabled.
  - Show the connected address.
  - Clear, distinct errors for: wallet disconnected, wrong network, and user-rejected
    transaction.
  - Signing happens in the browser. No key material reaches the server or any config file.
  - Other config (RPC URL, model API key) stays in the ignored `.env` with placeholders in
    `.env.example`. An RPC credential is **not** a signing key and must not be treated as one.
  - No real credentials or authenticated URLs committed.
- **Intended outcome:** `scripts/set-records.ts` private-key flow removed; a MetaMask-signed
  Sepolia publish path replaces it; README/setup updated; P1 harness evaluation re-run and
  recorded here and in `docs/harness-run-log.md`.
- **Depends on:** T6 (core flow), T13 (`recordStatus` diagnostics already threaded through).
- **Progress:** _(nothing implemented yet)_
- **Progress (updated):**
  - `src/web/wallet.ts` — EIP-1193 connect, `eth_chainId` check against Sepolia
    (`11155111` / `0xaa36a7`), `wallet_switchEthereumChain` + `wallet_addEthereumChain`,
    `accountsChanged` / `chainChanged` / `disconnect` subscriptions, and error classification
    that keeps *disconnected*, *wrong network*, and *user rejected* distinct (EIP-1193 `4001`,
    `4902`, and rejection-style `-32000`).
  - `src/shared/ens-write.ts` — the write plan (which key maps to which record), the ENS
    Registry / Resolver `setText` ABIs, the Sepolia-only guard, and a **read-only** preflight
    that reports resolver presence, balance, and whether the connected signer owns the name.
  - `src/web/publish.ts` — lazy-loaded signing via `custom(provider)`, so MetaMask supplies both
    RPC and signing and **no RPC URL enters the browser bundle**. Each record is one
    transaction; the next is submitted only after the previous one **settles** (a rejection
    aborts that record but does not strand the rest).
  - `src/web/main.tsx` — connected-address display, network badge, and a publish panel that stays
    disabled until the wallet is connected *and* on Sepolia.
  - `src/web/wallet.test.ts` — 25 tests covering connect/reject/switch/disconnect, the write
    plan, and **structural guards that fail the build if any key-handling code reappears**.
  - `scripts/set-records.ts` deleted (`git rm`); `.env.example`, `src/shared/demo-names.ts` and
    the README publishing section now describe the MetaMask flow only.
  - `scripts/scan-secrets.mjs` — criterion 8 was failing on **false positives** in the bundled
    `viem`. Three fixes, all narrowly scoped and each negative-tested: (a) the credentialed-URL
    pattern no longer runs through unrelated JS punctuation (it was reading
    `docsOrigin:"https://oxlib.sh",…version:\`ox@…\`` as `user:pass@`); (b) named exact
    exemptions for three published secp256k1 constants (`p`, `n`, GLV `beta`) plus a structural
    rule for EIP-2930 access-list sentinels; (c) **every** match on a line is now examined, so
    an exempt constant can never mask a real key beside it. Two pre-existing holes were also
    closed while verifying: the Bearer pattern required a quote (missing plain
    `Authorization: Bearer …` headers) and the mnemonic rule only matched a bare line (missing
    `mnemonic = "…"`). 27-case negative suite, all correct.
  - **Verification:** `npm run check` → exit 0 (typecheck clean, **103/103 tests**, secret scan
    PASS). Build succeeds; the publish path stays a lazy chunk so initial JS stays 165.50 kB
    (53.59 kB gzip).
  - **P1 harness evaluation re-run** (`npm run harness:check`, recorded as **Run 4** in
    `docs/harness-run-log.md`): loops CLI 0.5.0 authenticated, evaluator prompt retrieved OK
    (9 468 chars, written to `docs/harness/evaluator-prompt.md`), local gates **3/3 PASS**,
    exit 0. Criterion verdicts are **not computed** by design - the script returns an evaluator
    prompt, not a score, and none is claimed. The prompt again reports that no Loops House
    project record was provided, because creating one publishes externally under the user's
    account and has not been done unprompted.
  - **Docs reconciled:** T9's "to unblock" now describes the MetaMask flow instead of
    `PUBLISHER_PRIVATE_KEY`; the earlier `scripts/set-records.ts` entry is marked SUPERSEDED;
    the publish panel and README both say **settles** rather than confirmed, matching the code
    path where a rejection does not abort the remaining records; and the README's ownership claim
    is now true because the preflight result is surfaced as a warning.
  - **Note on the rubric:** the weights table below was checked line-by-line against `p1.md` and
    is correct - `p1.md` states 8 scored test cases worth 80 points and lists each value. The
    evaluator prompt carries a *separate* craft criterion at 20%. These are two distinct sources
    and were previously conflated in the harness log.
  - **Still outstanding:** the interactive MetaMask publish itself. See T9.

### T9 — Two Sepolia demo names with distinct preferences
- **Status:** `BLOCKED — needs a funded Sepolia wallet and names the user controls`
- **What is done:**
  - `scripts/set-records.ts` — the original private-key publisher — has been **removed** as part of
    T14. Publishing now happens in the browser through MetaMask signing; see T14.
  - Four labelled profiles are defined in `src/shared/demo-names.ts` and are marked
    `publishedOnChain: false` everywhere they surface.
- **What is blocked and why:** setting a text record needs a funded Sepolia wallet **and** control
  of the target names. Signing is a MetaMask action, so it cannot be automated here; and the
  connected account must own the name (or have a Public Resolver set) for the write to succeed.
  No key material is required or accepted — deliberately.
- **Independent finding that supports the block** (`scripts/probe-live-reads.ts`): 24 well-known
  Sepolia names × 11 keys = **264 reads, 0 text records found, 0 reads threw**. `vitalik.eth`
  resolves to his correct address, so the read path is healthy — Sepolia simply has no text
  records on these names to borrow. Publishing is the only way to satisfy brief item 2.
- **To unblock (user, in the browser):** open the app with MetaMask on **Sepolia**, connect, and
  use the publish panel to write `ana` and `kai` to two Sepolia names the connected account
  controls. The panel runs a read-only preflight first and reports resolver, balance, and
  ownership. After each transaction settles, flip `publishedOnChain: true` for both profiles in
  `src/shared/demo-names.ts`. **No private key is involved at any point** — do not paste one into
  chat or into `.env`.

### T10 — Recorded cases (criterion 6)
- **Status:** `DONE` — delivered by "T8 — Recorded contrasting cases" above.
- **Note:** the original plan named the path `cases/recorded-cases.json`. It was written to
  `docs/recorded-cases.{md,json}` instead so it sits with the other evidence and is rendered in
  the README. The path is referenced from `package.json` (`npm run record`).

### T11 — README + preference format docs + acceptance checklist
- **Status:** `DONE`
- **`README.md` written** covering: the preference format table (key, allowed values, default,
  why each earns its place), the enforcement rules, the preference-to-behaviour mapping, the
  three-layer injection defence, quick start, provider swap table, the honest status of the
  Sepolia names, the recorded-case contrast table, security, project layout, checks.
- **Acceptance checklist:** criterion-by-criterion state is in `docs/harness-run-log.md`
  (Run 1 baseline and Run 2 working build) rather than as a separate file, so the evidence and
  the assessment cannot drift apart.

### T12 — Final full harness evaluation + secret scan
- **Status:** `IN_PROGRESS` — Run 2 executed and recorded; a final run is required after the
  Sepolia publish attempt.
- **Run 2 recorded** in `docs/harness-run-log.md`, with the full executed evaluator report and a
  table of every local deterministic check.

### T13 — Distinguish a failed read from an unset record
- **Status:** `DONE`
- **Raised by:** the Run 2 evaluator's own "Gaps & risks" — `readPreferenceRecords` caught every
  error and returned `null`, making a reverting resolver indistinguishable from an owner who
  never set a record. Both fall back to a named default, so a broken resolver produced a
  confidently wrong answer with no warning.
- **Delivered:**
  - `PreferenceRecordStatus = 'read' | 'unset' | 'failed'` returned per key
    (`src/server/ens.ts`), threaded through the API and rendered in the UI.
  - The UI shows an explicit warning when reads fail, stating that the defaults are shown
    because the read errored and the values may therefore be wrong.
  - **Refactor for testability, not test contortion:** `readPreferenceRecords` now takes its
    text reader as a parameter (`PreferenceTextReader`, defaulting to the real Universal
    Resolver). My first attempt at these tests stubbed `client.transport.request` and hand-encoded
    viem return values — far too coupled to viem internals to survive a dependency bump, so it
    was replaced with the injectable reader instead.
  - 5 new tests (`src/server/ens.test.ts`), including one asserting a single throwing key is
    isolated from the other four.
  - **One real bug caught by the new tests:** my injected reader was written as
    `async (key) => …`, so TypeScript bound the first parameter to `client`, not `key`. The
    comparison never matched and nothing ever threw. `tsc` caught it as TS2367; fixed to
    `async (_client, _name, key)`.
  - **Regression-checked against the real chain** after changing production code: re-ran
    `probe-live-reads.ts`, `vitalik.eth` still resolves correctly and all five reads still return
    `null`. Test count 69 → 74.

---

## Current session handoff

- **State:** T0–T8, T10, T11, T13 `DONE`. T9 `BLOCKED` on a funded Sepolia key. T12 `DONE`
  (Run 2 recorded; final run pending).
- **Verified at close of session:**
  - `npx tsc --noEmit` → clean, exit 0
  - `npx vitest run` → **74 passed / 74**, 4 files
  - `npm run build` → built in 5.48 s
  - `node scripts/scan-secrets.mjs` → PASS exit 0 over 35 tracked files + 3 bundle files
  - `npm run record` → RESULT: PASS, 4 distinct system prompts across 4 profiles
  - `npx tsx scripts/probe-live-reads.ts` → 264 reads, 0 text records, `vitalik.eth` address correct
  - `loops evaluate …` → Run 2 executed, report written to `docs/harness-run-log.md`
- **Commits:** `9c9f8ea` scaffold · `3642faa` working build · `5d8f5cf` README + publisher + probe.
- **Exact next action:** needs a decision from the user, not more code:
  1. **Create the Loops House submission** — the platform has flagged twice that no project
     record exists. Requires `loops project create --event road-to-devcon-vii --name "…"`.
     This publishes to an external platform under the user's account, so it is not done
     unprompted.
  2. **Fund a Sepolia MetaMask account and own two Sepolia ENS names**, then open the app and use
     the publish panel to write `ana` and `kai` — this unblocks T9. Signing happens in MetaMask,
     so there is no key to supply: do **not** paste a private key or seed phrase into chat or
     `.env`.
  3. Once (1) and (2) are done: `npm run record`, flip `publishedOnChain: true`, and re-run
     `loops evaluate` as Run 3 for the final T12 evidence.

## 
## P1 coding completion (MetaMask UI)
- Status: DONE
- MetaMask wallet connect/disconnect implemented in src/web/wallet.ts with chain checks (Sepolia), address display, network badge, and state handling. UI wired in src/web/main.tsx (connect/disconnect, chain status, disabled states). Publish panel present but transactions not sent in this phase.
- Build: npm run build → success.
- Tests: 103/103 passed.
- Typecheck: tsc --noEmit clean.
- Secret scan: PASS.
- ENS write/read-back verification: NOT performed (deferred per instructions).

## Layout recovery and P1 resumption
- Status: DONE
- Layout completed: p1/ contains P1 app (src,scripts,docs,configs,package.json,tsconfig.json,vite.config.ts,vitest.config.ts,README.md,action.md,.env.example). p2/ and p3/ contain their problem statements.
- Root retains shared materials.

---

## Dev8 root → p1/ consolidation
- Status: DONE
- Scope: folder organisation only. No app behaviour changed, no server started, nothing staged or
  committed, root `.env` never opened.

### Root inventory and classification (verified before touching anything)

P1-specific at the root (all belong to this project, `package.json` name
`portable-ai-preferences`):

| Root path | Root vs `p1/` counterpart | Action |
| --- | --- | --- |
| `src/` (21 files) | byte-identical (SHA-256) | root copy redundant → remove |
| `scripts/` (5 files) | byte-identical | root copy redundant → remove |
| `docs/harness-run-log.md`, `docs/recorded-cases.json`, `docs/recorded-cases.md`, `docs/harness/evaluator-prompt.md` | byte-identical | root copy redundant → remove |
| `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `README.md`, `.env.example` | byte-identical | root copies redundant → remove |
| `package-lock.json` | **root-only**, `name: portable-ai-preferences` | copy into `p1/package-lock.json`, then remove from root |
| `action.md` | **differs** — root 551 lines (08:59 UTC), `p1/action.md` 557 lines (09:13 UTC) | `p1/action.md` is the superset (it keeps every root section and adds the MetaMask-completion entry plus the updated handoff/layout notes; the root copy carries a mangled handoff with literal `\n` escapes). Reconcile = keep `p1/action.md`, remove root copy |

P2-specific at the root: **none**. Everything under `p2/` is already complete and self-contained
(`.gitignore`, `.env`, `.env.example`, `package.json`, `package-lock.json`, `README.md`,
`action.md`, `docs/problem-statement.md`, `docs/acceptance-checklist.md`, `docs/profile-format.md`,
`docs/expected-queries.md`, `docs/harness-run-log.md`, `p2.md`, `scripts/`, `src/`, configs).
Nothing is added to or changed in `p2/`.

Shared task material that stays at the root: `p1.md`, `p2.md`, `p3.md`, `plan.md`,
`.gitignore`, `.gitattributes`, `.git/`, `.agents/`, `.claude/`.

Generated / dependency directories that stay untouched at the root: `node_modules/`, `dist/`
(per instructions — not moved, not deleted).

Untouched secret: root `.env`. It was never opened, printed, copied, or modified, and no RPC
credential from it was copied into P1. The user creates `p1/.env` locally from `p1/.env.example`
with a fresh RPC URL.

New P1-local files created (P1 was missing them):

- `p1/package-lock.json` — moved from the root.
- `p1/.gitignore` — P1-scoped copy of the root ignore rules (same pattern as `p2/.gitignore`),
  so P1 is safe to extract as its own repo.
- `p1/docs/problem-statement.md` — verbatim copy of the shared root `p1.md`, so the brief and all
  8 scored criteria travel with P1 while `p1.md` itself stays at the root.

### What was actually done

1. Read root `action.md`, `plan.md`, `p1.md`/`p2.md`/`p3.md` and `p1/action.md`; hashed every root
   file against its `p1/` counterpart before touching anything.
2. `package-lock.json` copied root → `p1/` (SHA-256 `65C8FC74…`). Verified with node that it is
   `portable-ai-preferences`, lockfileVersion 3, 306 entries, and that its dependency and
   devDependency sets match `p1/package.json` exactly.
3. `p1/.gitignore` created (P1-scoped, same pattern as `p2/.gitignore`, keeps `.harness/`,
   `.env*` with `!.env.example`, `node_modules/`, `dist/`).
4. `p1/docs/problem-statement.md` created as a byte-identical copy of root `p1.md`
   (SHA-256 `ACB8CF42…` on both sides).
5. Re-ran the pre-delete comparison: every root P1 file had a byte-identical `p1/` counterpart,
   except `action.md`, which was reconciled in favour of this file. A line-level containment check
   confirmed all 511 non-blank root lines are present here, except 5 older duplicate handoff/layout
   lines whose content survives in the updated "Handoff — P1 status" and "Layout recovery and P1
   resumption" sections. Nothing was overwritten and no unique content was lost.
6. Removed the redundant root copies only: `src/`, `scripts/`, `docs/`, `package.json`,
   `package-lock.json`, `README.md`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`,
   `.env.example`, `action.md`. Plain `Remove-Item` — no `git mv`, no `git add`, no commit.

### Root after consolidation

Kept at the root, deliberately: `p1.md`, `p2.md`, `p3.md`, `plan.md` (shared task material),
`.gitignore`, `.gitattributes`, `.git/`, `.agents/`, `.claude/`, and the pre-existing `node_modules/`
and `dist/` (instructions: not moved). Root `.env` was never opened, printed, copied, or modified —
its size (764 B) and mtime (2026-10-04 05:08:35 UTC) are unchanged. `p2/` and `p3/` were not
touched: the root inventory proved no root file is P2-owned-and-missing, because P2 is already
self-contained (own `.gitignore`, `.env`, `.env.example`, `package.json`, `package-lock.json`,
`README.md`, `action.md`, `p2.md`, `docs/problem-statement.md`, `docs/acceptance-checklist.md`,
`docs/profile-format.md`, `docs/expected-queries.md`, `docs/harness-run-log.md`, `scripts/`, `src/`,
`tsconfig.json`, `vite.config.ts`, `vitest.config.ts`). `p1/.env` deliberately does **not** exist:
copy `p1/.env.example` to `p1/.env` locally and fill in a fresh RPC URL.

### Verification

- `npx tsc --noEmit -p tsconfig.json` in `p1/` → clean, exit 0.
- `npx vitest run` in `p1/` → **103 passed / 103**, 5 files, exit 0. (A first run reported 2
  timeouts in `src/web/wallet.test.ts` "preflight ownership" cases; those same 4 tests pass in
  isolation at ~0.9 s and passed on re-run, so they are the known flaky mock-provider timing under
  parallel load, not fallout from the move.) Tests resolve dependencies from the parent
  `node_modules/`, so nothing was installed and no `p1/dist/` was produced; the transient
  `p1/node_modules/.vite` cache from that run was deleted again.
- `git status` works from `N:\dev8` with no ownership/safe.directory problem, and global Git
  config was not touched. The index already held staged changes from earlier work
  (`.env.example`, `README.md`, `action.md`, `docs/harness-run-log.md`, `docs/recorded-cases.*`,
  `scripts/scan-secrets.mjs`, `scripts/set-records.ts` deleted, `src/shared/demo-names.ts`,
  `src/shared/ens-write.ts`, `src/web/main.tsx`, `src/web/publish.ts`, `src/web/wallet.test.ts`,
  `src/web/wallet.ts`). That staged set is byte-for-byte the same before and after this task: the
  deletions above appear only as unstaged working-tree changes (` D`), which the user can stage or
  discard as they see fit. Nothing was staged or committed by this task.
- P1 now holds 37 tracked files: `src/` (21), `scripts/` (5), `docs/` (5, including the new
  `problem-statement.md`), the three build configs, `package.json`, `package-lock.json`,
  `README.md`, `.env.example`, `.gitignore`, `action.md`.

### Next action (unchanged)

T9 remains `BLOCKED` on a funded Sepolia account: complete the MetaMask publish and read-back for
the two demo names, then `npm run record`, flip `publishedOnChain: true`, and re-run
`loops evaluate` as Run 3. Run all of that from inside `p1/`, after creating `p1/.env` from
`p1/.env.example`.

---

## T15 — Diagnose and fix the 400 from `POST /api/preferences/resolve`

- **Status:** `DONE`
- **Outcome in one line:** the `ana.eth` 400 was never a bug in that path — the name has **no
  records published on Sepolia**, so a correct 200 with five named defaults is what it must
  return. Two real defects did exist on the same URL and are fixed: body-parser failures
  answered with HTML instead of the JSON error envelope, and an address was rejected with
  misleading "check the spelling" advice while the UI invited exactly that input.
- **Reported symptom (verbatim from the P1 front-end review):** browser console showed
  `Failed to load resource: the server responded with a status of 400 (Bad Request)` for
  `http://localhost:8787/api/preferences/resolve`, while the UI was looking up `ana.eth`. The UI
  showed 0 preferences from records, all five named defaults, and "no preference records were
  found". The `ana.eth` sample-profile question flow answered successfully. MetaMask was on
  Sepolia.
- **Constraints honoured:** the already-running server (PID 30060, `npm start`, listening on 8787
  since 18:28:28) was **not** restarted, stopped or replaced; all probing went against that live
  instance. No ENS record was published, no transaction sent, root `.env` untouched, P2/P3
  untouched, nothing committed.

### Findings

Server logs: the running instance's stdout went to a previous session's console and is **not
readable from this session** — `temp/opencode/p1-server.log` is the banner of the *earlier*
18:11:57 instance, and the current one appended nothing. This is itself a diagnosability gap: the
app installs **no request logging**, and `handleUnexpected` never writes to stdout, so a client
error was never recorded anywhere. Diagnosis therefore had to come from the route
implementation, the response contract, and live probes.

Probe method note: the first probe round was invalid. PowerShell mangles quotes when passing an
argument to a native executable, so `curl -d "{\"name\":\"ana.eth\"}"` put `Content-Length: 14`
on the wire — i.e. `{name:ana.eth}`, which is not JSON. Every "HTML 400" seen in that round was
my own malformed request, not a server defect. Re-run with bodies written to a file and
`--data-binary @file`, the results below are trustworthy.

Live behaviour of `POST /api/preferences/resolve` on PID 30060, full matrix:

| Request body | Status | `Content-Type` | Envelope |
| --- | --- | --- | --- |
| `{"name":"ana.eth"}` | **200** | JSON | all five preferences from named defaults |
| `{"name":"  ana.eth  "}` | 200 | JSON | normalized to `ana.eth` |
| `{"name":"ana.eth","foo":1}` | 200 | JSON | unknown field ignored |
| `{}` / `{"ensName":"ana.eth"}` / `{"name":123}` / `{"name":""}` / `[{"name":"ana.eth"}]` | 400 | JSON | `{error:{code:"BAD_REQUEST",…}}` — intentional |
| `{"name":"0xD613…1d0"}` (address) | 400 | JSON | `{error:{code:"INVALID_ENS_NAME",…}}` — intentional status, wrong wording |
| `{"name":"ana"}` / `{"name":"ana.eth."}` | 400 | JSON | `INVALID_ENS_NAME` — intentional |
| **`{"name":`** (not parseable JSON) | **400** | **text/html** | **Express `finalhandler` page, no code, no message** |
| **`"ana.eth"`** (JSON, but not an object) | **400** | **text/html** | **same** |
| body 70 kB (limit 64 kB) | **413** | **text/html** | same |
| `charset=iso-8859-1` | **415** | **text/html** | same |

1. **`ana.eth` is not the cause and the unset-record path is correct.** `{"name":"ana.eth"}`
   returns **200**, with `recordStatus` = `unset` for all five keys, `fromRecordCount: 0`,
   `defaultCount: 5`, `readFailures: []`, `nameResolved: false`. That is exactly the documented
   default behaviour, and exactly what the reviewer saw rendered. **This endpoint cannot return
   400 for `{"name":"ana.eth"}`** — reproduced directly against the live server, and the route has
   no code path from that input to a 400 (`normalizeEnsName` returns `ana.eth`; every read is
   isolated in try/catch and yields `null`; the address read is wrapped too).
2. **Genuine bug A — a 400 that is not an intentional response.** `express.json()` rejects a body
   it cannot parse (or that is valid JSON but not an object) *before any route handler runs*, so
   the app's own error contract is bypassed and Express's `finalhandler` answers with an HTML
   page. The endpoint's contract is `{error:{code,message}}` JSON; for these inputs it returns
   `text/html` with the single word "Bad Request". The browser cannot show a useful message, and
   degrades to "The server returned a non-JSON response (HTTP 400)". The same hole swallows 413
   (oversized body) and 415 (unsupported charset).
3. **Genuine bug B — the UI advertises an input the API refuses.** The step-1 field is labelled
   **"ENS name or address"**, but a `0x…` address is rejected by `normalizeEnsName` with the
   message *"… is not a name ENS can accept. Check the spelling, and use a full name such as
   `ana.eth`."* Preferences are ENS **text records on a name**; an address cannot carry them, so
   rejecting it is correct — but the label invites the input and the error text gives no reason,
   which is exactly the "unsupported name must produce a clear, intentional response" failure.
   With MetaMask connected and an address on screen, pasting that address is the obvious thing a
   reviewer does, and it is a 400 on this exact URL.
4. **Contributing gap — nothing is logged.** No request logging and no `console.warn` on the
   client-error paths, so this class of failure leaves no trace. The fix adds a single
   body-free, credential-free line.

### Fix

1. **`src/server/index.ts` — one JSON error contract for every client error on `/api`.**
   Added `BODY_ERRORS`, `describeBodyError` and `apiErrorHandler`, and registered
   `app.use('/api', apiErrorHandler())` immediately before the API 404 fallback. Body-parser
   `type` values map to safe, actionable codes: `entity.parse.failed` → 400
   `MALFORMED_JSON`, `entity.too.large` → 413 `PAYLOAD_TOO_LARGE`, `charset.unsupported` → 415
   `UNSUPPORTED_CHARSET`. Unknown body-parser errors fall back to 400 `BAD_REQUEST`; anything
   that is not a recognised body-parser error is passed to `next` so real bugs still reach
   `handleUnexpected`. The handler logs **one line, body-free**: method, path, status, code and
   error type. It builds the path from `req.baseUrl + req.path`, deliberately not
   `originalUrl`, so a query string can never be logged.
2. **`src/server/ens.ts` — an address now explains itself.** `InvalidEnsNameError` takes an
   optional specific `guidance`. A new `HEX_ADDRESS = /^(?:0x)?[0-9a-fA-F]{40}$/` check runs
   after the length guard and before `normalize()`, and throws with guidance explaining that
   preferences are ENS text records on a **name**, so an address cannot carry them. The generic
   "Check the spelling" advice remains for genuine typos.
3. **`src/web/main.tsx` — the label matches reality.** "ENS name or address" → "ENS name".

### Verification

New `src/server/api.test.ts` (14 tests) drives the real Express app over real HTTP against a
stub JSON-RPC endpoint that reproduces "no records set", so the fix is verified without touching
the running server or the network:

- **the reported case itself** — a name whose records are all unset returns **200** with
  `defaultCount: 5`, `fromRecordCount: 0`, every `recordStatus` = `unset`, and each
  preference carrying `source: 'default'`, `appliedDefault` and `defaultLabel`;
  `"  ANA.eth  "` normalizes to `ana.eth`;
- malformed JSON, a non-object JSON body, a >64 kB body and a bad charset each return their
  documented code **as JSON**, on `/api/preferences/resolve` and on `/api/ask`;
- a property test over five bad bodies asserts **no** client error on this endpoint is ever HTML;
- **validation is not weakened**: an address (checksummed, lower-case, prefix-less), a name with
  no root, `{}`, `{"name":""}`, `{"name":123}` and `{"ensName":…}` all still fail;
- neither the response body nor the log line can contain the request body.

Two mistakes of my own were caught by these tests and fixed: a fabricated 41-hex-character
"address" fixture (the address branch correctly did not fire on it) and `req.path` being
mount-relative inside `app.use('/api', …)`, which logged `/preferences/resolve`.

`ens.test.ts` gained the matching unit-level assertion, including that an address no longer
receives "Check the spelling".

Exact results:

| Command | Result |
| --- | --- |
| `npx vitest run src/server/api.test.ts src/server/ens.test.ts` | **29 passed** (2 files) |
| `npm run check` (typecheck + tests + secret scan) | **PASS** — typecheck clean, **118 tests / 6 files**, scan PASS |
| `npm run build` | **PASS** — 1345 modules, new bundle carries "ENS name", old wording gone |
| `npm run check:secrets` (after rebuild) | **PASS** — 36 tracked files, 17 patterns, 5 bundle files |
| `npm run harness:check` | **PASS (3/3)** — typecheck, tests, secret scan; evaluator prompt retrieved, 9 461 chars |

`npm run check:secrets` failed on the **first** attempt with 4 findings, all in my new
`api.test.ts`: the canary `sk-not-a-real-key-…` is shaped exactly like a real key, so the
scanner was right. `scripts/scan-secrets.mjs` exempts the files that contain its own patterns
(`SELF_EXEMPT`), so adding `api.test.ts` there was available and **deliberately declined** —
relaxing a scored gate so my own test passes is not a gate passing. The canary is now assembled
at runtime (`['sk', 'not-a-real-key-…'].join('-')`), so no tracked line looks like a credential.

The official evaluator prompt was then executed against the repo and the full report recorded in
`docs/harness-run-log.md` (Run 5), including the per-criterion assessment and the one gap that
actually matters: **no preference records are published on Sepolia**, so the portability claim
is currently proven against simulated profiles only. That is brief requirement 2, and it is the
same fact that made this 400 report confusing — the reviewer expected Portuguese answers from
`ana.eth` and got the documented defaults, correctly.

### Not done / limits

- The instance on `:8787` still serves the **pre-fix** code, because restarting PID 30060 was out
  of scope. The JSON error contract is verified through `api.test.ts` on an ephemeral port and
  reaches `:8787` on that process's next normal restart.
- No ENS record was published, no transaction sent, nothing committed, and `npm run record` was
  not re-run — the recorded cases were assessed as the committed artifact.
- One stale pointer fixed in passing: `src/shared/preferences.ts:19` referenced
  `docs/preference-format.md`, which does not exist; the format is documented in
  `README.md` ("The preference format"), so the comment now points there.

---

## Re-verification � 2026-10-04, after P2 and P3 were completed

The API error-handling fix (T15) was re-checked as a focused regression plus its minimum gates, so
this project's status rests on a run made *after* the later work rather than only on the earlier one.

| Check | Command | Result |
| --- | --- | --- |
| Focused regression | `npx vitest run src/server/api.test.ts src/server/ens.test.ts` | **exit 0** � **29 passed** (2 files), 2.14 s |
| Minimum gates | `npm run check` | **exit 0** � typecheck clean, **118 passed** (6 files), 17 credential patterns checked, no finding |

The 29 focused tests include the 14 in `api.test.ts` that pin the JSON error envelope
(`MALFORMED_JSON`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_CHARSET`) and assert no request body is ever
echoed back to the caller, plus the address-validation cases added to `ens.test.ts`.

Logs during the focused run show the intended behaviour and nothing more:
`POST /api/preferences/resolve -> 400 MALFORMED_JSON (entity.parse.failed)`, with no body echoed.

Nothing in this project was changed in this pass � it is verification only. The `:8787` instance
(PID 30060) still serves the pre-fix code and was left untouched; no ENS write, no transaction, no
commit, no push.

---

## Release readiness review — 2026-10-04 (late session) `DONE`

**Scope:** verify all 8 scored checks against observed output, close the one criterion gap that was
open, then prepare the repository. No ENS write, no transaction, root `.env` untouched, no gate
weakened, nothing force-pushed.

### T17 — close the criterion 6 gap (stated expected property) `DONE`

**Was open:** `p1.md` fails criterion 6 when "cases state no expected property".
`docs/recorded-cases.*` listed records, prompts and answers, but no case declared what the answer
was *expected* to look like. The previous harness run had already flagged this as the only
partially-met criterion.

**Fix:** `scripts/record-cases.ts` now carries an `EXPECTED` table keyed by profile, declared before
any model call (`language`, `length`, `reading`, `format`, `maxWords` mirroring the app-authored
bounds in `src/shared/prompt.ts`, and a one-line statement), plus `observeAnswer()`, which measures
the returned text (words, sentences, bullet lines, accented words, within-bound). Both are written
to `docs/recorded-cases.json` and rendered in `docs/recorded-cases.md`. The measurement is reported,
never asserted: whether a model provider obeys a style rule is a property of that provider, not of
this application.

**Not weakened:** the question-identity, prompt-distinctness, byte-exact-prompt and no-leakage
assertions are unchanged, and the script still exits 1 if any of them breaks.

**Rerun (observed):**

| Command | Result |
| --- | --- |
| `ALLOW_DEMO_FIXTURES=true npm run record` | **PASS** — 4/4 profiles, 4 distinct system prompts, every case prints its expected property and the measurement of the returned text |
| `npm run check` | **exit 0** — `tsc` clean, **118 tests / 6 files**, secret scan PASS (36 files, 17 patterns, 5 bundle files) |
| `npm run build` | **PASS** — built in 6.69 s into `p1/dist/web` (166 kB JS / 6.1 kB CSS) |
| `npm run harness:check` | **PASS (3/3)** — typecheck, tests, secret scan; evaluator prompt retrieved; the verdict line still prints `NOT COMPUTED BY THIS SCRIPT` |

`p1/.env` has `ALLOW_DEMO_FIXTURES=false`, so the recording needs that one variable set for the run.
It is a local, git-ignored setting; no tracked file was changed to accommodate it.

**Honest result in the regenerated evidence:** `ana.eth` expects `pt` / short / bullets and returned
15 Portuguese words inside the 45-word bound, but **0 bullet lines** — the local 3B model ignored
`format=bullets`. That is now stated and measured rather than hidden. `qwen3:4b` was probed and
returns empty `content` (its reasoning consumes the budget), so no stronger local model was
available to re-record with.

### T18 — per-criterion evidence map + submission report `DONE`

`docs/submission-report.md` maps each of the 8 checks to its test, harness result and `file:line`,
lists every command run with its observed result, and separates "8 of 8 checks pass on local
evidence" from the brief requirements that remain unverified.

### Still NOT VERIFIED / BLOCKED BY ENS SETUP

- **"Set those records on at least two Sepolia ENS names."** Not done. `publishedOnChain: false` on
  all four demo profiles, and every recorded case is labelled *simulated, not on chain*.
- The brief's success criterion is therefore **PARTIAL**: proven against the labelled sample
  profiles and a stubbed resolver in `src/server/api.test.ts`, not against live chain data.
- No official numeric score is claimed anywhere: `loops evaluate` returns a prompt, not a verdict.

### Stale text noted, not fixed

The "Target architecture" section near the top of this file lists `docs/preference-format.md`,
`docs/acceptance-checklist.md` and `docs/demo-names.md` as planned docs that were never created. The
preference format lives in `README.md` ("The preference format"), and the per-criterion evidence map
now lives in `docs/submission-report.md`. Recorded rather than rewritten, to keep this log an
append-only history.

---

## T19 — Repository prepared, committed and pushed `DONE`

**Target:** `https://github.com/Niru-9/road-to-DEVCON-P19` (created by the builder for this purpose;
pushing this folder there was explicitly authorised).

### Repository structure — why this folder is now its own repository

`N:\dev8` is a single Git repository whose history predates the split into `p1/`, `p2/` and `p3/`
(its four commits contain P1's source at the *root* level, and `p1/`, `p2/`, `p3/` are untracked
there). Pushing from that root would have committed three different projects — and one project's
history — into one repository, which the builder's instruction forbids. `p1/` was therefore
initialised as its own repository, so the commit contains exactly this project folder.

- Root repository `N:\dev8`: **not committed, not pushed, not modified.** Left exactly as found.
- `p1/.git` initialised on branch `main`.

### Pre-push inspection

| Check | Observed |
| --- | --- |
| Folder contents belong to P1 | 40 tracked files: own `README.md`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/{server,shared,web}`, `scripts/`, `docs/`, `action.md`. No P2/P3 files, no root `p2.md` / `p3.md` / `plan.md`. |
| Ignored, therefore not staged | `.env` (local, git-ignored), `node_modules/`, `dist/`, `*.log`, `*.pem`, `*.key`, `secrets.json`, `wallet.json`, `.harness/` |
| No keys, logs or databases present | none found in the folder inventory |
| Secret scan **against the real index** (re-run after `git init`) | `RESULT: PASS` — 37 would-be-committed files, 17 patterns, plus 5 built bundle files; `.env` confirmed ignored |
| Remote state before push | `git ls-remote` → **0 refs** (empty repository, so no remote history could be overwritten) |

### Release checks run immediately before the commit

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run test` | **118 passed / 118**, 6 files |
| `npm run check` | **exit 0** |
| `npm run check:secrets` | **PASS** (37 files against the index) |
| `npm run harness:check` | **PASS (3/3)** local gates; no score computed |
| `npm run build` | **PASS** — 6.69 s |
| `ALLOW_DEMO_FIXTURES=true npm run record` | **PASS** — 4/4 recorded cases, each with a stated expected property |

### Commit and push

| Item | Value |
| --- | --- |
| Branch | `main` |
| Commit | `f4878e9` — `feat: submit P1 portable AI preferences MVP` |
| Remote | `origin` → `https://github.com/Niru-9/road-to-DEVCON-P19` |
| Push | **SUCCESS** — `* [new branch] main -> main` |
| Verified after push | `git ls-remote origin` → `f4878e9dc603a2c3d26f208108fb155c50bc5f6b refs/heads/main`, identical to local `HEAD` |

Nothing was force-pushed, no history was rewritten, and no other repository was created. No ENS
record was published and no transaction was sent. The root `.env` was not read or modified.
