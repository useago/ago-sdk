---
name: pr
description: Run all CI checks and create a Pull Request for the AGO SDK. Auto-fixes lint issues and attempts to fix failing tests, typecheck, and build.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# /pr - Create Pull Request

Runs the SDK's CI checks and creates a PR. Auto-fixes lint issues and attempts to fix other failures. The AGO SDK is a single published npm package (`@useago/sdk`), so every check runs on the whole package (there are no separately-buildable components).

## Usage

```
/pr [options]
```

## What It Does

1. **Detect Changes** - List files changed vs `main` to decide which extra gates run (docs, published-surface, llms doc).
2. **Rebase** (always) - `git fetch origin && git rebase origin/main`.
3. **Lint** (always) - `npm run lint` (eslint, `--max-warnings 0`). Auto-fix on failure.
4. **Typecheck** (always) - `npm run typecheck` (`tsc --noEmit`). Analyze & fix.
5. **Tests** (always) - `npm test` (`vitest run`). Analyze & fix.
6. **Build** (always) - `npm run build` (clean + vite build + `.d.cts` copy + `build:llms`). Report & fix.
7. **Package export gate** (if `src/index.ts`, `package.json` `exports`/`files`, or any public entry changed) - `npm run check:package` (`publint --strict && attw`). Ensures the published types/exports stay valid for consumers.
8. **llms-full.txt** (if any file under `docs/` bundled by `scripts/build-llms.mjs` changed) - `npm run build:llms` regenerates `llms-full.txt`. Commit the regenerated file. (Step 6 already runs it, but verify the diff got committed.)
9. **Documentation** - If the change touches public behavior (new option, event, component, function-registration shape, endpoint), update the relevant doc under `docs/` and the README. Follow the `CLAUDE.md` docs rules: lead with a runnable example, no em-dash, no AI-tells, use `https://playground.api.useago.com` in examples. Add a `CHANGELOG.md` entry for anything more than a trivial fix; describe user-facing behavior, never internal code.
10. **Scoping check** (if the change adds styles, DOM ids, globals, or storage keys) - Verify nothing leaks into the host page: inline styles or `ago`-prefixed scoped rules only, every global id/keyframe/storage key `ago`-prefixed, theme via `--ago-*` tokens, no `window.*`/`globalThis.*` writes, `sideEffects: false` preserved. See `CLAUDE.md` "Scoping".
11. **Version bump** (if publishing) - Repo convention is a `chore: bump version to X.Y.Z` commit. Only bump when the user asks to release; a normal feature/fix PR does not need it.
12. **Docs claim verification gate** (if any `docs/**.md` changed) - Spawn a Sonnet agent to audit every factual claim in the changed docs against the actual SDK source. Block PR creation on any critical finding. See `Docs claim verification` below.
13. **Create PR** (always) - Push and create PR via GitHub CLI (`gh pr create --base main`).

If nothing but non-code files changed, still run lint/typecheck/test/build (fast) then go to PR creation.

## Options

| Option | Description |
|--------|-------------|
| `/pr` | Run all checks and create PR |
| `/pr --check` | Only run checks, don't create PR |

## Behavior on Failure

| Check | On Failure |
|-------|------------|
| Rebase | Analyze conflicts & resolve them, then continue rebase |
| Lint | Auto-fix with `npx eslint "src/**/*.{ts,tsx}" --fix`, re-run, stop if still failing |
| Typecheck | Analyze the `tsc` error & attempt fix, stop |
| Tests | Analyze the failing test & attempt fix, stop |
| Build | Report the build error, attempt fix, stop |
| Package export gate | Report the `publint`/`attw` finding, fix `exports`/types, stop |
| Docs claim verification | If the agent reports any critical finding, stop, surface each with line range and actual code, let the user decide. Re-run `/pr` after fixing. |

After any fix, re-run `/pr` to continue.

## PR Format

- **Title**: Concise summary of changes (~50 chars).
- **Body**: Just a `## Summary` section with bullet points. No test plan, no "Generated with Claude Code" footer.

```
## Summary
- Add X option to the chat widget
- Fix Y in SSE reconnect
- Update docs for Z
```

## Commit Format

Standard commit messages. Follow the repo's conventional-commit style seen in the log (`feat(sdk):`, `fix:`, `docs(...)`, `chore:`). No `Co-Authored-By` or other footers.

## Check Commands

### Change Detection
```bash
CHANGED_FILES=$(git diff --name-only $(git merge-base HEAD main)...HEAD)

echo "$CHANGED_FILES" | grep -qE '^src/index\.ts$|^package\.json$' && PUBLISH_SURFACE_CHANGED=true
echo "$CHANGED_FILES" | grep -qE '^docs/' && DOCS_CHANGED=true
```

### Rebase
```bash
git fetch origin && git rebase origin/main
```

### Core checks (always)
```bash
npm run lint
npm run typecheck
npm test
npm run build
```

### Package export gate (if publish surface changed)
```bash
npm run check:package   # publint --strict && attw --pack . --profile node16
```

### Regenerate llms-full.txt (if bundled docs changed)
```bash
npm run build:llms      # writes llms-full.txt from the docs listed in scripts/build-llms.mjs
```
Commit the regenerated `llms-full.txt` with the PR.

## Docs claim verification (gate)

**Trigger:** any change in `docs/**.md` between merge-base and HEAD.

**Detection:**
```bash
DOCS_CHANGED=$(git diff --name-only $(git merge-base HEAD main)...HEAD | grep -E '^docs/.*\.md$' || true)
[ -n "$DOCS_CHANGED" ] && echo "docs changed: $DOCS_CHANGED" || echo "no doc changes — skip gate"
```

If no docs changed, skip this section entirely.

**Why this gate exists.** The SDK docs are what developers copy-paste to integrate. A made-up option name, a wrong hook signature, a fabricated event, or a non-existent endpoint is a critical bug: it breaks the reader's first attempt. Every claim in the changed docs must be verifiable against the actual SDK source in `src/`.

**How to run.** Spawn a Sonnet agent with the prompt template below. It reads each changed doc, extracts every verifiable claim, and checks each one against the code. It audits every claim, it does not spot-check.

**Agent prompt template:**

```
You are auditing AGO SDK documentation against the codebase.

Repo root: <absolute path>
Changed doc files: <newline list of paths>

For EACH changed file, list every factual claim that can be verified against
code: exported names, option/prop keys, hook names and signatures, event names,
function-registration shapes, config option names and defaults, endpoint URLs,
package/import paths, and any "X happens when Y" behavioral promise. Then verify
each claim by reading the relevant source:

- Public exports / entry points → src/index.ts and the module it re-exports
- Client options / config → src/client/ types
- React hooks and components → src/react/
- Client functions / registration → src/functions/
- Streaming / event names → src/streaming/
- HTTP endpoints → src/api/
- Example endpoints in runnable snippets must be https://playground.api.useago.com

For each claim that does NOT match the code, report:
1. File + line range
2. The exact claim, quoted
3. What the code actually says (cite file + line)
4. Severity:
   - critical: false / made-up / unverifiable claim that would break a
     developer's integration (wrong export, wrong signature, invented option,
     non-existent event or endpoint)
   - minor: stylistic, or an unverifiable non-technical promise

If a claim is correct, do NOT list it. Only report mismatches. Be thorough.
Output a numbered list grouped by severity: critical first, then minor.
End with: `RESULT: <N> critical, <M> minor`.
```

**Behavior on failure.**
- `0 critical` → surface minor findings as warnings, proceed to PR creation.
- `>= 1 critical` → **stop**. Print the critical findings verbatim. Ask the user to either fix the docs (preferred, re-run `/pr`) or override with explicit "skip docs gate" confirmation, documented in the PR description.

The gate runs read-only. It does NOT auto-edit docs.
