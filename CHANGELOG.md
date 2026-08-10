# Changelog

All notable changes to `@useago/sdk` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.2] - 2026-08-10

### Changed

- Every "try the SDK" instruction now points at the same public demo account
  (`https://playground.api.useago.com`, agent `generic-guide`). The examples
  under `examples/` still pointed at a second backend, so a reader following the
  README and a reader cloning an example were testing against different
  tenants. Docs, README, and examples now agree, and the wording is "demo
  account" everywhere instead of a mix of "live demo", "demo backend", and
  "demo endpoint".
- The `config_missing_base_url` error hint names the demo account and its agent
  slug, so the message is copy-pasteable on its own.
- The copy-paste prompt for coding agents in the README now installs the SDK and
  names the demo agent to wire up (`https://playground.api.useago.com`, agent
  `generic-guide`). It only told the agent to read `llms-full.txt` and
  integrate, so the install was implicit and the agent had to pick a `baseUrl`
  and slug on its own. Pasting the prompt now ends on a chat that answers.

## [1.7.1] - 2026-08-10

### Fixed

- The `setPageState` function synthesized by `registerPageStateFunction` /
  `useAgoPageState` now sends an explicit `required: []` in its parameter
  schema. Backends that treat a missing `required` array as "every property is
  required" forced the agent to set all controls on every call; controls are
  optional, and the agent sets only the ones the user asked for.

## [1.7.0] - 2026-08-07

### Added

- `registerPageStateFunction` / `useAgoPageState` accept a `data` source, so the
  agent gets back **what the page displays** as the result of its own
  `setPageState` call instead of only as context on the next message. An agent
  that filters a list can now say what it found.

  ```ts
  useAgoPageState(controls, {
    data: {
      description: "The users matching the current filters.",
      get: () => users ?? [],
      isLoading: () => isFetching, // isFetching, not isLoading
    },
  });
  ```

  `setPageState` then returns `{ success, applied, data }`. Declaring `data`
  also registers a read-only `readPageData` companion (no parameters, changes
  nothing, returns `{ data }`) for "what's on screen?" questions; it is removed
  by `unregisterPageStateFunction`.
- The SDK waits for the work a control change triggered before reading the
  snapshot. Two ways to tell it when that work is done:
  - **`get()` returns a promise** (preferred): awaiting it *is* the completion
    signal, so the SDK is exact. `get: () => queryClient.ensureQueryData({...})`
    shares the single in-flight request with the UI.
  - **`isLoading` is declared**: the SDK polls it every 50 ms and treats two
    consecutive idle readings as settled. A heuristic, and a flag raised more
    than ~100 ms after the change (a debounced fetch) is missed, so the agent
    reads the previous rows.

  Both are capped by `settleTimeoutMs` (10 s by default); a promise that never
  settles no longer holds the turn open, and a rejected `get()` is reported to
  the agent as a failed read instead of an empty page.
- Oversized snapshots are truncated **by item**: the first whole items that fit
  the budget (`data.maxResultBytes`, defaulting to `maxFunctionResultBytes`) plus
  a `truncation` field carrying `{ truncated, returnedItems, totalItems, hint }`.
  The counts are nested so they cannot overwrite a same-named field of your own
  snapshot. `success` and `applied` are never dropped, so a filter that worked is
  never reported as an unusable blob. When the snapshot's other fields overflow
  on their own, it falls back to a size-bounded preview rather than returning
  something over the ceiling.
- A `readPageData` companion is only removed by the SDK if the SDK registered it,
  so a host app that already has a function by that name keeps it, and
  re-registering a page-state function without `data` drops the stale companion
  instead of letting it answer with the previous page's rows.
- `AgoPageDataSource` is exported from the root, `/react`, `/vue` and `/angular`
  entries.
- `<ChatWidget>` now says **what the agent is doing** while it works, instead of
  three dots. While a client function is running it shows a status row naming it
  ("Updating the page", "Looking up prices"), which matters most during a
  pause/resume loop: the per-message dots disappear as soon as the first token
  lands, so a tool pause after some text had been written showed nothing at all.

  ```tsx
  <ChatWidget functionLabels={{ lookupFlavorPrices: "Je regarde les prix" }} />
  ```

  The row shows the latest step of the current turn and **keeps it until
  something replaces it** (another call, a reasoning step) or the turn ends.
  Clearing it when the call returned made a fast function flash for a few frames
  and read as nothing at all. The agent's `reasoning` steps are included by
  default (`showReasoning={false}` to leave them out), so the row does not go
  blank between two calls.

  `functionLabels` takes a map, or a function `(name, args) => string` for full
  control. Unmapped names fall back to a prettified function name, so the row
  works with no configuration. Pass `false` to keep the plain indicator. The row
  is a `role="status"` live region and is driven by the existing
  `useAgoActivity` hook, so it covers server-side tool calls and approval holds
  too. It is scoped to the assistant message being written, so a new turn never
  opens showing the previous one's last step.

  The label itself is animated: a slow sheen keeps travelling across the text,
  so a step that sits for several seconds (a fetch, a settle wait) reads as
  still working rather than stuck, and each new step fades in as its own node so
  one visibly gives way to the next instead of the characters swapping in place.
  Colours go through `--ago-activity-color` / `--ago-activity-sheen` /
  `--ago-activity-bg`; the sheen is behind `@supports (background-clip: text)`
  and stops under `prefers-reduced-motion`.

  The label carries no animated dots, and the answer bubble above it drops its
  own while the row is up: the text already reads as progress, and the two
  together were just noise. `<Message>` takes a `showStreamingDots` prop for
  the same reason in a custom UI (`false` removes the empty bubble entirely
  rather than leaving a blank box). It renders simple inline Markdown
  (`**bold**`, `*italic*`, `` `code` ``) so a backend reasoning step keeps its
  emphasis; block Markdown is deliberately not supported there, since a
  paragraph or a table would break a one-line row.

Omit `data` and the result stays exactly `{ success, applied }`, byte for byte.
The snapshot stays out of the `page-state:` context entry, so it travels only
when the agent asks for it. The intra-turn round trip requires
`clientFunctionsMode: "pause"` (the default); the SDK warns once if `data` is
declared in `"placeholder"` mode.

### Fixed

- Client functions executed on the resume path (after a reload, via
  `resumePendingClientFunctions`) now emit `function:invoke` and
  `function:result` like the live stream does. A UI driven by those events used
  to sit on a spinner for those calls.
- An agent calling the same client function twice in one turn no longer strands
  the turn. The per-stream dedupe (which exists because the backend emits one
  call under two SSE shapes) keyed on function name + arguments alone, so a
  second call with identical arguments was swallowed: its result was never
  submitted, the backend never saw every result, and the paused turn stayed in
  `WAITING_CLIENT` forever. It now uses the invocation id to tell a repeat call
  apart from a repeat *emission* of the same call. Zero-argument functions (such
  as the new `readPageData`) hit this every time.
- Vue's `useAgoPageState` no longer drops `requiresApproval` (and now forwards
  every option, matching React and Angular).

## [1.6.2] - 2026-08-06

### Fixed

- Side-placement panels (`placement: "left" | "right"`) now get the mobile
  treatment the inline card already had. On a small viewport the open panel
  tracks the visible viewport, so the on-screen keyboard no longer covers the
  composer, and it is exposed as a real dialog (`role="dialog"`, `aria-modal`,
  Tab trap, Escape to close). Opening it moves focus into the panel rather than
  the text field, so the keyboard no longer opens unprompted.
- A desktop side panel is explicitly **not** modal: it no longer traps Tab or
  locks the page behind it, so the host page stays usable beside it.
- The background scroll lock now restores the host page's own inline `<body>` /
  `<html>` styles instead of deleting them. A host that had already pinned its
  own body (for its own modal) is left exactly as it was found.
- The scroll lock is tracked per owner instead of by a counter, so overlapping
  open / close / destroy paths can no longer release a lock they don't hold,
  and `destroy()` is idempotent.
- `destroy()` during an opening animation no longer re-pins the page after
  teardown, which could leave `<body>` fixed with no owner left to release it.
- `destroy()` now drops its keydown and `visualViewport` listeners for every
  placement; side-placement widgets previously leaked them.
- A phone in landscape (short viewport, e.g. 844x390) now counts as mobile, so
  it keeps the full-screen sheet and the keyboard handling instead of falling
  back to the desktop layout mid-conversation.
- A streamed answer no longer rebuilds the whole thread on every token. Screen
  readers announced the entire conversation per chunk, and the rebuild collapsed
  the pane's scroll height, which is what made a "follow the bottom" check latch
  off after the first token.
- The message pane now follows new content only while you are already at the
  bottom. Scroll up to re-read something and the stream stops yanking you back;
  a "jump to latest" button returns you. Sending always re-attaches.
- On a compact viewport the composer is no longer re-focused after every answer,
  which was re-opening the on-screen keyboard over the reply you were reading.
- A failed send no longer destroys the message: the text (and any attachments)
  go back into the composer instead of being lost.
- Touch targets are at least 44px across both the vanilla widget and the React
  components: send, stop, attach, remove-attachment, suggested replies, and both
  close buttons.

### Added

- Bottom-sheet presentation for compact viewports, opt-in via the new `sheet`
  option on the React `<ChatWidget>`. It rests as a `peek` bar pinned to the
  bottom edge (named header, two-line preview of the last reply, composer) and
  expands to a `full` screen with `role="dialog"`, a background scroll lock and
  Escape to collapse. `peek` is deliberately never modal: the page behind it
  stays scrollable and keyboard-reachable.
- `createSheetController` (`@useago/sdk/widget`): the framework-agnostic state
  machine behind it. It returns a **props bag** rather than touching the DOM, so
  the React binding, the vanilla widget and any Vue or Angular binding drive the
  same implementation.
- `useSheet` (`@useago/sdk/react`), which reads that controller through
  `useSyncExternalStore` with a non-compact server snapshot, so `matchMedia`
  never runs during render and hydration matches.
- `<ChatWidget>` now forwards a ref exposing `expand()`, `collapse()`,
  `toggle()` and the current `state`.
- `sheet.bottomOffset` leaves room for a host page that already owns the bottom
  edge (a bottom nav, a sticky checkout bar). `sheet: false` (the default) keeps
  the widget out of the host's fixed layers entirely.
- `thinkingLabel` on `<ChatWidget>`: what the collapsed sheet says next to the
  animated dots while the agent is working and has produced no text yet.
- `--ago-sheet-height`: the collapsed sheet measures itself and publishes its
  footprint as a custom property on the host document. A fixed bar covers the end
  of the page, so hosts need to reserve that space, and a constant in their CSS
  would drift from the real height (which depends on their own composer styling).
  Use it as `padding-bottom: var(--ago-sheet-height, 0px)`.

### Changed

- The streaming dots now paint in `currentColor` instead of a fixed grey, so
  they stay legible on a dark surface as well as a light one.
- React `<ChatInput>`'s `onSend` may now return a boolean (or a promise of one).
  Returning `false` tells the composer the send failed so it can restore the
  draft. Existing handlers that return nothing keep working unchanged.

## [1.6.1] - 2026-08-05

### Added

- The React `<ChatInput>` textarea now exposes an
  `ago-chat-input__field` class for stable custom styling.

### Fixed

- React `<ChatWidget>` auto-scroll now stays inside the message pane instead of
  moving ancestor containers or the whole page, and preserves the reader's
  position while they review earlier messages.

## [1.6.0] - 2026-08-04

### Added

- Stop generation. `client.stop()` interrupts the turn being generated: it
  closes the stream and calls the new `POST /api/sdk/v1/messages/{id}/stop`, so
  the agent really stops instead of finishing in the background. The text
  produced so far is kept and the message ends as `CANCELED`; the in-flight
  `sendMessage` resolves with it rather than rejecting.
- `message:stopped` event, fired once the stopped turn has unwound.
- `client.stopMessage(messageId)` to stop a turn by id (e.g. one still running
  after a page reload), and `client.isGenerating()` to know whether there is
  anything to stop.
- `stop()` on the React `useMessages` / `useChat` hooks, the Vue `useMessages` /
  `useChat` composables, the Angular `AgoService`, and the vanilla widget handle.
- The React `<ChatWidget>` and the vanilla widget now show a Stop button in
  place of the send button while the agent answers. Opt out with
  `allowStop: false`.

## [1.5.6] - 2026-07-29

### Fixed

- `getConversation` now maps each message's `follow_up_replies`, so follow-up
  pills survive a reload instead of disappearing on a reopened thread.

## [1.5.5] - 2026-07-28

### Added

- `conversation:title` event: the backend streams a generated conversation
  title once at the end of the first turn, so the UI can update a header
  without a refetch.

### Changed

- `getConversations(options?)` is now paginated. It accepts `{ page, pageSize }`
  (`pageSize` capped at 100 by the backend) and returns a
  `PaginatedResult<Conversation>` envelope (`{ data, hasMore, total }`) instead
  of a plain array.

## [1.5.4] - 2026-07-22

### Added

- `AgoClient.recordActivity(entry)`: record a user (or agent) action into an
  activity ledger so the agent knows what just happened. The recent window (last
  10 by default) rides along as the `activity:recent` context entry; the agent's
  own client-function calls are recorded automatically. Read or clear with
  `getRecentActivity()` / `clearActivity()`, observe via the `activity:recorded`
  event, or use the React `useAgoActivityLog()` hook.
- `AgoConfig.maxActivityEntries`: override how many recent actions the activity
  ledger keeps (default `10`). Each entry's `data` is size-clamped before storage
  (long strings truncated, large arrays capped) so a single event can't bloat the
  context sent on every message.
- Page-state changes are now reported to the agent: each message includes a
  `state:delta` entry listing the page-state fields that changed since the last
  message. A navigation resets the baseline instead of reporting a diff.

## [1.5.2] - 2026-07-13

### Added

- `ContextEntry.stable`: mark a client-context entry as constant for the whole
  conversation. The backend pins stable entries right after the system prompt,
  where LLM providers cache them across turns, instead of re-sending them next
  to every new user message. Backends without support ignore the flag.

### Changed

- Form collectors register two context entries instead of one: a stable
  `form:<name>:definition` entry carrying the description and full schema
  (cached across turns), and the existing `form:<name>` entry carrying only
  the live state (values, missing, complete, submitted). The agent sees the
  same information; the schema just stops being re-processed on every message.
  The duplicated "Data collected so far" copy of the values was dropped from
  the description (they ride in `data`). `FormCollector` exposes the new
  `definitionContextKey` / `definitionContextProvider`; `install` registers
  and removes both entries.

### Fixed

- Widget: lock background scroll on mobile full-screen panels so the page behind
  the sheet no longer scrolls or rubber-bands (notably iOS Safari, where
  `overflow: hidden` does not stop touch scrolling). The body is pinned with the
  fixed-body method and its scroll position restored on close; ref-counted so
  stacked widgets don't clobber each other's saved offset.

## [1.5.1] - 2026-07-08

### Added

- Approval gate for client functions (pause mode): `AgoConfig.approvalPolicy`
  and a per-function `requiresApproval: true` flag (on `registerFunction`,
  `useAgoFunction`, and `useAgoPageState`) hold a call at `WAITING_CLIENT`
  instead of running it. The SDK emits `function:awaiting-approval`; call
  `client.approveFunction(invocationId)` to run and resume the turn, or
  `client.rejectFunction(invocationId)` to submit a rejection the agent sees.
  Placeholder mode has no paused turn to hold, so the gate is a no-op there. The
  gate also applies after a page reload: `resumePendingClientFunctions` holds a
  gated call for approval instead of re-running it unattended.
- React: `useAgoActivity()` hook, a normalized live feed of the agent's actions
  (navigations, page-state changes, forms, confirmations, status, progress)
  with `approve` / `reject` / `submitForm` controls for items awaiting the user.
  The feed survives a page refresh, rebuilding the resolved activity from a
  restored conversation.

## [1.5.0] - 2026-07-07

### Added

- `attachAutoContinueAfterNavigation(client, options?)`: the auto-continue
  behavior ("go to page B and change X" in one user message) is now a
  framework-agnostic core export, returning a detach function. The React hook
  keeps its API and delegates to it.
- Angular: `AgoService.enableAutoContinueAfterNavigation(options?)` enables
  auto-continue after navigation and returns the disable function (call it in
  `ngOnDestroy`). `AgoAutoContinueOptions` is exported from
  `@useago/sdk/angular`.
- `AgoConfig.warnOnEmptyReply` (default `true`) and a `message:empty` event:
  a reply that completes `DONE` with no content, tool calls, or follow-ups
  (usually an unknown `agent` slug) now warns on the console once per
  conversation and emits a host-consumable event instead of failing silently.
- Stable error codes as the compatibility surface (match on `code`, not
  message text): `config_missing_base_url`, `config_suspect_base_url`
  (warning), `stream_no_body`, `function_invalid_registration`. Code registry
  documented in `docs/general/configuration.md#error-codes`.
- `message:error` events now carry the stable `code` when the failure was an
  `AgoError`.
- `validateConfig` is exported.
- CI now runs lint, typecheck, build and `check:package`, plus a Node 18
  packed-tarball smoke test (ESM import + CJS require + instantiation).

### Changed

- `clientFunctionsMode` now defaults to `"pause"`: with client functions
  registered, the turn stops on the client function call(s) and resumes the
  SAME turn once the results are submitted, so the agent sees the real
  results. Backends without pause/resume support ignore the flag and keep the
  old placeholder behavior. Set `clientFunctionsMode: "placeholder"` (config
  or per message) to opt back into the legacy mode.
- `new AgoClient({})` (or missing/empty `baseUrl`) now throws an actionable
  `AgoError` (`config_missing_base_url`) instead of a raw `TypeError`.
  Same-origin `/path` baseUrls remain supported; a baseUrl with no protocol
  and no leading slash logs a one-time warning.
- `updateConfig` validates the merged config and no longer half-applies an
  invalid update; explicit `undefined` values are treated as absent.
- Error messages now include a one-line fix hint (network, no-body stream,
  401/403/404 HTTP errors) and surface the server's `doc_url` when present.
- `createAgo()` and `mountChatWidget` throw coded `AgoError`s for missing
  config instead of plain `Error`s.
- The `simple-html` examples import the published package from
  `https://esm.sh/@useago/sdk@1`, so opening the file directly in a browser
  works with no build step.
- The visitor anonymous id is now sent as the `X-User-Anon-Id` header. The
  `widgetId` config option and the `ago_widget_id` storage key are unchanged.

### Fixed

- `generateAnonId` no longer crashes on stock Node 18 (global
  `crypto.randomUUID` is flag-gated there); it feature-detects and falls back.
- `AgoProvider` no longer constructs a throwaway internal client when an
  external `client` prop is provided.
- `examples/simple-html/test.html` imported from a wrong-depth path.

## [1.0.0] - 2026-06-11

First stable public release.

### Added

- `@useago/sdk/testing` entry point exposing `createMockClient`.

### Changed

- **License is now Apache 2.0.** The SDK is officially open source. A `LICENSE`
  and `NOTICE` file ship with the package.

## [0.4.7]

### Fixed

- Follow-up replies now only render on the last chat message.
- Dev panel context display.

## [0.4.6]

### Added

- Form schema and collection status are exposed in the agent context.
- Markdown rendering in the vanilla chat widget.
- Conditional field requirements in the form collector.
- Theming support for the widget via `--ago-*` CSS tokens and a `theme` option.

## [0.4.1]

### Added

- Conversational form collector restores its state when a conversation is reloaded.
- Single widget-id session with the last thread cached on the front end.
- Tool calls are included in the SDK conversation detail (`tool_call_data`).

### Fixed

- Form collector missing values now show in the dev panel from the start.

## [0.4.0]

### Added

- Conversation persistence and session management for the chat widget.
- Dev panel shows the live agent context instead of raw store state.

## [0.3.4]

### Added

- Complete chat widget: form creator, suggested replies, and vanilla `mountChatWidget`.
- Conversational form collector with optional backend relay.
- In-browser debug panel (`@useago/sdk/devtools`) with store persistence.
- Tool-call result submit route in the SDK API.

### Fixed

- Devtools DOM ids and storage keys are namespaced to avoid host-page collisions.

## [0.3.0]

### Added

- Observable store with `createStore`, plus `useAgoStore` bindings for React and Vue.

## [0.2.1]

### Added

- Comprehensive README and per-framework guides (core, React, Vue, Angular, widget).

## [0.1.x]

Initial public releases establishing the SDK foundation:

- Framework-agnostic `AgoClient` with SSE streaming.
- React hooks/components, Vue composables, and Angular service bindings.
- Client-side functions (`defineFunction`, `registerFunction`) and pre-built helpers.
- Client/page context API and programmatic navigation.
- Zero-config auto-detection (`createAgo`) and a mock client for testing.

[1.0.0]: https://github.com/useago/ago-sdk/releases/tag/v1.0.0
[0.4.7]: https://github.com/useago/ago-chat/releases/tag/sdk-v0.4.7
[0.4.6]: https://github.com/useago/ago-chat/releases/tag/sdk-v0.4.6
[0.4.1]: https://github.com/useago/ago-chat/releases/tag/sdk-v0.4.1
[0.4.0]: https://github.com/useago/ago-chat/releases/tag/sdk-v0.4.0
[0.3.4]: https://github.com/useago/ago-chat/releases/tag/sdk-v0.3.4
[0.3.0]: https://github.com/useago/ago-chat/releases/tag/sdk-v0.3.0
[0.2.1]: https://github.com/useago/ago-chat/releases/tag/sdk-v0.2.1
