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

## Mobile sheet (`peek`/`full`) — blocked on six API decisions (P2)

Source: 2026-08-05 /autoplan review (plan:
`.context/mobile-chat-plan.md`, branch `dmourot/mobile-chat-ux-research`).
Deferred out of the mobile PR because three review phases independently
concluded the sheet is not ready to implement.

- **What:** A two-state (`peek` / `full`) mobile chat sheet, replacing the
  current binary inline-card / fullscreen morph.
- **Blocked on, all unanswered:**
  1. Does the shared controller return a props bag, or mutate the DOM? React
     re-renders per streamed token and re-applies its inline `style` object
     (`ChatWidget.tsx:182-194`), clobbering imperative writes.
  2. SSR/hydration: reading `matchMedia` during render throws in Node. Needs
     `useSyncExternalStore` with a server snapshot of `false`.
  3. `<dialog>`: you cannot promote `show()` to `showModal()` without closing
     and re-parenting into the top layer, which kills the running transition.
     Pick one of: explicit modal semantics on a normal element / two surfaces /
     accept the discontinuity.
  4. `bottomOffset` + `sheet: false`. A permanent near-max-z-index fixed
     overlay on a third-party page is a CLAUDE.md scoping decision, and there
     is currently no way at all to opt out of the mobile behavior
     (`trigger: "manual"` does not do it, and is ignored for side placement,
     `types.ts:246-250`).
  5. Naming: `sheet {}` rather than `mobile {}` (the option is about layout,
     not device); `expand()`/`collapse()` rather than `snapTo()` (drag-engine
     vocabulary for a design with no drag). Keep `mobile` as a deprecated
     alias for at least one minor.
  6. Exact composition of `peek` (a spec exists in the plan's Phase 2, needs
     sign-off).
- **Depends on:** the mobile PR (shared lock manager, `isModal` predicate,
  state machine, streaming-render fix) landing first.
- **Effort:** L.

## Glacier mobile sheet + the "agent acts, sheet yields" differentiator (P2)

- **What:** (a) Glacier consuming the sheet; (b) the one behavior no competitor
  can copy, because Intercom/Crisp/assistant-ui do not drive the host page: the
  chat gets out of the way when the agent changes the page.
- **Why (b) matters most:** on mobile today the result of an agent action is
  off-screen behind the chat. Minimum viable version is example-side only, no
  SDK API: on `useAgoActivity` action-done, `scrollIntoView({block:'center'})`
  on the changed element plus a short highlight. ~15 lines.
- **Blocked by:** (a) needs the sheet, and `ChatWidgetProps` has no `mobile`
  prop, so Glacier cannot configure a breakpoint until that ships. (b) is NOT
  blocked and can go any time.
- **Effort:** (a) M, (b) S.

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
