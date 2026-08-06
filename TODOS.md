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

## Glacier: the "agent acts, the sheet yields" differentiator (P2)

- **What:** the one behavior no competitor can copy, because Intercom, Crisp and
  assistant-ui do not drive the host page: the chat gets out of the way when the
  agent changes the page.
- **Why:** on mobile the result of an agent action can land behind the sheet.
  Minimum viable version is example-side only, no SDK API: on `useAgoActivity`
  action-done, `scrollIntoView({block:'center'})` on the changed element plus a
  short highlight. Roughly 15 lines.
- **Not blocked by anything.** The sheet itself shipped; this is the part that
  makes it worth having.
- **Effort:** S.

## Playwright smoke suite for the widget (P2)

- **What:** ~6 real-browser cases. Vitest is jsdom-only (`vitest.config.ts`),
  which structurally cannot see: real layout, `env(safe-area-inset-*)`, host
  `!important` beating widget inline styles, `<dialog>` top layer, View
  Transitions, `getClientRects()` (the focus trap depends on it,
  `createChatWidget.ts:1039`), or computed theme tokens.
- **Why:** the host-page-freeze bug (widget locks `body` from inside a View
  Transition callback) is invisible in jsdom, because jsdom has no
  `startViewTransition` so the callback runs synchronously.
- **Cases:** input row inside `visualViewport` at 390x844 side placement;
  scroll lock/restore; expand-then-destroy leaves no `position: fixed` on body;
  rotation mid-stream; 44x44 targets *with Glacier's stylesheet loaded*;
  `prefers-reduced-motion`.
- **Also:** rewrite the `matchMedia` test stub to be keyed by query string
  (`tests/createChatWidget.test.ts:576-582` collapses every query to one
  boolean, so a landscape media query would pass whatever the code asks for).
- **Note:** no engine simulates an on-screen keyboard. iOS keyboard geometry
  stays a manual device checklist; say so in the docs rather than implying
  tests cover it.
- **Effort:** M.

## Widget diagnostics story (P3)

- **What:** `data-ago-sheet-state` / `data-ago-modal` /
  `data-ago-scroll-lock-owner` attributes, one-shot dev warnings when a host
  `!important` rule defeats the expected geometry or the composer stays outside
  `visualViewport`, and a read-only `widget.getDiagnostics()`.
- **Why:** an integrator whose widget misbehaves inside their page has no way
  to find out why. "expected bottom=64px, computed bottom=0px; overridden by
  `.host-chat{bottom:0!important}`" turns hours of CSS hunting into a fix.
- **Also:** the dev panel paints at `z-index: 1000`
  (`src/devtools/initDevPanel.ts:304`) while the widget uses `2147483000`, so
  the diagnostic tool is hidden behind the thing it should diagnose.
- **Effort:** M.
