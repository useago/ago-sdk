# Changelog

All notable changes to `@useago/sdk` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Fixed

- `generateWidgetId` no longer crashes on stock Node 18 (global
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
