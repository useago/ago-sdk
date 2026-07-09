---
name: update-docs
description: Update the AGO SDK's public docs from code changes. Scans the branch diff (or recent commits), verifies every claim against src/, updates the matching docs under docs/ and README.md following CLAUDE.md's docs rules, adds a CHANGELOG entry, and regenerates llms-full.txt. Use when asked to "update docs", "sync documentation", or "document recent changes".
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Agent
---

# /update-docs - AGO SDK Documentation Updater

You are a **developer writing for other developers**. Your job: scan code changes,
update the SDK's public docs so a reader can still copy-paste and run, verify every
claim against the source, add a `CHANGELOG.md` entry, and keep `llms-full.txt` in sync.

**HARD GATE:** Only modify `docs/**`, `README.md`, `CHANGELOG.md`, and `llms-full.txt`
(the last only via `npm run build:llms`). Never touch anything under `src/`, `tests/`,
`examples/`, or config. If a doc is wrong because the code is wrong, report it, do not
"fix" it in code.

**Follow `CLAUDE.md` (the "Documentation" and "Scoping" sections) strictly.** They
override anything below. The three rules that matter most:
- Lead with a copy-paste-runnable example, not prose or reference tables.
- Use the live endpoint `https://playground.api.useago.com` in runnable examples.
- No AI-style writing. The em-dash `—` is forbidden (see the Anti-AI gate in Step 5).

---

## Detect mode

- `/update-docs` (no arguments) → **Branch mode** (default): diff the current branch vs `main`.
- `/update-docs days N` → **Days mode**: the last N days of commits already merged to `main`.

---

## Step 1: Gather changes

### Branch mode (default)

```bash
git fetch origin main --quiet 2>/dev/null || true
git diff origin/main...HEAD --stat
git log origin/main..HEAD --oneline
git diff origin/main...HEAD --name-only
```

### Days mode

Only document code already on `main`; unmerged branch work must never be documented.

```bash
git log main --since="N days ago" --oneline --no-merges
git log main --since="N days ago" --no-merges --name-only --pretty=format: | sort -u | grep -v '^$'
```

If you have a specific commit, confirm it is merged before documenting it:
`git merge-base --is-ancestor <commit> main && echo "ON main" || echo "NOT on main"`.

### Filter

Keep only changes that can affect the public surface. Drop:
- `docs/`, `README.md`, `CHANGELOG.md`, `llms-full.txt` (already docs)
- `tests/`, anything matching `*.test.ts` / `*.test.tsx`
- `examples/` (sample apps, not the shipped package)
- Config and infra (`.eslintrc.cjs`, `tsconfig*.json`, `vite.config.ts`, `.github/`,
  `scripts/`, `package-lock.json`)

Output: "Found N commits touching M source files. Analyzing for documentation impact."

---

## Step 2: Classify changes by documentation impact

Read the actual diff (`git diff` / `git show`) and describe each change from the
**consumer's** perspective (someone `npm install`-ing `@useago/sdk`), not the
implementer's. The public surface is what `src/index.ts` and the subpath entries
(`src/react/index.ts`, `src/vue/index.ts`, `src/angular/index.ts`, `src/widget/index.ts`,
`src/devtools/index.ts`, `src/testing/*`) re-export. A change to a non-exported internal
is usually **No doc impact**.

| Classification | Action |
|---|---|
| **New public API** (exported option, method, event, hook, component, helper, endpoint) | Add a section to the matching doc; add a runnable snippet |
| **Changed behavior** (new default, renamed option, changed signature) | Update the existing doc in place, preserve its structure |
| **Removed public API** | Remove or correct the doc; note the removal in the changelog |
| **New theming/scoping surface** (`--ago-*` token, DOM id, storage key) | Update `docs/general/widget.md`'s token table (see CLAUDE.md "Scoping") |
| **No doc impact** (internal refactor, perf, test-only, non-exported symbol) | Skip |

### Source-to-doc map (AGO SDK)

Use this to find which doc(s) each change belongs in. Confirm with Grep before editing.

| Changed source | Primary doc(s) |
|---|---|
| `src/client/types.ts` (`AgoConfig` option) | `docs/general/configuration.md`, `docs/general/core.md` |
| `src/client/AgoClient.ts` (public method) | `docs/general/core.md` + the relevant concept doc |
| `src/streaming/**` (event name / payload) | `docs/general/events-and-streaming.md` |
| `src/functions/**` (registration shape, context) | `docs/general/functions-and-context.md` |
| `src/react/**` (hook, component, provider) | `docs/frameworks/react.md`, `docs/agents/ago-react.md` |
| `src/vue/**` | `docs/frameworks/vue.md`, `docs/agents/ago-vue.md` |
| `src/angular/**` | `docs/frameworks/angular.md`, `docs/agents/ago-angular.md` |
| `src/widget/**` | `docs/general/widget.md`, `docs/agents/ago-widget.md` |
| `src/devtools/**` | `docs/general/devtools.md` |
| `src/api/HttpClient.ts` (auth, base URL, endpoints) | `docs/general/configuration.md`, `docs/general/custom-domain.md` |
| `src/testing/**` (mock client) | `docs/general/testing.md` |
| `src/auto/**`, `src/forms/**`, `src/state/**` | the concept doc that references them (Grep to find it) |
| A headline capability any consumer meets first | `README.md` (keep it runnable-first) and `docs/general/getting-started.md` |

Output a table:
```
Change Analysis:
  [what changed]  [classification]  [target doc or "new"]  [action]
```

If nothing is doc-worthy: output "No documentation updates needed." and jump to Step 6
(a changelog entry may still be warranted for a user-facing fix).

---

## Step 3: Coverage check (optional gaps)

AGO's docs philosophy (CLAUDE.md) is "keep it simple": lead with a runnable example,
show don't catalogue, push deep reference behind the fold or a `<details>`. Do not add
docs a reader will not run.

For each feature you are touching, sanity-check the reader's path exists:
1. Is there a runnable snippet a reader can paste? (the thing devs test first)
2. Is the option/event/hook findable from where a reader would look (README link,
   the relevant `docs/general/*` or `docs/frameworks/*` page, and cross-links)?
3. For a framework feature, does the matching `docs/agents/ago-*.md` skill doc mention it
   (those are bundled into `llms-full.txt`)?

If a genuinely useful page is missing (not just "more reference"), note it and ask the
user whether to write it now or defer. Prefer extending an existing page over adding a
new file: one feature, one home.

---

## Step 3.5: Verify every claim against the codebase (MANDATORY)

Never write from memory. Before editing any doc, confirm each factual claim against
`src/`. This mirrors the `/pr` skill's "Docs claim verification" gate.

For each option, method, event, hook, prop, default, or endpoint you will document:
- **Exports / entry points** → `src/index.ts` and the subpath index it re-exports from.
- **Client options / config** → `src/client/types.ts` (the `AgoConfig` interface + defaults).
- **Client methods** → `src/client/AgoClient.ts`.
- **React hooks / components** → `src/react/`.
- **Functions / registration** → `src/functions/`.
- **Events** → `src/client/types.ts` (`AgoClientEvents`) and `src/streaming/`.
- **Endpoints** → `src/api/HttpClient.ts`.

Verify: every name exists, every signature matches, every default is the real default,
every runnable snippet uses `https://playground.api.useago.com`, and every import path
resolves against the package `exports` in `package.json`.

**If you cannot verify a claim, omit it.** A missing detail beats a wrong one that breaks
the reader's first attempt. For a large or high-risk change, spawn a Sonnet agent (via the
Agent tool) to audit the drafted doc against `src/` before you finalize, and block on any
critical mismatch.

---

## Step 4: Write or update the docs

For each target doc:

### Updating an existing doc
1. Read the full file first.
2. Re-read the relevant source to confirm the facts.
3. Make targeted Edits; preserve the page's existing structure and voice.
4. If the page leads with a runnable example, keep it leading. Add new reference detail
   below the fold or inside a `<details>` block, never above the runnable snippet.

### Creating a new doc (rare)
1. Read the source first; understand the feature from the code.
2. Put it in the right folder: cross-cutting concept or reference → `docs/general/`;
   per-framework guide → `docs/frameworks/`; agent-facing per-stack skill → `docs/agents/`.
3. Open with a copy-paste-runnable example against `https://playground.api.useago.com`,
   then a short "what else is possible", then reference behind a `<details>` if long.
4. Cross-link: from a framework guide link to the concept doc; from a concept doc link to
   the framework guides. Add a link from `README.md` if a reader needs to find it.

### Content rules (from CLAUDE.md)
- Short sentences. Write like a developer explaining to another developer.
- Note that readers swap `https://playground.api.useago.com` for their own
  `https://YOUR-DOMAIN.api.useago.com` once they have a tenant.
- Theme via `var(--ago-token, default)`; keep the `theme` keys, `THEME_VARS`, and the
  `docs/general/widget.md` token table in sync when the visible surface changes.
- A big README is fine, but the top must be instantly runnable and the layout scannable.
  Do not strip content to shorten; collapse depth behind `<details>`.

For each file touched, output: `[file] - [created/updated] - [what specifically changed]`.

---

## Step 5: Anti-AI quality gate (MANDATORY)

After writing or editing, switch to CHECKER mode and re-read each changed doc against
CLAUDE.md's "No AI-style writing" list. Scan only the lines you added or changed.

- **Gate 1 - Em-dash:** the character `—` is forbidden anywhere in doc prose. Replace with
  a period, comma, colon, or parentheses. (Grep helps: `grep -n '—' <file>`; ignore the
  `—` in unchanged lines and code, but fix any you introduced.)
- **Gate 2 - AI tells:** no "it's not just X, it's Y" constructions; no rule-of-three
  lists ("fast, simple, and powerful"); no hype adjectives ("seamless", "powerful",
  "robust", "supercharge"); no sentences starting with "Whether you're..."; no emoji in
  prose.
- **Gate 3 - Specificity:** every feature sentence names a concrete AGO detail (the option
  name, the event, what happens when you call it). If you could swap in another product's
  name and the sentence still reads true, rewrite it.

Per file, output:
```
Anti-AI gate for [file]:
  Gate 1 (em-dash): PASS/FAIL - [quote or "clean"]
  Gate 2 (AI tells): PASS/FAIL - [quote or "clean"]
  Gate 3 (specificity): PASS/FAIL - [quote or "clean"]
  VERDICT: PASS / REWRITE NEEDED
```
On FAIL, rewrite and re-run all gates. Max 2 rewrites per file, then flag for the user.

---

## Step 6: Update the changelog

Edit `CHANGELOG.md` (Keep a Changelog format). Add entries under `## [Unreleased]`; create
that section right under the header block if it does not exist. Use the standard groups:
`### Added`, `### Changed`, `### Fixed`, `### Removed`.

```markdown
## [Unreleased]

### Added

- `AgoConfig.<option>`: what the consumer can now do, in one line.
```

Rules:
- Describe user-facing behavior, never internal code or file names.
- Match on the public surface (option, event, hook, method), not the diff.
- Never edit or delete existing released entries; only add to `[Unreleased]`, or polish
  wording within it, using Edit (not Write).
- Do **not** bump the version. A version bump (`chore: bump version to X.Y.Z`) happens only
  when the user asks to release.
- Add a changelog entry for anything more than a trivial fix; skip pure refactors.

---

## Step 6.5: Regenerate llms-full.txt

`llms-full.txt` is generated from a fixed set of docs by `scripts/build-llms.mjs`: the
five `docs/agents/ago-*.md` skills plus `docs/general/functions-and-context.md`,
`docs/general/events-and-streaming.md`, and `docs/general/configuration.md`.

If you changed **any** of those files, regenerate and stage the result:

```bash
npm run build:llms   # writes llms-full.txt
git status --porcelain llms-full.txt
```

Commit the regenerated `llms-full.txt` alongside the doc changes. If you changed only docs
outside that set, `llms-full.txt` does not change, and that is expected.

---

## Step 7: Output summary

```
Documentation update complete:

Changes processed:
  [what changed]  [classification]  [action taken]

Files modified:
  [file]  [created/updated] - [what changed]

Coverage gaps:
  [feature]  [gap]  [filled / deferred]   (or "none")

Changelog:
  [N] entries added under [Unreleased]

llms-full.txt:
  regenerated / no change needed
```

---

## Important rules

- **Verify before you write.** Never document an option, event, default, or endpoint
  without reading the source that proves it. Wrong docs are worse than missing docs.
- **Only document merged code** in days mode: query `git log main`, never `--all`.
- **Read before editing.** Read the whole file first; extend, do not clobber.
- **Runnable-first.** Every page and the README lead with a snippet a reader can paste and
  run against `https://playground.api.useago.com`.
- **CLAUDE.md wins.** Its Documentation and Scoping sections override this skill on any
  conflict (em-dash ban, no AI tells, theme tokens, ago-prefixed identifiers).
- **Stay in the docs.** Only `docs/**`, `README.md`, `CHANGELOG.md`, and (via build)
  `llms-full.txt`. Never edit `src/`, `tests/`, or `examples/`.
- **Don't auto-commit.** Leave changes staged for the user to review and commit (or run
  `/pr`, which re-runs the docs claim verification gate before opening a PR).
```
