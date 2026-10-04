# Harness run log — P1 "Portable AI Preferences"

Every run of the documented harness evaluation command, plus the local deterministic
checks, recorded in the order they happened. Nothing here is a claim without a command
and an observed result.

## The documented harness evaluation command

```
loops evaluate --event road-to-devcon-vii --problem portable-ai-preferences
```

**What this command actually is** — read from the installed skill at
`.agents/skills/loops-road-to-devcon-vii/SKILL.md` (lines 156–169):

> "Fetch a self-contained evaluator prompt for one problem (free; the platform attaches the
> user's project record), then **execute the prompt yourself inside the project repo**."

So `loops evaluate` prints an **evaluator prompt** as a single `prompt:` field. It is **not**
an automated pass/fail test runner and emits no machine-readable criterion verdicts. The
prompt must then be executed by the agent against the repo. Therefore:

- Criterion-level findings labelled "loops evaluate output" below are **LLM-judged
  alignment feedback**, executed from the fetched prompt, and are reported as such.
- Machine-verifiable evidence comes from the repo's own deterministic checks
  (`npm test`, `npm run check:secrets`), which `plan.md` line 136 also requires.
- No harness subcommand was invented. `npm run harness:check` in this repo is a repo-local
  wrapper that invokes this documented command plus the local checks, and is labelled as
  such.

---

## Run 1 — BASELINE (before any application code)

- **When:** 2026-10-03, at the start of the build.
- **Repo state at the time:** only `p1.md`, `p2.md`, `p3.md`, `plan.md`, plus the harness
  skill files that `loops add` had just written. **No application code existed.**
- **Command:**

  ```
  loops evaluate --event road-to-devcon-vii --problem portable-ai-preferences
  ```

- **Platform response:** returned the full evaluator prompt. Project record:
  `No project record was provided. Evaluate the repository you are running inside, and note
  that the builder still needs to create/update their submission on Loops House`.
- **Baseline criterion-level result, executing that prompt against the empty repo:**

  | # | Criterion | Baseline | Evidence |
  |---|-----------|----------|----------|
  | 1 | No ENS record value interpolated into system prompt | **FAIL** | no model call, no prompt, no code at all |
  | 2 | Each preference value checked against an allowlist | **FAIL** | preferences never read from ENS — no code |
  | 3 | Unset record falls back to a named default | **FAIL** | no ENS read, no default branch — no code |
  | 4 | Entered name normalized before resolution | **FAIL** | no ENS resolution call — no code |
  | 5 | Model request has an explicit timeout | **FAIL** | no model call — no code |
  | 6 | Recorded cases pair one question with 2+ preference sets | **FAIL** | no recorded cases — no code |
  | 7 | Model id and provider endpoint read from configuration | **FAIL** | no model call — no code |
  | 8 | No credential appears in any tracked file | **PASS (vacuous)** | no tracked files existed; git repo had just been initialised, nothing committed |

- **Baseline "Gaps & risks" (verbatim from the fetched prompt's own weighted rubric,
  criterion "Problem interpretation, product judgment & code craft", weight 20%):**
  > "Wrong-shaped builds that can pass the checks: (1) preferences are effectively stored in
  > the app's own database or session, with ENS reduced to a login label, which quietly
  > defeats the point of portable preferences; (2) preferences are read but only change a
  > greeting or a badge, while the answers themselves barely differ; (3) a developer-facing
  > tool where the user must type raw record keys or JSON, with no sense of who Ana is.
  > Reward a preference format another app could adopt (sensible keys, clear allowed values,
  > service-key namespacing), preferences chosen because they change the reading experience,
  > and recorded cases that make the difference visible. Judge craft on clarity of the
  > preference-to-behaviour mapping, not on volume of code."

- **Design decisions locked in directly from that rubric:**
  1. **ENS is the real source of truth.** No local preference database, no session-cached
     preferences that outlive a reload. Anti-pattern (1) is explicitly punished.
  2. **Preferences must visibly change the answer text**, not a greeting/badge.
     Anti-pattern (2) is explicitly punished. The recorded cases must make this visible.
  3. **Ana is the user.** No raw record keys or JSON typed by the user.
     Anti-pattern (3) is explicitly punished.
  4. **Service-key namespacing** for the invented preference format (per ENSIP-5 in the
     prompt's own resource list: *"Use service keys for any custom record format you invent."*)
  5. **Preference-to-behaviour mapping must be legible** in the code.

- **Also extracted from the prompt's resource list** (authoritative references to design against):
  - `viem: getEnsText` — "Returns null when the record is unset, so handle that case explicitly."
  - `viem: normalize` — "Pass user-typed names through it before any resolution call; it throws on invalid names."
  - `ENSIP-5: Text Records` — "global keys (lowercase, numbers, hyphen) versus service keys in
    reverse-dot notation for namespaces you own. Use service keys for any custom record format you invent."
  - `OWASP LLM01: Prompt Injection` — "ENS records are public, user-controlled text, which makes
    every record you feed a model an indirect-injection surface."
  - `ENS deployments (Sepolia)` — "resolve through viem or ENSjs (Universal Resolver) rather
    than registry internals" (ENSv2 Beta caveat).
  - Success outcome: "Ana types her ENS name once, and every answer arrives in short Portuguese
    sentences without her asking again."

---

## Run 2 — WORKING BUILD (scaffold + working core flow)

- **When:** 2026-10-03, after the scaffold, core flow, web UI and recorded cases were built.
- **Repo state:** 3 commits, 36 tracked files, 69 passing tests, `tsc` clean, UI built.
  - `9c9f8ea` P1 scaffold
  - `3642faa` P1 working: web UI, recorded cases, negative-tested secret scanner
  - `5d8f5cf` README documenting the preference format, Sepolia publisher, live chain probe
- **Command:**

  ```
  loops evaluate --event road-to-devcon-vii --problem portable-ai-preferences
  ```

- **Platform response:** the same self-contained evaluator prompt. Project record again:
  `No project record was provided` — the submission on Loops House still does not exist.

### Executed evaluator report

The fetched prompt was executed against this repository. Findings below are **LLM-judged
alignment feedback**, not machine verdicts. Every claim cites a file in this repo.

#### Alignment summary

This project attacks the brief head-on and in the right shape: the ENS name genuinely is the
only source of preference truth, the five preferences were chosen because they change the reading
experience rather than for decoration, and the same question demonstrably yields a different
answer per profile. The one place it falls short of the brief is the part that cannot be faked —
the two Sepolia names do not yet have records published on chain.

#### What's genuinely strong

- **ENS is real, not a label.** `src/server/ens.ts:116` reads five records through viem's
  Universal Resolver (`getEnsText`), and `src/server/ens.ts:56` is the only entry point for a
  user-typed name, so no read can bypass ENSIP-15 normalization. There is no app-side preference
  store anywhere in the repo. This avoids wrong-shape anti-pattern (1).
- **The preference-to-behaviour mapping is one literal per allowed value.**
  `src/shared/prompt.ts:50-87` — `LANGUAGE_FRAGMENT`, `LENGTH_FRAGMENT`, `READING_FRAGMENT`,
  `FORMAT_FRAGMENT`, `AVOID_FRAGMENT`. No interpolation anywhere in the file. This is the clarity
  the 20% criterion asks for, and it is legible on one screen.
- **Answers genuinely differ, not just a badge.** `docs/recorded-cases.md` shows `ana.eth`
  returning three short European-Portuguese bullets and `kai.eth` returning multi-paragraph
  English technical prose for a byte-identical question. Anti-pattern (2) avoided.
- **Injection is treated as a security boundary.** Three layers: a type that cannot carry raw
  text, a separate `user` message, and a runtime guard `findRecordLeakage`
  (`src/shared/prompt.ts:144`) exercised by tests and by `scripts/record-cases.ts`.
- **Service-key namespacing done properly** — `com.portableprefs.*`, reverse-dot, per ENSIP-5.
- **Suggested stack fully honoured:** viem (`src/server/ens.ts:15`), ENS on Sepolia, plain `fetch`
  against any OpenAI-compatible endpoint (`src/server/llm.ts`), zod for request validation
  (`src/server/index.ts:117-124`), Express.
- **"Handle names whose records are missing, unset, or nonsense" is handled explicitly** — unset
  reads return `null` and take the named-default branch; a reverting resolver is isolated per key
  rather than aborting the other four (`src/server/ens.ts:122-133`).

#### Gaps & risks

- **The two Sepolia names are not published.** This is brief item 2 and the single largest gap.
  `scripts/set-records.ts` exists, typechecks, and its safety gates were exercised (refuses
  without a key → exit 2; `--dry-run` sends nothing → exit 0), but it has never executed a
  transaction because no funded Sepolia key exists in this environment. Until it does,
  `docs/recorded-cases.md` is generated from simulated profiles.
- **No Loops House project record.** The platform note is explicit that the submission does not
  exist yet. Cheap to fix, and it affects event participation rather than code quality.
- **A reverting resolver is indistinguishable from an unset record at the value level.**
  `src/server/ens.ts:129-131` catches everything and yields `null`. The UI does surface
  `readFailures`, so it is not hidden, but a judge may reasonably ask why a resolver revert is
  not surfaced more loudly.
- **`ana.eth` timed out at the default 60 s bound on the first recording run.** Criterion 5
  working as designed, but worth stating that a small local model can exceed a free-tier-friendly
  timeout on `detailed`. The README documents the `LLM_TIMEOUT_MS` trade-off.
- **The knowledge graph returned nothing** for all four P1 queries, so no problem-specific
  grounding was available from the platform.

#### Per-criterion assessment

> **Correction — the weight column in the previous revision of this table was not sourced and
> has been removed.** An earlier draft of this file assigned weights (20/12/10/7/7/10/5/8) to
> the eight checks. Those numbers came from nowhere verifiable: `p1.md` states its eight checks
> as unweighted "Passes if / Fails if" tests, and the raw evaluator prompt retrieved by
> `npm run harness:check` contains a `judgingCriteria` table with **one** row — the craft
> criterion at `weightPct: 20` — because the platform had no project record to attach. The
> invented weights also summed to 99%, which is what tipped off the error. They are replaced
> below with what can actually be cited. If the platform publishes real weights after the
> submission exists, they will differ from anything here.

| # | Check (`p1.md`, unweighted) | Weight | Current state | How to improve |
|---|------------------------------|--------|---------------|----------------|
| 1 | No ENS record value interpolated into system prompt | not stated | **Met.** `src/shared/prompt.ts` has no interpolation; `buildSystemMessage` accepts only closed literal unions. Backed by 32 preference/prompt tests plus a byte-identity assertion in `scripts/record-cases.ts`. | Nothing structural. Optionally add a property-based fuzz over arbitrary record bytes asserting prompt equality. |
| 2 | Each preference value checked against an allowlist | not stated | **Met.** `src/shared/preferences.ts` validates all five keys; `avoid` keeps allowed tokens and drops the rest. `hostile.eth` demonstrates it end to end. | None needed. |
| 3 | Unset record falls back to a named default | not stated | **Met.** Five named defaults with human labels, shown per field in the UI. `minimal.eth` recorded as proof. | None needed. |
| 4 | Entered name normalized before resolution | not stated | **Met.** `normalizeEnsName` is the sole entry point; the root-check defect found by testing was fixed. | None needed. |
| 5 | Model request has an explicit timeout | not stated | **Met.** Required `LLM_TIMEOUT_MS`; proven at the HTTP boundary with a hung socket — 1214 ms observed against a 1200 ms bound, exactly 1 request sent. | Consider a per-provider default if the env value is omitted, rather than failing startup. |
| 6 | Recorded cases pair one question with 2+ preference sets | not stated | **Met.** Four profiles, one byte-identical question, four distinct prompts, regenerable via `npm run record`, with assertions that fail loudly. | Re-run after real names are published so the evidence cites chain data. |
| 7 | Model id and endpoint from configuration | not stated | **Met.** No literal endpoint or model id at any call site; proven by asserting the request path and the configured model id over real HTTP. | None needed. |
| 8 | No credential in any tracked file | not stated | **Met.** `scripts/scan-secrets.mjs` scans tracked files and the built bundle; negative-tested to exit 1 on four planted secret shapes. `.env` git-ignored. | None needed. |
| — | Problem interpretation, craft, judgment | **20%** (the only weighted criterion the harness returned) | **Strong but incomplete.** Right shape, real ENS, visible behavioural difference, documented format. Held back by unpublished names and the absent submission. | Publish the two names; create the submission. |

#### Success-criteria fit

> "Ana types her ENS name once, and every answer arrives in short Portuguese sentences without
> her asking again."

**Partial.** Every mechanism that outcome requires is built and demonstrated — type once, no
wallet, no re-asking, Portuguese short simple-language bullets, visibly different per name. The
one missing piece is named: **the records are not on chain yet**, so today a reviewer types
`ana.eth` and receives the five named defaults instead of Ana's Portuguese bullets. Publishing via
`scripts/set-records.ts` closes it, and the simulated profiles are already shaped to match.

#### Top 3 next steps

1. **Publish to two Sepolia names, then re-record.** Add a funded key to `.env`, run
   `npx tsx scripts/set-records.ts --profile ana --i-understand-this-spends-real-sepolia-eth`
   and the same for `kai`, then `npm run record`. Set `publishedOnChain: true` for both. This
   converts the 20% criterion and the success outcome from partial to met, and upgrades
   `docs/recorded-cases.md` from simulated to real chain evidence. Highest value per minute.
2. **Create the Loops House submission** (`loops project create --event road-to-devcon-vii`).
   The platform has flagged this twice. Minutes of work, and required for the event.
3. ~~**Make a resolver revert louder.**~~ **DONE in Run 3** — see T13 in `action.md`.
   `readPreferenceRecords` now returns a per-key `recordStatus` of `read` / `unset` / `failed`,
   the API threads it through, and the UI warns explicitly when defaults are being shown
   because a read *errored* rather than because the owner left a record unset. Five tests added
   (69 → 74).

---

## Run 3 — resolver diagnostics, harness wrapper, and a corrected rubric

- **Command:** `npm run harness:check` (new wrapper around
  `loops evaluate --event road-to-devcon-vii --problem portable-ai-preferences`)
- **When:** 2026-10-03, after Run 2's gaps were worked.
- **Why a wrapper:** `loops evaluate` returns an *evaluator prompt*, not a verdict, so it
  cannot be turned into a pass/fail gate. `scripts/harness-check.mjs` therefore fetches the
  prompt to `docs/harness/evaluator-prompt.md`, runs the three gates that genuinely can fail
  (typecheck, tests, secret scan), and prints the remaining criteria as explicitly
  `[ manual ]`. It prints **no score** — a green run means "mechanical checks passed and the
  prompt was retrieved", not "the submission is accepted".
- **Rubric finding (the reason this run matters):** the retrieved prompt's
  `judgingCriteria` table contains exactly **one** row —
  *"Problem interpretation, product judgment & code craft"*, `weightPct: 20` — and ends with
  *"No project record was provided. Evaluate the repository you are running inside, and note
  that the builder still needs to create/update their submission on Loops House."* The eight
  `p1.md` checks were not returned as weighted criteria at all, because there is no submission
  for the platform to attach.
- **Correction applied:** the per-criterion table above previously carried invented weights
  (20/12/10/7/7/10/5/8, summing to 99%). Those are not in `p1.md`, which states the eight
  checks as unweighted "Passes if / Fails if" tests, and they are not in the fetched prompt.
  They have been removed and replaced with "not stated", keeping 20% only for the one
  criterion the harness actually returned. No verdict below should be read as implying a
  weighting that was never published.
- **Code change this run:** dependency-injected the text reader into `readPreferenceRecords`
  (`PreferenceTextReader`) so the three-way read status could be tested without stubbing viem
  internals. Regression-checked against the live chain afterwards — `vitalik.eth` still
  resolves correctly.
- **One bug caught by the new tests:** the first version of the injected reader was written
  `async (key) => …`, so TypeScript bound the parameter to `client` and the comparison never
  matched. `tsc` reported TS2367 and the fix was `async (_client, _name, key)`.

### Could not verify

- No problem-specific grounding was available: all four `loops knowledge query` calls for P1
  returned "No relevant context was retrieved for this query."
- `scripts/set-records.ts` has never sent a transaction, so its write path and read-back
  verification are unproven against chain — only its typecheck and safety gates were exercised.
  *(Superseded: the script was deleted in Run 4 and replaced by a MetaMask-signed flow, which is
  also unproven against chain. See Run 4.)*
- Published preference records on two real Sepolia names do not exist yet, so the criterion 6
  evidence is simulated rather than live.
- The real judging weights are unknown. They are not in `p1.md` and not in the prompt
  retrieved without a project record.
  *(Corrected in Run 4: `p1.md` **does** list the per-criterion weights, totalling 80. What is
  absent from the project-less prompt is the per-criterion split, not the weights themselves.)*

### Local deterministic checks at Run 3

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | clean, exit 0 |
| `npx vitest run` | **74 passed / 74**, 4 files, exit 0 |
| `npm run build` | built in 5.48 s |
| `node scripts/scan-secrets.mjs` | PASS, exit 0, 35 tracked files + 3 bundle files |
| `npm run record` | RESULT: PASS — 4 distinct system prompts across 4 profiles (re-run after the refactor) |
| `npx tsx scripts/probe-live-reads.ts` | 24 names × 11 keys = 264 reads; `vitalik.eth` → correct address; 0 text records, 0 throws (re-run after the refactor) |
| `npm run harness:check` | exit 0 — 3/3 local gates PASS, evaluator prompt retrieved (9 468 chars), criterion verdicts intentionally not computed |
## Run 4 - MetaMask publishing, and a criterion-8 false positive fixed

`npm run harness:check` was re-run after the T14 change. Verbatim result:

| Stage | Result |
|-------|--------|
| `loops` CLI | 0.5.0, authenticated |
| Evaluator prompt | retrieved OK, 9 468 chars, written to `docs/harness/evaluator-prompt.md` |
| `typecheck` | PASS |
| `tests` | PASS |
| `secret scan` | PASS |
| local gates | **PASS (3/3)** |
| criterion verdicts | **NOT COMPUTED BY THIS SCRIPT (by design)** |

Exit code 0. As before, a passing run means the mechanical gates are green and the evaluator
prompt was fetched - it is **not** a submission verdict, and no criterion score is claimed here.

### What changed since Run 3

- Publishing is now a **MetaMask-signed browser flow**. `scripts/set-records.ts` (the old
  private-key publisher) was deleted; no private key or seed phrase is used, requested, or stored
  anywhere, including in `.env`.
- Added `src/web/wallet.ts`, `src/web/publish.ts`, `src/shared/ens-write.ts`,
  `src/web/wallet.test.ts`, and a publish panel in `src/web/main.tsx`.
- The preflight ownership result is now **surfaced** as a warning rather than discarded, so the
  README's claim about ownership is true. Ownership is a warning, not an error, because an owner
  may have granted resolver access.
- "The next transaction is sent after the previous one is **confirmed**" was corrected to
  **settles**, because a rejected or failed record does not abort the remaining ones.

### Criterion 8 was failing on false positives, not on a real leak

`node scripts/scan-secrets.mjs` failed with 3 findings, all inside the lazy `viem` browser chunk:

| Reported | Reality |
|----------|---------|
| `URL with embedded credentials` | viem's `docsOrigin:"https://oxlib.sh",showVersion:!1,version:\`ox@...\`` - the regex ran through unrelated minified JS punctuation and read `user:pass@` out of it. **Not a URL with credentials.** |
| `0x5792...`, `0x8010...`, `0x6492...` | EIP-2930 dummy access-list sentinels (a repeated 2-byte unit). |
| `0xffffffff...fc2f` | secp256k1 field prime `p`. |
| `0x7ae96a2b...01ee` | secp256k1 GLV endomorphism `beta`, confirmed present in `node_modules/@noble/curves/src/secp256k1.ts`. |

Three narrowly-scoped fixes, each negative-tested:

1. The credentialed-URL pattern now restricts both userinfo halves to characters that actually
   occur in RPC/API credentials, so it cannot run through JS punctuation. Real credentialed URLs
   (Alchemy, Infura, QuickNode, basic-auth gateways) still match.
2. Named, exact exemptions for the three published secp256k1 constants, plus a **structural**
   rule for the access-list sentinels (32 bytes repeating a unit of 1-4 bytes). A real key would
   have to repeat a 4-byte unit 32 times to slip through, probability 256^-28.
3. **Every** match on a line is now examined rather than only the first. This was a genuine flaw
   found while testing: skipping an exempt constant with `continue` masked a real private key
   placed later on the same line.

Two **pre-existing** holes were also closed while verifying criterion 8:

- `Bearer token literal` required a quote before `Bearer`, so the common bare HTTP-header form
  `Authorization: Bearer <token>` was missed. The quote is now optional.
- `BIP-39-style seed phrase` only matched a bare whole line, so `mnemonic = "..."` was missed -
  the `Secret assigned to a variable` rule cannot span the spaces between words. An assignment
  form is now matched explicitly. The bare form stays line-anchored so ordinary English prose in
  the docs is not flagged.

### Verification of the scanner itself

A 27-case negative suite was planted one case at a time and the scanner re-run. All 27 behaved as
intended, including the cases that matter for trust in the exemption:

| Case | Expected | Result |
|------|----------|--------|
| raw `0x` + 64-hex key | CAUGHT | CAUGHT |
| `PRIVATE_KEY=` assignment | CAUGHT | CAUGHT |
| `https://<user>:<password>@<host>` | CAUGHT | CAUGHT |
| `https://<token>:@host` (empty password) | CAUGHT | CAUGHT |
| Infura project key / QuickNode path key | CAUGHT | CAUGHT |
| OpenAI / Anthropic / Google keys | CAUGHT | CAUGHT |
| PEM private key block | CAUGHT | CAUGHT |
| `Authorization: Bearer <token>`, quoted and bare | CAUGHT | CAUGHT |
| `?apikey=` query param | CAUGHT | CAUGHT |
| `mnemonic = "<12 words>"` and a bare 12-word line | CAUGHT | CAUGHT |
| HF / Stripe tokens | CAUGHT | CAUGHT |
| secp256k1 `p`, `n`, `beta` alone | clean | clean |
| `0x5792...`, `0x8010...` sentinels alone | clean | clean |
| **`p` then a real key on the same line** | CAUGHT | CAUGHT |
| **`sentinel` then a real key on the same line** | CAUGHT | CAUGHT |
| **`beta` then a real key on the same line** | CAUGHT | CAUGHT |
| two real keys on the same line | CAUGHT | CAUGHT |
| ordinary English prose | clean | clean |

> Note on methodology: early scanner comparisons were run while the bundle still failed, which
> made `exit 1` meaningless and briefly looked like regressions. Comparisons were redone against a
> clean baseline before any conclusion was drawn.

> Live proof the scanner still bites: while writing the table above, the literal example
> `https://<user>:<password>@<host>` **in this very file** was flagged as a credentialed URL. That is
> correct behaviour, so the example was rewritten with explicit `<user>` / `<password>` / `<host>`
> placeholders. The scanner is not merely passing because it was loosened.

### Local deterministic checks at Run 4

| Command | Result |
|---------|--------|
| `npm run check` | **exit 0** - typecheck clean, **103 passed / 103**, 5 files, secret scan PASS over 36 tracked files + 5 bundle files |
| `npm run build` | success; initial JS 165.50 kB (53.59 kB gzip), publish path lazy at 286.29 kB (87.76 kB gzip) |
| `npm run harness:check` | exit 0 - 3/3 local gates PASS, evaluator prompt retrieved (9 468 chars), criterion verdicts intentionally not computed |

### Still could not verify at Run 4

- **No transaction has been sent.** The interactive MetaMask publish cannot be automated or
  evidenced from here, so the write path and post-write read-back are still unproven against a
  real chain. The signing code is unit-tested and structurally guarded, but that is not the same
  as a confirmed `setText`.
- Publishing still needs a funded Sepolia MetaMask account and two names that account controls.
- **No Loops House project record exists**, so the evaluator prompt again says no project record
  was provided. Creating one publishes externally under the user's account and has not been done
  unprompted.
- Criterion verdicts remain **not computed**. The rubric in `p1.md` is 8 weighted test cases
  totalling 80 points (criterion 1 = 20, 2 = 12, 3 = 10, 4 = 8, 5 = 7, 6 = 10, 7 = 5, 8 = 8),
  and the prompt also carries a separate craft criterion at 20%. Those are the two distinct
  sources; the earlier per-criterion weights in `action.md` were checked against `p1.md` and are
  correct.

## Run 5 — the 400 explained, two client-error contracts fixed, and the real gap named

### The reported `400 (Bad Request)`

The front-end review reported a bare `400` on `POST /api/preferences/resolve`. Investigated
against the running instance (PID 30060, untouched — no restart, no second server):

| Request to the live server | Result |
|---|---|
| `{"name":"ana.eth"}` | **200** — all five `recordStatus` = `unset`, `fromRecordCount: 0`, `defaultCount: 5`, `readFailures: []`, `nameResolved: false` |
| `{"name":"ana"}` (no ENS root) | 400 `INVALID_ENS_NAME` |
| `{"name":"vitalik.eth"}` | 200 — name resolves to an address, five named defaults |
| malformed JSON | 400 **`text/html`** |
| JSON scalar / array / `null` | 400 **`text/html`** |
| body over 64 kB | 413 **`text/html`** |
| `charset=iso-8859-1` | 415 **`text/html`** |

Two real defects, and one important non-defect.

**Not a defect:** `ana.eth` has **no preference records published on Sepolia**, so the route
correctly returned five named defaults. The reviewer expected Portuguese answers and got the
documented default behaviour instead. The 400 was never the cause of the surprising screen; the
unpublished records were. This is recorded plainly rather than buried, because it is the same
fact as the biggest gap in Run 4.

**Defect A — client errors escaped the JSON contract.** `express.json()` rejects some requests
*before any route handler runs*. Every rejection the route raises itself goes through `fail()`
and returns the documented `{error:{code,message}}` envelope, but body-parser failures fell
through to Express's default HTML page. The status code was right and the response was useless.
Fixed with `describeBodyError`/`apiErrorHandler` in `src/server/index.ts`, registered
`app.use('/api', apiErrorHandler())` before the API 404 fallback, mapping body-parser
`type` to safe codes: `MALFORMED_JSON`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_CHARSET`. The
handler logs method, path, status, code and error type — never the body, the headers, or the
query string (it uses `req.baseUrl + req.path`, not `originalUrl`, precisely to avoid the
query).

**Defect B — the UI invited an input the API must reject.** The field was labelled "ENS name or
address", but an address cannot carry ENS text records, so addresses are (correctly) rejected —
with generic "Check the spelling" advice, which is wrong for an input whose spelling is fine.
`InvalidEnsNameError` now takes specific `guidance`, and `src/server/ens.ts` detects a 20-byte
hex address before normalization to explain that preferences are text records on a *name*. The
UI label is now "ENS name".

New regression coverage, `src/server/api.test.ts` (14 tests) drives the real Express app over
real HTTP against a stub JSON-RPC endpoint that reproduces "no records set":

- the reported case itself — a name whose records are all unset is a **200** with five named
  defaults and `recordStatus` all `unset`, and `"  ANA.eth  "` normalizes;
- malformed JSON, a non-object JSON body, an oversized body and a bad charset each return their
  documented code **as JSON**, including on `/api/ask`;
- a property test over five bad bodies asserts no client error is ever HTML;
- validation is **not** weakened: an address, a name with no root, a missing/empty/non-string
  name and a wrong field name all still fail;
- neither the response nor the log line can contain the request body.

`ens.test.ts` gained the matching unit-level assertion, including that an address no longer
receives "Check the spelling". Two of my own mistakes were caught by these tests: a fabricated
41-hex-character "address" fixture (so the address branch did not fire) and `req.path` being
mount-relative inside `app.use('/api', ...)` (so the log read `/preferences/resolve`).

### Criterion 8 caught my own test fixtures

The first `check:secrets` run failed with 4 findings, all in `api.test.ts`: the canary string
`sk-not-a-real-key-…` is indistinguishable from a real key, which is the scanner working
correctly. The scanner exempts the files that contain its patterns by design
(`SELF_EXEMPT`), so adding `api.test.ts` there was available and **deliberately not taken** —
relaxing a scored gate so my own test can pass is not a gate passing. Instead the canary is
assembled at runtime (`['sk', 'not-a-real-key-…'].join('-')`), so no tracked line looks like a
credential and the gate stays exactly as strict.

### Verbatim `npm run harness:check`

| Stage | Result |
|-------|--------|
| `loops` CLI | 0.5.0 on PATH, authenticated |
| Evaluator prompt | retrieved OK, 9 461 chars, written to `docs/harness/evaluator-prompt.md` |
| `typecheck` | PASS |
| `tests` | PASS — 118 tests, 6 files |
| `secret scan` | PASS — 36 tracked files, 17 patterns, 5 bundle files |
| local gates | **PASS (3/3)** |
| criterion verdicts | **NOT COMPUTED BY THIS SCRIPT (by design)** |

`npm run check` (typecheck + tests + scan) and `npm run build` were also run directly and
passed. Exit code 0. As before this is **not** a submission verdict and no criterion score is
claimed here.

---

### Executed evaluator report — Road To Devcon VII, `portable-ai-preferences`

The freshly retrieved prompt was executed against this repo, as `harness-check.mjs` instructs.
Its single weighted judging criterion is **"Problem interpretation, product judgment & code
craft" (20%)**, which names three wrong shapes and what to reward.

**Alignment summary.** This project attacks the brief directly and at the right altitude: the
five ENS text records under a namespaced `com.portableprefs.*` service prefix are the only
source of preference truth, they are validated against closed allowlists into literal-union
types, and those validated values select app-authored prose that is concatenated into the system
message. There is no app database and no session: a search for `localStorage`,
`sessionStorage`, `indexedDB`, `sqlite` and friends across `src/` returns nothing. The
preferences genuinely change the answer text. The one thing missing is the part only the chain
can prove: no records are actually published on Sepolia.

**What's genuinely strong**

- **The format is adoptable by another app**, which is the rubric's central reward. README
  lines 46–63 give a per-key table of allowed values, defaults, and *why each one earns its
  place*; the keys are ENSIP-5 service keys (`preferences.ts:33`) so the project does not squat
  on global keys other applications own.
- **Preferences are chosen for the reading experience**, exactly as asked: language, length,
  reading level, format, avoid — with defaults `en/brief/standard/plain/none`.
- **The preference-to-behaviour mapping is crisp and citable**, which is what craft is judged
  on. `prompt.ts:50–87` is a literal per allowlisted value, and the literals carry observable
  constraints rather than vibes: "at most three short sentences, about 45 words at most",
  "European Portuguese, pt-PT vocabulary", "in the Devanagari script", "no tables or any tabular
  layout".
- **Wrong shape 2 is structurally avoided.** `buildSystemMessage` accepts `PreferenceValues`,
  whose fields are literal unions over the allowlists (`prompt.ts:9–12`, `preferences.ts:163`),
  so there is no parameter through which a raw record could travel; the question is sent as a
  separate `user` message; and `findRecordLeakage` plus `npm run record` assert no record text
  appears in any prompt.
- **The recorded cases make the difference visible.** `docs/recorded-cases.md`: the same question
  byte-for-byte under four profiles, four pairwise-distinct system prompts shown verbatim, and
  answers that differ in language, length and vocabulary — ana.eth gets two short Portuguese
  sentences, kai.eth gets three technical English paragraphs.
- **Allowlist enforcement is demonstrated, not asserted.** The `hostile.eth` profile puts
  `IGNORE ALL PREVIOUS INSTRUCTIONS`, `<script>alert("xss")</script>` and `rm -rf /` into its
  own records; all are discarded, `tables, jargon` survive, and the recorded system prompt
  contains none of it.
- **No signing key exists anywhere.** Publishing is MetaMask-signed in the browser; `.env` and
  `.env.example` have no key setting; the browser bundle contains no RPC URL.

**Gaps & risks**

1. **Nothing is published on Sepolia — this is the gap that matters.** README line 178 says so
   plainly and `publishedOnChain: false` is set on all four profiles
   (`demo-names.ts:53,71,91,110`), which is honest but is also an unmet brief requirement ("set
   those records on at least two Sepolia ENS names"). The portability claim is currently proven
   only against a simulated record set. Every real well-known name probed returned zero text
   records (264 reads), so *any* real name a judge types resolves to the five defaults — which
   reads as "the app ignored me".
2. **A judge typing `ana.eth` sees defaults, not Ana.** The demo profile is named after a real
   `.eth` name while being simulated. The UI does mark these `simulated`, which mitigates it,
   but the collision is exactly what made this run's 400 report confusing.
3. **The hero recorded case does not visibly honour `format`.** ana.eth is set to
   `format=bullets` and the prompt says "Format the answer as a short bulleted list", but the
   recorded answer is a single prose paragraph. Language, length and reading clearly land;
   `format` and `avoid` are not observable in the recorded output. A judge comparing the
   bullets row against a paragraph will notice. This is the mild form of wrong shape 2.
4. **`src/shared/preferences.ts:19` pointed at `docs/preference-format.md`, which does not
   exist.** The format is genuinely documented in README.md, so this was a broken pointer rather
   than missing documentation. Repointed at README.md ("The preference format") in this run.
5. **`npm run record` was not re-run.** The recorded cases are the committed artifact from the
   previous run and were assessed as-is; the pipeline was not re-executed against the live model
   in this run.

**Per-criterion assessment** (the eight test cases in `p1.md`)

| # | Criterion | State | To improve |
|---|---|---|---|
| 1 | No record value reaches the model as instructions | Met, structurally | Nothing; the literal-union parameter type is the strongest available form |
| 2 | Values constrained to an allowlist | Met | Nothing; five closed lists, `AVOID_MAX_SEGMENTS` DoS guard, unknown tokens discarded not sanitised |
| 3 | Unset records take a documented default | Met | Publish one name so the on-chain path is demonstrated too |
| 4 | Name normalized before resolution | Met, now better | `HEX_ADDRESS` branch makes the address rejection explain itself |
| 5 | Model calls have a timeout | Met | Nothing; 120 000 ms default, asserted by tests including no-retry-after-timeout |
| 6 | Contrasting recorded cases differ observably | **Partial** | Re-record so a `bullets` profile actually answers in bullets |
| 7 | Model configuration not hardcoded | Met | Nothing; base URL, model and timeout all from `.env`, pointed at Ollama locally |
| 8 | No credentials in the repository | Met | Nothing; and this run proved the gate still bites, on my own fixtures |

**Success-criteria fit — "Ana types her ENS name once, and every answer arrives in short
Portuguese sentences without her asking again": PARTIAL.** Typing once works, the record format
works, the answers do arrive short and in Portuguese under her profile, and nothing is asked
twice. What is missing is the middle of that sentence: there is no ENS name on Sepolia that
carries Ana's records, so the demonstration currently runs on a labelled fixture. One publish
step converts this from partial to met, and it is the highest-value hour available.

**Top 3 next steps**

1. **Publish records on two Sepolia names you control, then flip `publishedOnChain` to true.**
   This is the only item that moves the heaviest criterion, and it is the brief's own
   requirement. Two contrasting names (Ana-like and Kai-like) turn the whole submission from
   "simulated" to "demonstrated", and make the recorded cases real chain reads rather than
   fixtures.
2. **Re-record after publishing, and make the contrast land.** Use two names that differ
   maximally on language/length/format, and verify the `bullets` case really answers in
   bullets — if the small local model will not hold the format, record a case whose
   `format=bullets` answer does, or drop `format` from the hero contrast rather than show a
   preference that visibly does nothing.
3. **Rename the simulated profiles so they cannot be confused with live names**
   (`ana-demo.eth`), or keep `ana.eth` and make the "simulated — not on chain" badge
   impossible to miss next to the name. A judge typing `ana.eth` and getting defaults is the
   single most likely way this build gets misread.

### Could not verify

- **No on-chain records exist to read back.** Publishing was out of scope for this run, so
  criterion "read real records" remains demonstrated only against the stub in
  `api.test.ts` and the simulated profiles. The 264-read live probe in the README is a real
  chain result but proves only that names resolve and records are absent.
- **The running instance on :8787 still serves the pre-fix code**, because restarting PID 30060
  was out of scope. The JSON error contract is verified through `api.test.ts`, which drives the
  real Express app over real HTTP on an ephemeral port; the fix reaches :8787 on that process's
  next normal restart.
- **The evaluator prompt's own scoring pipeline was not run.** `loops evaluate` returns a prompt,
  not a verdict, and no criterion score is claimed anywhere in this log.
- The active server's stdout was not readable from this session (the available
  `p1-server.log` belongs to the earlier 18:11 instance), so the original failing request was
  reconstructed from the response matrix rather than from a server-side log.

---

## Run 6 — Release readiness pass (2026-10-04, late session)

Purpose: confirm every one of the eight checks in `p1.md` has actually been checked, close the one
that was only partially met, and prepare the repository. No ENS write, no transaction, no commit of
the root `.env`, no gate weakened.

### Local gates — observed

| Command | Observed |
| --- | --- |
| `npx tsc --noEmit` | clean, no output |
| `npm run test` | **118 passed / 118**, 6 files, 7.60 s |
| `npm run check:secrets` | **PASS** — 36 would-be-committed files, 17 patterns, 5 built bundle files in `p1/dist/web` |
| `npm run check` | **exit 0** |
| `npm run harness:check` | **PASS (3/3)** local gates; evaluator prompt retrieved (9 461 chars); `criterion verdicts: NOT COMPUTED BY THIS SCRIPT (by design)` |
| `npm run build` | **PASS** — 6.69 s, `p1/dist/web`, 166 kB JS / 6.1 kB CSS |

### Run 6a — criterion 6 re-recorded, and the gap closed

`ALLOW_DEMO_FIXTURES=true npm run record` → **PASS**, 4/4 profiles. Console summary verbatim:

```
distinct system prompts : 4 across 4 profiles
  ana.eth       expects pt/short/bullets (<= 45 words) | observed 15 words, 1 sentences, 0 bullet lines, 3 accented words | within bound
  kai.eth       expects en/detailed/plain (no word cap) | observed 157 words, 7 sentences, 0 bullet lines, 0 accented words | n/a
  minimal.eth   expects pt/brief/plain (<= 90 words) | observed 23 words, 1 sentences, 0 bullet lines, 5 accented words | within bound
  hostile.eth   expects en/brief/plain (<= 90 words) | observed 29 words, 1 sentences, 0 bullet lines, 0 accented words | within bound
```

**Defect fixed.** The recorded artifact stated no expected property per case, which `p1.md` lists
as an explicit fail condition for criterion 6. `scripts/record-cases.ts` now declares each case's
expected language / answer length (with the app-authored word bound) / reading level / format
*before* the model is called, and records a mechanical measurement of the returned text beside it.
The existing assertions were left untouched and the run still exits 1 on any of them.

**What the measurement exposes honestly:** the configured local provider (`qwen2.5:3b`) obeys the
language and length preferences and ignores `format=bullets` on `ana.eth` (0 bullet lines).
`qwen3:4b` was probed as an alternative and returned empty `content`, so it is not usable here.
The application's own contribution — the exact system prompt per profile — is asserted byte-for-byte
by the script on every run.

### Per-criterion state after this run

| # | Criterion | State |
| --- | --- | --- |
| 1 | No record value reaches the model as instructions | Met, structurally — `src/shared/prompt.ts:98`, `:127`, `:144` |
| 2 | Values constrained to an allowlist | Met — `src/shared/preferences.ts:59`, `:389` |
| 3 | Unset records take a named default | Met — `src/shared/preferences.ts:99` |
| 4 | Name normalized before resolution | Met — `src/server/ens.ts:72`, `:228`, `:155` |
| 5 | Model calls have a timeout | Met — `src/server/llm.ts:163-166` |
| 6 | Same question, 2+ preference sets, each with a stated expected property | **Met** — `docs/recorded-cases.md` regenerated with `expected` + `observed` per case |
| 7 | Model configuration not hardcoded | Met — `src/server/config.ts:111-114` |
| 8 | No credentials in the repository | Met — scan PASS, 36 files |

**8 of 8 checks pass on local evidence. No official numeric score is claimed.**

### Could not verify

- **No ENS record is published for any demo name.** Criterion-by-criterion code checks pass, and the
  read path is exercised by `src/server/api.test.ts` against a stubbed resolver, but the brief's
  "set those records on at least two Sepolia ENS names" requirement is **NOT VERIFIED / BLOCKED BY
  ENS SETUP**. Publishing requires a funded Sepolia wallet and a MetaMask signature; no ENS write or
  transaction was performed in this session.
- The brief's success criterion therefore remains **PARTIAL**: typing the name once, the record
  format, and short Portuguese answers under Ana's profile are all demonstrated, but on labelled
  fixtures rather than live chain data.
- The evaluator prompt's scoring pipeline was not run. `loops evaluate` returns a prompt, not a
  verdict, and no score is claimed.
- The pre-existing P1 server on port 8787 belongs to an earlier session; it was neither inspected nor
  stopped or restarted, and nothing in this pass depended on it.
