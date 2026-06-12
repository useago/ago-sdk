# TODOS

Deferred work with enough context to pick up cold. Source: 2026-06-11 DX audit
review (plan: fix DX audit findings).

## Backend: explicit error for unknown agent slug (P1, cross-repo)

- **What:** The AGO API returns an empty 200/SSE stream when `agent_id` does not
  exist for the tenant. Return a 404 (or an SSE error event) instead.
- **Why:** A typo'd slug currently produces an empty reply. The SDK ships a
  client-side heuristic (`message:empty` + console warning, see
  `AgoClient.maybeFlagEmptyReply`) as a stopgap; it is documented as temporary
  and should be REMOVED once the backend signal exists.
- **Where to start:** file the issue in the backend repo and link it here and in
  the `maybeFlagEmptyReply` comment.
- **Effort:** S (API change + SDK cleanup). **Blocked by:** backend ownership.

## Deprecation JSDoc: `defaultAgentId` and the `register`/`registerFunction` alias (P3)

- **What:** `AgoConfig.defaultAgentId` duplicates `agent` ("prefer agent" lives
  only in a comment), and `AgoClient.register` duplicates `registerFunction`.
  Add `@deprecated` JSDoc now; remove in 2.0.
- **Why:** Two names for one concept taxes newcomers; deprecation markers let
  editors steer users before a breaking removal.
- **Effort:** S. **Depends on:** deciding which of register/registerFunction
  survives (lean: `registerFunction`, it matches the docs).

## CONTRIBUTING.md + GitHub issue templates (P3)

- **What:** No CONTRIBUTING.md, no issue templates, discussions disabled.
- **Why:** The repo is public (Apache 2.0); first outside bug reports will
  arrive unstructured. ~30 minutes of work.
- **Effort:** S.

## Mock client gaps (P3)

- **What:** `createMockClient` cannot simulate stream errors (no `__emitError`
  helper is needed since `__emitEvent("message:error", ...)` exists, but
  document it) and `getRegisteredFunctions()` always returns `[]`, so function
  registration flows cannot be asserted against the mock.
- **Why:** Consumers testing their error paths and function wiring need both.
- **Where to start:** `src/testing/createMockClient.ts` (track registered
  definitions in a map; return live schemas).
- **Effort:** S.
