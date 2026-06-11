# Changelog

All notable changes to `@useago/sdk` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
